import { stemmer } from "stemmer";
import { STOPWORDS } from "./stopwords";

// Port of preprocessing / buildGraph / textRank / extractKeywords from Melodrip.py.

export type Keyword = { stem: string; word: string };

// Also remembers the first surface word behind each stem, since stems like
// "danc" aren't in the lyrics vocabulary but "dancing" is.
function preprocessing(text: string, surface: Map<string, string>): string[][] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.map((sentence) =>
    (sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((word) => !STOPWORDS.has(word))
      .map((word) => {
        const stem = stemmer(word);
        if (!surface.has(stem)) surface.set(stem, word);
        return stem;
      })
  );
}

// Every word in a sentence links to every other word. A word repeated within a
// sentence links to itself, as in networkx, which is what lifts its score.
function buildGraph(words: string[][]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const sentence of words) {
    for (const word of sentence) if (!graph.has(word)) graph.set(word, new Set());
  }
  for (const sentence of words) {
    sentence.forEach((word1, i) =>
      sentence.forEach((word2, j) => {
        if (i !== j) {
          graph.get(word1)!.add(word2);
          graph.get(word2)!.add(word1);
        }
      })
    );
  }
  return graph;
}

function textRank(graph: Map<string, Set<string>>, numIterations = 100, d = 0.85) {
  let scores = new Map<string, number>();
  for (const node of graph.keys()) scores.set(node, 1);
  for (let iter = 0; iter < numIterations; iter++) {
    const next = new Map<string, number>();
    for (const [node, neighbors] of graph) {
      let score = 1 - d;
      for (const neighbor of neighbors) {
        score += d * (scores.get(neighbor)! / graph.get(neighbor)!.size);
      }
      next.set(node, score);
    }
    scores = next;
  }
  return scores;
}

export function extractKeywords(text: string, numKeywords = 5): Keyword[] {
  const surface = new Map<string, string>();
  const scores = textRank(buildGraph(preprocessing(text, surface)));
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, numKeywords)
    .map(([stem]) => ({ stem, word: surface.get(stem)! }));
}

// For keywords chosen elsewhere (e.g. Claude's photo hashtags).
export function toKeywords(words: string[]): Keyword[] {
  return words.map((word) => ({ stem: stemmer(word), word }));
}
