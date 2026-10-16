// Server-side Spotify catalog search with the client-credentials flow. Saving
// playlists happens in the browser with the user's own login (lib/spotify-auth.ts).

export type SpotifyTrack = { id: string; uri: string; url: string; image?: string; album: string };

let token: { value: string; expires: number } | null = null;

export const spotifyEnabled = () =>
  Boolean(process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

async function accessToken() {
  if (token && Date.now() < token.expires) return token.value;
  const auth = Buffer.from(
    `${process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return token.value;
}

type SearchResponse = {
  tracks?: {
    items: {
      id: string;
      uri: string;
      external_urls: { spotify: string };
      album: { name: string; images: { url: string; width: number }[] };
    }[];
  };
};

async function search(q: string): Promise<SpotifyTrack | null> {
  const res = await fetch(`https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
  const item = ((await res.json()) as SearchResponse).tracks?.items[0];
  if (!item) return null;
  const images = [...item.album.images].sort((a, b) => a.width - b.width);
  return {
    id: item.id,
    uri: item.uri,
    url: item.external_urls.spotify,
    image: (images.find((i) => i.width >= 128) ?? images.at(-1))?.url,
    album: item.album.name,
  };
}

// Exact title/artist match first, then a looser free-text search.
export async function findTrack(title: string, artist: string): Promise<SpotifyTrack | null> {
  const clean = (s: string) => s.replace(/["()[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (
    (await search(`track:${clean(title)}${artist ? ` artist:${clean(artist)}` : ""}`)) ??
    (await search(`${clean(title)} ${clean(artist)}`))
  );
}
