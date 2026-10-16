import { getJson, type Candidate } from "./types";

// TikTok has no public API for the sounds used under a hashtag, so this runs
// an Apify scraper actor (pay per result). Swap actors with APIFY_TIKTOK_ACTOR;
// any actor returning items with `musicMeta` works.
const ACTOR = process.env.APIFY_TIKTOK_ACTOR ?? "clockworks~tiktok-scraper";
const PER_QUERY = Number(process.env.TIKTOK_RESULTS_PER_HASHTAG ?? 20);
const MAX_QUERIES = 4; // hashtags + keyword searches per playlist, to cap cost
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type Video = {
  playCount?: number;
  searchHashtag?: { name?: string };
  searchQuery?: string;
  musicMeta?: { musicName?: string; musicAuthor?: string; musicOriginal?: boolean };
};

type Sound = { title: string; artist: string; videos: number; plays: number; score: number; original: boolean; found: Set<string> };

// Per-instance cache: the same search shouldn't be paid for twice in a row.
const cache = new Map<string, { at: number; candidates: Candidate[] }>();

export const tiktokEnabled = () => Boolean(process.env.APIFY_TOKEN);

export function toHashtag(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function formatPlays(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

// Hashtag feeds give recent posts; keyword searches ("maddy perez edit") give
// TikTok's top videos, which is where a subject's signature audio shows up.
export async function tiktokSounds(hashtagWords: string[], searches: string[] = []): Promise<Candidate[]> {
  const searchQueries = [...new Set(searches.map((q) => q.trim()).filter(Boolean))].slice(0, 2);
  const hashtags = [...new Set(hashtagWords.map(toHashtag).filter((t) => t.length > 2))].slice(
    0,
    Math.max(1, Math.min(3, MAX_QUERIES - searchQueries.length))
  );
  if (!hashtags.length && !searchQueries.length) return [];
  const key = [...hashtags, "|", ...searchQueries].join(",").toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.candidates;

  const videos = await getJson<Video[]>(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=100`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        hashtags,
        ...(searchQueries.length ? { searchQueries, searchSection: "/video" } : {}),
        resultsPerPage: PER_QUERY,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSlideshowImages: false,
        shouldDownloadAvatars: false,
        shouldDownloadMusicCovers: false,
      }),
    },
    110000
  );

  // Each video adds log10(views) to its sound's score, so an audio used in a
  // few viral edits beats one used in many videos nobody watched.
  const sounds = new Map<string, Sound>();
  for (const video of videos) {
    const title = video.musicMeta?.musicName?.trim();
    const artist = video.musicMeta?.musicAuthor?.trim() ?? "";
    if (!title) continue;
    const id = `${title}|${artist}`.toLowerCase();
    const sound =
      sounds.get(id) ??
      { title, artist, videos: 0, plays: 0, score: 0, original: Boolean(video.musicMeta?.musicOriginal), found: new Set<string>() };
    const plays = video.playCount ?? 0;
    sound.videos += 1;
    sound.plays += plays;
    sound.score += Math.log10(plays + 10);
    if (video.searchHashtag?.name) sound.found.add(`#${video.searchHashtag.name}`);
    if (video.searchQuery) sound.found.add(`"${video.searchQuery}"`);
    sounds.set(id, sound);
  }

  const candidates = [...sounds.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map<Candidate>((s) => ({
      title: s.title,
      artist: s.artist,
      source: "tiktok",
      detail:
        `in ${s.videos} ${s.found.size ? [...s.found].join(" / ") : "TikTok"} video${s.videos === 1 ? "" : "s"}, ${formatPlays(s.plays)} views` +
        (s.original ? " (creator's original sound)" : ""),
    }));
  cache.set(key, { at: Date.now(), candidates });
  return candidates;
}
