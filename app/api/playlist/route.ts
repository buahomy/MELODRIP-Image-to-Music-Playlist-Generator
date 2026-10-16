import { NextResponse } from "next/server";
import { captionImage, CaptionError, fetchImage, type Caption } from "@/lib/caption";
import { claudeEnabled, curatePlaylist, mergeCandidates, type CuratedPlaylist } from "@/lib/curate";
import { extractKeywords, toKeywords, type Keyword } from "@/lib/keywords";
import { recommendSongs } from "@/lib/recommend";
import { deezerSearch, geniusEnabled, geniusSearch, lastfmEnabled, lastfmTagTracks } from "@/lib/sources/music-apis";
import { tiktokEnabled, tiktokSounds } from "@/lib/sources/tiktok";
import type { Candidate, Source } from "@/lib/sources/types";
import { findTrack, spotifyEnabled, type SpotifyTrack } from "@/lib/spotify";

export const runtime = "nodejs";
// TikTok scraping alone can take over a minute.
export const maxDuration = 180;

type Body =
  | { mode: "text"; text: string }
  | { mode: "image"; imageUrl?: string; imageData?: string };

export type PlaylistSong = {
  title: string;
  artist: string;
  source: Source;
  reason: string;
  spotify: SpotifyTrack | null;
};

// The response is newline-delimited JSON, one event per line.
export type PlaylistEvent =
  | { type: "analysis"; caption: string; keywords: string[] }
  | { type: "status"; message: string }
  | { type: "playlist"; name: string; description: string; songs: PlaylistSong[]; sources: Partial<Record<Source, number>>; notes: string[] }
  | { type: "error"; error: string };

async function sceneFromBody(body: Body): Promise<Caption> {
  if (body.mode === "text") {
    const text = (body.text ?? "").trim().slice(0, 2000);
    if (!text) throw new CaptionError("Type something first.", 400);
    return { caption: text };
  }
  if (body.imageData) {
    const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(body.imageData);
    if (!match) throw new CaptionError("Unsupported image.", 400);
    const buf = Buffer.from(match[2], "base64");
    return captionImage(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), match[1]);
  }
  if (body.imageUrl) {
    const { bytes, type } = await fetchImage(body.imageUrl);
    return captionImage(bytes, type);
  }
  throw new CaptionError("Choose a photo first.", 400);
}

// One list per keyword -> a single list that alternates between keywords.
function interleave(lists: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

// Run every configured source at once; a failing source is noted, not fatal.
async function gatherCandidates(stems: Keyword[], notes: string[]): Promise<Candidate[]> {
  const keywords = stems.map((k) => k.word);
  const lyrics = recommendSongs(stems, 10).map<Candidate>((s) => ({
    title: s.title,
    artist: s.artist,
    source: "lyrics",
    detail: `lyrics match ${s.score.toFixed(2)}`,
  }));
  const jobs: [string, Promise<Candidate[]>][] = [
    ["Lyrics", Promise.resolve(lyrics)],
    ["Deezer", Promise.all(keywords.map(deezerSearch)).then(interleave)],
  ];
  if (tiktokEnabled()) jobs.push(["TikTok", tiktokSounds(keywords)]);
  if (lastfmEnabled()) jobs.push(["Last.fm", Promise.all(keywords.map(lastfmTagTracks)).then(interleave)]);
  if (geniusEnabled()) jobs.push(["Genius", Promise.all(keywords.map(geniusSearch)).then(interleave)]);

  const results = await Promise.allSettled(jobs.map(([, job]) => job));
  return results.flatMap((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.error(`${jobs[i][0]} source failed:`, result.reason);
    notes.push(`${jobs[i][0]} was unavailable this time.`);
    return [];
  });
}

async function resolveOnSpotify(playlist: CuratedPlaylist, notes: string[]): Promise<PlaylistSong[]> {
  if (!spotifyEnabled()) return playlist.songs.map((s) => ({ ...s, spotify: null }));
  let failed = false;
  const songs = await Promise.all(
    playlist.songs.map(async (s) => ({
      ...s,
      spotify: await findTrack(s.title, s.artist).catch(() => {
        failed = true;
        return null;
      }),
    }))
  );
  if (failed) notes.push("Some songs couldn't be checked on Spotify.");
  // Drop picks Spotify doesn't have, unless the lookup itself failed.
  return failed ? songs : songs.filter((s) => s.spotify);
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlaylistEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const { caption: scene, keywords: chosen } = await sceneFromBody(body);
        const stems = chosen ? toKeywords(chosen) : extractKeywords(scene);
        const keywords = stems.map((k) => k.word);
        send({ type: "analysis", caption: scene, keywords });

        send({ type: "status", message: tiktokEnabled() ? "Digging through TikTok hashtags…" : "Searching music libraries…" });
        const notes: string[] = [];
        const candidates = await gatherCandidates(stems, notes);

        let playlist: CuratedPlaylist;
        if (claudeEnabled()) {
          send({ type: "status", message: "Claude is picking the best songs…" });
          playlist = await curatePlaylist(scene, keywords, candidates).catch((err) => {
            console.error("Claude curation failed:", err);
            notes.push("Claude was unavailable, so songs were mixed automatically.");
            return mergeCandidates(candidates, scene);
          });
        } else {
          playlist = mergeCandidates(candidates, scene);
        }

        send({ type: "status", message: "Finding songs on Spotify…" });
        const songs = await resolveOnSpotify(playlist, notes);
        const sources: Partial<Record<Source, number>> = {};
        for (const c of candidates) sources[c.source] = (sources[c.source] ?? 0) + 1;
        send({ type: "playlist", name: playlist.name, description: playlist.description, songs, sources, notes });
      } catch (err) {
        if (!(err instanceof CaptionError)) console.error(err);
        send({ type: "error", error: err instanceof CaptionError ? err.message : "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
