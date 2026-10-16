"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaylistEvent, PlaylistSong } from "./api/playlist/route";
import { SOURCE_LABELS, type Source } from "@/lib/sources/types";
import {
  completeSpotifyLogin,
  savePlaylist,
  SpotifySaveError,
  spotifySaveEnabled,
  spotifyToken,
  startSpotifyLogin,
} from "@/lib/spotify-auth";

type Mode = "image" | "text";
type Analysis = { caption: string; keywords: string[]; preview: string | null };
type Playlist = Extract<PlaylistEvent, { type: "playlist" }>;
type SaveState = { status: "idle" | "saving" | "error" | "saved"; message?: string; url?: string };

const MAX_SIDE = 1024;
const PENDING_KEY = "melodrip-pending-save";

// Shrink photos before upload: iPhone images are often 5-10 MB, over Vercel's
// request limit, and BLIP doesn't need more than this anyway.
async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function songLink(song: PlaylistSong) {
  return song.spotify?.url ?? `https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("image");
  const [photo, setPhoto] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("melodrip-mode");
      if (saved === "image" || saved === "text") setMode(saved);
    } catch {}

    // Returning from the Spotify login: restore the playlist and save it.
    completeSpotifyLogin().then((login) => {
      if (login === "none") return;
      let pending: { analysis: Analysis; playlist: Playlist } | null = null;
      try {
        pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
        sessionStorage.removeItem(PENDING_KEY);
      } catch {}
      if (!pending) return;
      setAnalysis(pending.analysis);
      setPlaylist(pending.playlist);
      if (login === "ok") saveToSpotify(pending.playlist);
      else setSave({ status: "error", message: "Spotify login was cancelled." });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    try {
      localStorage.setItem("melodrip-mode", next);
    } catch {}
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      setPhoto(await downscale(file));
      setImageUrl("");
    } catch {
      setError("Couldn't open that photo. Try a different one.");
    }
  }

  const trimmedUrl = imageUrl.trim();
  const canSubmit = mode === "text" ? text.trim().length > 0 : Boolean(photo || trimmedUrl);

  async function generate() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setPlaylist(null);
    setSave({ status: "idle" });
    setStatus(mode === "image" ? "Looking at your photo…" : "Reading your words…");
    const preview = mode === "image" ? photo ?? trimmedUrl : null;
    const body = mode === "text" ? { mode, text } : photo ? { mode, imageData: photo } : { mode, imageUrl: trimmedUrl };

    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error("Something went wrong.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as PlaylistEvent;
          if (event.type === "analysis") {
            setAnalysis({ caption: event.caption, keywords: event.keywords, preview });
            requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          } else if (event.type === "status") setStatus(event.message);
          else if (event.type === "playlist") setPlaylist(event);
          else if (event.type === "error") throw new Error(event.error);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  async function saveToSpotify(list: Playlist) {
    const uris = list.songs.flatMap((s) => (s.spotify ? [s.spotify.uri] : []));
    if (!spotifyToken()) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ analysis, playlist: list }));
      } catch {}
      await startSpotifyLogin();
      return;
    }
    setSave({ status: "saving" });
    try {
      const url = await savePlaylist(list.name, list.description, uris);
      setSave({ status: "saved", url });
    } catch (err) {
      setSave({
        status: "error",
        message: err instanceof SpotifySaveError ? err.message : "Couldn't reach Spotify. Try again.",
      });
    }
  }

  async function copyLinks(list: Playlist) {
    const links = list.songs.map(songLink).join("\n");
    try {
      await navigator.clipboard.writeText(links);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  }

  const resolved = playlist?.songs.filter((s) => s.spotify).length ?? 0;

  return (
    <main className="screen">
      <header className="nav">
        <h1>Melodrip</h1>
        <p>Turn a moment into a playlist.</p>
      </header>

      <div className="segmented" role="tablist" aria-label="Input type">
        <span className="segmented-thumb" data-pos={mode} aria-hidden />
        <button role="tab" aria-selected={mode === "image"} onClick={() => switchMode("image")}>
          Photo
        </button>
        <button role="tab" aria-selected={mode === "text"} onClick={() => switchMode("text")}>
          Text
        </button>
      </div>

      {mode === "image" ? (
        <section className="group">
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={onPickPhoto} />
          {photo ? (
            <div className="photo-picked">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Selected photo" />
              <div className="photo-actions">
                <button className="link" onClick={() => fileInput.current?.click()}>
                  Change Photo
                </button>
                <button className="link destructive" onClick={() => setPhoto(null)}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button className="photo-drop" onClick={() => fileInput.current?.click()}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="3" y="5" width="18" height="15" rx="3" />
                <circle cx="12" cy="12.5" r="3.5" />
                <path d="M8.5 5l1.2-2h4.6l1.2 2" />
              </svg>
              <span>Choose or Take a Photo</span>
            </button>
          )}
          {!photo && (
            <label className="row-field">
              <span>Link</span>
              <input
                type="url"
                inputMode="url"
                placeholder="Or paste an image URL"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generate()}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
          )}
        </section>
      ) : (
        <section className="group">
          <textarea
            className="text-input"
            placeholder="Describe a scene, a mood, a memory…  e.g. “dancing barefoot on the beach at sunset”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={2000}
          />
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <button className="primary" disabled={!canSubmit || loading} onClick={generate}>
        {loading ? <span className="spinner" aria-label="Loading" /> : "Make Playlist"}
      </button>

      {analysis && (
        <section ref={resultsRef} className="results">
          <h2 className="group-title">{analysis.preview ? "What We Saw" : "What You Said"}</h2>
          <div className="group seen">
            {analysis.preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={analysis.preview} alt="" className="seen-thumb" />
            )}
            <div className="seen-text">
              <p className="caption">“{analysis.caption}”</p>
              {analysis.keywords.length > 0 && (
                <div className="chips">
                  {analysis.keywords.map((k) => (
                    <span key={k} className="chip">#{k}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {status && (
            <p className="status" role="status">
              <span className="spinner small" aria-hidden /> {status}
            </p>
          )}

          {playlist && (
            <>
              <h2 className="group-title">{playlist.name}</h2>
              {playlist.songs.length === 0 ? (
                <div className="group empty">No matching songs. Try a different photo or more words.</div>
              ) : (
                <ol className="group list">
                  {playlist.songs.map((song, i) => (
                    <li key={`${song.title}-${song.artist}-${i}`}>
                      <a className="song" href={songLink(song)} target="_blank" rel="noreferrer">
                        {song.spotify?.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="art" src={song.spotify.image} alt="" loading="lazy" />
                        ) : (
                          <span className="art art-empty">{i + 1}</span>
                        )}
                        <span className="song-info">
                          <span className="song-title">{song.title}</span>
                          <span className="song-artist">{song.artist}</span>
                          <span className="song-reason">
                            <span className={`badge badge-${song.source}`}>{SOURCE_LABELS[song.source as Source]}</span>
                            {song.reason}
                          </span>
                        </span>
                        <svg className="chevron" width="8" height="14" viewBox="0 0 8 14" aria-hidden>
                          <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
              <p className="group-footer">
                {playlist.description}
                {playlist.notes.length > 0 && <> {playlist.notes.join(" ")}</>}
              </p>

              {playlist.songs.length > 0 && (
                <div className="actions">
                  {spotifySaveEnabled && resolved > 0 && (
                    <button
                      className="primary spotify-button"
                      disabled={save.status === "saving"}
                      onClick={() => saveToSpotify(playlist)}
                    >
                      {save.status === "saving" ? <span className="spinner" aria-label="Saving" /> : "Save to Spotify"}
                    </button>
                  )}
                  <button className="secondary" onClick={() => copyLinks(playlist)}>
                    {copied ? "Copied!" : "Copy Spotify Links"}
                  </button>
                  {save.status === "saved" && (
                    <a className="saved" href={save.url} target="_blank" rel="noreferrer">
                      Saved to your library. Open in Spotify ›
                    </a>
                  )}
                  {save.status === "error" && <p className="error">{save.message}</p>}
                  <p className="hint">Paste the links into a Spotify playlist on desktop to add them all at once.</p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <footer className="footnote">Sources: TikTok, Last.fm, Genius, Deezer, and lyrics · curated by Claude</footer>
    </main>
  );
}
