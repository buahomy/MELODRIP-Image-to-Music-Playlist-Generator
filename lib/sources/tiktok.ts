import { getJson, type Candidate } from "./types";

// TikTok has no public API for the sounds used under a hashtag, so this runs
// an Apify scraper actor (pay per result). Swap actors with APIFY_TIKTOK_ACTOR;
// any actor returning items with `musicMeta` works.
const ACTOR = process.env.APIFY_TIKTOK_ACTOR ?? "clockworks~tiktok-scraper";
const PER_HASHTAG = Number(process.env.TIKTOK_RESULTS_PER_HASHTAG ?? 20);
const MAX_HASHTAGS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type Video = {
  playCount?: number;
  searchHashtag?: { name?: string };
  musicMeta?: { musicName?: string; musicAuthor?: string; musicOriginal?: boolean };
};

type Sound = { title: string; artist: string; videos: number; plays: number; original: boolean; tags: Set<string> };

// Per-instance cache: the same hashtag shouldn't be paid for twice in a row.
const cache = new Map<string, { at: number; candidates: Candidate[] }>();

export const tiktokEnabled = () => Boolean(process.env.APIFY_TOKEN);

export function toHashtag(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export async function tiktokSounds(keywords: string[]): Promise<Candidate[]> {
  const hashtags = [...new Set(keywords.map(toHashtag).filter((t) => t.length > 2))].slice(0, MAX_HASHTAGS);
  if (!hashtags.length) return [];
  const key = hashtags.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.candidates;

  const videos = await getJson<Video[]>(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=100`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        hashtags,
        resultsPerPage: PER_HASHTAG,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSlideshowImages: false,
        shouldDownloadAvatars: false,
        shouldDownloadMusicCovers: false,
      }),
    },
    110000
  );

  // Rank sounds by how many of the scraped videos use them.
  const sounds = new Map<string, Sound>();
  for (const video of videos) {
    const title = video.musicMeta?.musicName?.trim();
    const artist = video.musicMeta?.musicAuthor?.trim() ?? "";
    if (!title) continue;
    const id = `${title}|${artist}`.toLowerCase();
    const sound = sounds.get(id) ?? { title, artist, videos: 0, plays: 0, original: Boolean(video.musicMeta?.musicOriginal), tags: new Set<string>() };
    sound.videos += 1;
    sound.plays += video.playCount ?? 0;
    if (video.searchHashtag?.name) sound.tags.add(video.searchHashtag.name);
    sounds.set(id, sound);
  }

  const candidates = [...sounds.values()]
    .sort((a, b) => b.videos - a.videos || b.plays - a.plays)
    .slice(0, 30)
    .map<Candidate>((s) => ({
      title: s.title,
      artist: s.artist,
      source: "tiktok",
      detail:
        `in ${s.videos} ${s.tags.size ? [...s.tags].map((t) => `#${t}`).join(" ") : "hashtag"} video${s.videos === 1 ? "" : "s"}` +
        (s.original ? " (creator's original sound)" : ""),
    }));
  cache.set(key, { at: Date.now(), candidates });
  return candidates;
}
