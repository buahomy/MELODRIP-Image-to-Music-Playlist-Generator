import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SOURCES, type Candidate } from "./sources/types";
import type { SearchPlan } from "./understand";

const MODEL = "claude-sonnet-5-5";
const PLAYLIST_SIZE = 20;

const Playlist = z.object({
  name: z.string().describe("Short, evocative playlist title"),
  description: z.string().describe("One sentence describing the vibe"),
  songs: z.array(
    z.object({
      title: z.string().describe("Official song title as released"),
      artist: z.string().describe("Primary artist as credited on streaming services"),
      source: z.enum(SOURCES).describe('Where the pick came from; "claude" for your own additions'),
      reason: z.string().describe("Under 10 words: why it fits, e.g. 'trending on #beach'"),
    })
  ),
});

export type CuratedPlaylist = z.infer<typeof Playlist>;

const SYSTEM = `You build playlists for Melodrip, an app that turns a photo or a few words into music.

You get the scene (an image caption or the user's own words), what it refers to (context), its hashtags, and candidate songs from several sources:
- claude: songs and audios already identified as strongly tied to the subject, such as famous TikTok edit audios or a show's soundtrack.
- tiktok: sounds used in TikTok videos under the keywords' hashtags, ranked by how many videos use them. Some are creators' "original sound" clips, not released songs. Keep a sound only when you can tell which released song it is (often the title or author names it, e.g. a sped-up version), and list it under that song's official title and artist.
- lastfm: tracks listeners tagged with a keyword.
- genius / deezer: title or lyric matches for a keyword.
- lyrics: matches from a lyrics TF-IDF index.

Pick ${PLAYLIST_SIZE} songs that fit what the input means, not just its literal words. When the input names a person, character, show or aesthetic, the playlist should feel like that subject's edits and soundtrack: lead with the strongly tied songs and the TikTok sounds that are real songs, and leave out candidates that only share a word with it. For a plain scene, match its mood. You may add well-known songs of your own (source "claude") to fill gaps. Together with the strongly tied songs, "claude" picks should be at most half the list. No duplicates, no more than two songs per artist, and only songs that are really released and findable on Spotify. Order the list so it flows well as a playlist.`;

export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function curatePlaylist(plan: SearchPlan, candidates: Candidate[]): Promise<CuratedPlaylist> {
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const lines = candidates.map((c) => `- [${c.source}] "${c.title}" by ${c.artist || "unknown"}${c.detail ? ` (${c.detail})` : ""}`);
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Playlist) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Scene: ${plan.scene}\n${plan.context ? `Context: ${plan.context}\n` : ""}Hashtags: ${plan.hashtags.map((h) => `#${h}`).join(" ")}\n\nCandidates:\n${lines.join("\n") || "(none: pick songs yourself)"}`,
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Claude returned no playlist (${response.stop_reason})`);
  }
  return response.parsed_output;
}

// Used when Claude isn't configured or fails: take the sources in turn,
// skipping TikTok's original-sound clips and duplicates.
export function mergeCandidates(candidates: Candidate[], scene: string): CuratedPlaylist {
  const bySource = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.source === "tiktok" && (c.detail?.includes("original sound") || /^original sound\b/i.test(c.title))) continue;
    bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
  }
  const queues = [...bySource.values()];
  const seen = new Set<string>();
  const songs: CuratedPlaylist["songs"] = [];
  while (songs.length < PLAYLIST_SIZE && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (!c) continue;
      const id = `${c.title}|${c.artist}`.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      songs.push({ title: c.title, artist: c.artist, source: c.source, reason: c.detail ?? "" });
    }
  }
  return { name: "Melodrip Mix", description: scene, songs: songs.slice(0, PLAYLIST_SIZE) };
}
