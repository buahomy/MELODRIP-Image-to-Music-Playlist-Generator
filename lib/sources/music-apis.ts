import { getJson, type Candidate } from "./types";

// Free keyword-to-song sources. Each runs once per keyword and fails quietly,
// so a missing key or a down service only removes that source's suggestions.

export const lastfmEnabled = () => Boolean(process.env.LASTFM_API_KEY);
export const geniusEnabled = () => Boolean(process.env.GENIUS_ACCESS_TOKEN);

// Songs listeners have tagged with the word ("beach", "rain", "roadtrip").
export async function lastfmTagTracks(keyword: string): Promise<Candidate[]> {
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.search = new URLSearchParams({
    method: "tag.gettoptracks",
    tag: keyword,
    api_key: process.env.LASTFM_API_KEY!,
    format: "json",
    limit: "10",
  }).toString();
  const data = await getJson<{ tracks?: { track?: { name: string; artist: { name: string } }[] } }>(url.toString());
  return (data.tracks?.track ?? []).map((t) => ({
    title: t.name,
    artist: t.artist.name,
    source: "lastfm",
    detail: `top track tagged "${keyword}"`,
  }));
}

// Genius search matches song titles and lyrics.
export async function geniusSearch(keyword: string): Promise<Candidate[]> {
  const data = await getJson<{
    response?: { hits?: { result: { title: string; primary_artist: { name: string } } }[] };
  }>(`https://api.genius.com/search?q=${encodeURIComponent(keyword)}`, {
    headers: { Authorization: `Bearer ${process.env.GENIUS_ACCESS_TOKEN}` },
  });
  return (data.response?.hits ?? []).slice(0, 6).map((h) => ({
    title: h.result.title,
    artist: h.result.primary_artist.name,
    source: "genius",
    detail: `matches "${keyword}" on Genius`,
  }));
}

// Deezer's public search needs no key.
export async function deezerSearch(keyword: string): Promise<Candidate[]> {
  const data = await getJson<{ data?: { title: string; artist: { name: string } }[] }>(
    `https://api.deezer.com/search?q=${encodeURIComponent(keyword)}&limit=8`
  );
  return (data.data ?? []).map((t) => ({
    title: t.title,
    artist: t.artist.name,
    source: "deezer",
    detail: `popular match for "${keyword}"`,
  }));
}
