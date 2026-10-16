// Browser-only: log in with Spotify (Authorization Code + PKCE, no secret)
// and save a playlist to the user's account. While the app is in Spotify's
// Development Mode, only accounts on its allowlist (max 5) can do this.

const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
const SCOPES = "playlist-modify-private playlist-modify-public";
const VERIFIER_KEY = "melodrip-spotify-verifier";
const TOKEN_KEY = "melodrip-spotify-token";

export const spotifySaveEnabled = Boolean(CLIENT_ID);

const redirectUri = () => `${window.location.origin}/`;

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}

function load(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startSpotifyLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  store(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

// Call on page load: finishes a login if Spotify just redirected back here.
export async function completeSpotifyLogin(): Promise<"none" | "ok" | "denied"> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code && !error) return "none";
  window.history.replaceState(null, "", "/");
  const verifier = load(VERIFIER_KEY);
  store(VERIFIER_KEY, null);
  if (error || !code || !verifier) return "denied";

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return "denied";
  const data = (await res.json()) as { access_token: string; expires_in: number };
  store(TOKEN_KEY, JSON.stringify({ value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 }));
  return "ok";
}

export function spotifyToken(): string | null {
  const raw = load(TOKEN_KEY);
  if (!raw) return null;
  const token = JSON.parse(raw) as { value: string; expires: number };
  return Date.now() < token.expires ? token.value : null;
}

export class SpotifySaveError extends Error {}

export async function savePlaylist(name: string, description: string, uris: string[]): Promise<string> {
  const token = spotifyToken();
  if (!token) throw new SpotifySaveError("Your Spotify login expired. Tap Save again.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const created = await fetch("https://api.spotify.com/v1/me/playlists", {
    method: "POST",
    headers,
    body: JSON.stringify({ name, description: description.slice(0, 300), public: false }),
  });
  if (created.status === 403) {
    throw new SpotifySaveError("This Spotify account isn't on the app's allowlist yet. Use Copy Links instead.");
  }
  if (!created.ok) throw new SpotifySaveError(`Spotify couldn't create the playlist (${created.status}).`);
  const playlist = (await created.json()) as { id: string; external_urls: { spotify: string } };

  const added = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/items`, {
    method: "POST",
    headers,
    body: JSON.stringify({ uris: uris.slice(0, 100) }),
  });
  if (!added.ok) throw new SpotifySaveError(`The playlist was created but songs couldn't be added (${added.status}).`);
  return playlist.external_urls.spotify;
}
