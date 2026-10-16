import { NextResponse } from "next/server";
import { captionWithHuggingFace, CaptionError, fetchImage, hfCaptionEnabled } from "@/lib/caption";
import { claudeEnabled, curatePlaylist, mergeCandidates, type CuratedPlaylist } from "@/lib/curate";
import { recommendSongs } from "@/lib/recommend";
import { deezerSearch, geniusEnabled, geniusSearch, lastfmEnabled, lastfmTagTracks } from "@/lib/sources/music-apis";
import { tiktokEnabled, tiktokSounds } from "@/lib/sources/tiktok";
import type { Candidate, Source } from "@/lib/sources/types";
import { findTrack, spotifyEnabled, type SpotifyTrack } from "@/lib/spotify";
import { CLAUDE_IMAGE_TYPES, planFromText, understandWithClaude, type SearchPlan, type UnderstandInput } from "@/lib/understand";

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
  | { type: "analysis"; caption: string; context?: string; keywords: string[] }
  | { type: "status"; message: string }
  | { type: "playlist"; name: string; description: string; songs: PlaylistSong[]; sources: Partial<Record<Source, number>>; notes: string[] }
  | { type: "error"; error: string };

async function readInput(body: Body): Promise<UnderstandInput> {
  if (body.mode === "text") {
    const text = (body.text ?? "").trim().slice(0, 2000);
    if (!text) throw new CaptionError("Type something first.", 400);
    return { text };
  }
  if (body.imageData) {
    const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(body.imageData);
    if (!match) throw new CaptionError("Unsupported image.", 400);
    return { image: { base64: match[2], type: match[1] } };
  }
  if (body.imageUrl) {
    const { bytes, type } = await fetchImage(body.imageUrl);
    return { image: { base64: Buffer.from(bytes).toString("base64"), type } };
  }
  throw new CaptionError("Choose a photo first.", 400);
}

// Claude builds a context-aware plan; without it (or if it fails), TextRank
// keywords from the text or from a Hugging Face caption of the photo.
async function buildPlan(input: UnderstandInput, notes: string[]): Promise<SearchPlan> {
  if ("image" in input && !(CLAUDE_IMAGE_TYPES as readonly string[]).includes(input.image.type)) {
    throw new CaptionError("Use a JPEG, PNG, GIF or WebP image.", 400);
  }
  if (claudeEnabled()) {
    try {
      return await understandWithClaude(input);
    } catch (err) {
      console.error("Claude search plan failed:", err);
      notes.push("Claude couldn't interpret this, so a simpler keyword search was used.");
    }
  }
  if ("text" in input) return planFromText(input.text);
  if (!hfCaptionEnabled()) throw new CaptionError("Photo captioning isn't available right now. Try Text mode.", 503);
  return planFromText(await captionWithHuggingFace(input.image.base64, input.image.type));
}

// One list per keyword -> a single list that alternates between keywords.
function interleave(lists: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

// Run every configured source at once, each with its part of the plan;
// a failing source is noted, not fatal.
async function gatherCandidates(plan: SearchPlan, notes: string[]): Promise<Candidate[]> {
  const lyrics = recommendSongs(plan.lyricKeywords, 10).map<Candidate>((s) => ({
    title: s.title,
    artist: s.artist,
    source: "lyrics",
    detail: `lyrics match ${s.score.toFixed(2)}`,
  }));
  const jobs: [string, Promise<Candidate[]>][] = [
    ["Lyrics", Promise.resolve(lyrics)],
    ["Deezer", Promise.all(plan.searchTerms.map(deezerSearch)).then(interleave)],
  ];
  if (tiktokEnabled()) jobs.push(["TikTok", tiktokSounds(plan.hashtags)]);
  if (lastfmEnabled()) jobs.push(["Last.fm", Promise.all(plan.tags.map(lastfmTagTracks)).then(interleave)]);
  if (geniusEnabled()) jobs.push(["Genius", Promise.all(plan.searchTerms.map(geniusSearch)).then(interleave)]);

  const results = await Promise.allSettled(jobs.map(([, job]) => job));
  const found = results.flatMap((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.error(`${jobs[i][0]} source failed:`, result.reason);
    notes.push(`${jobs[i][0]} was unavailable this time.`);
    return [];
  });
  return [...plan.seedSongs, ...found];
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
        const notes: string[] = [];
        const plan = await buildPlan(await readInput(body), notes);
        send({ type: "analysis", caption: plan.scene, context: plan.context, keywords: plan.hashtags });

        send({ type: "status", message: tiktokEnabled() ? "Digging through TikTok hashtags…" : "Searching music libraries…" });
        const candidates = await gatherCandidates(plan, notes);

        let playlist: CuratedPlaylist;
        if (claudeEnabled()) {
          send({ type: "status", message: "Claude is picking the best songs…" });
          playlist = await curatePlaylist(plan, candidates).catch((err) => {
            console.error("Claude curation failed:", err);
            notes.push("Claude was unavailable, so songs were mixed automatically.");
            return mergeCandidates(candidates, plan.scene);
          });
        } else {
          playlist = mergeCandidates(candidates, plan.scene);
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
