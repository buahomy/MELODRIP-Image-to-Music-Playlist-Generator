import { readFileSync } from "node:fs";
import path from "node:path";
import type { Keyword } from "./keywords";

// Built by scripts/build_index.py: per term, flat [songIndex, weight*1e4, ...]
// sorted by weight, where weight is the song's l2-normalised TF-IDF value.
type LyricsIndex = {
  songs: [title: string, artist: string][];
  terms: Record<string, number[]>;
};

export type Song = { title: string; artist: string; score: number };

let index: LyricsIndex | null = null;

function loadIndex(): LyricsIndex {
  if (!index) {
    const file = path.join(process.cwd(), "data", "lyrics-index.json");
    index = JSON.parse(readFileSync(file, "utf8")) as LyricsIndex;
  }
  return index;
}

// Equivalent of songRecommender + printTopFive: sum each keyword's cosine
// similarity against every song's lyrics, then take the top n.
// Stems are looked up first, as in the original; the surface word is the fallback.
export function recommendSongs(keywords: Keyword[], n = 5): Song[] {
  const { songs, terms } = loadIndex();
  const scores = new Map<number, number>();
  for (const keyword of keywords) {
    const postings = terms[keyword.stem] ?? terms[keyword.word];
    if (!postings) continue;
    for (let i = 0; i < postings.length; i += 2) {
      const song = postings[i];
      scores.set(song, (scores.get(song) ?? 0) + postings[i + 1] / 10000);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([i, score]) => ({ title: songs[i][0], artist: songs[i][1], score }));
}
