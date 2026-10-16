export const SOURCES = ["tiktok", "lastfm", "genius", "deezer", "lyrics", "claude"] as const;
export type Source = (typeof SOURCES)[number];

// A song suggested by one of the sources, before Claude picks the playlist.
export type Candidate = {
  title: string;
  artist: string;
  source: Source;
  // Why this source suggested it, e.g. "in 12 #beach videos".
  detail?: string;
};

export const SOURCE_LABELS: Record<Source, string> = {
  tiktok: "TikTok",
  lastfm: "Last.fm",
  genius: "Genius",
  deezer: "Deezer",
  lyrics: "Lyrics",
  claude: "Claude",
};

export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}
