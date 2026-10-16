import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { extractKeywords, toKeywords, type Keyword } from "./keywords";
import type { Candidate } from "./sources/types";

// Turns the user's input into a search plan before any song source is queried.
// Splitting "maddy perez" into #maddy and #perez finds nothing; knowing it's a
// Euphoria character finds #euphoria edits, the baddie aesthetic and the show's
// soundtrack. Each source gets the part of the plan it's good at.

const MODEL = "claude-sonnet-5-5";

export type SearchPlan = {
  scene: string; // the photo caption, or the user's own words
  context?: string; // what the input refers to, when it's more than a literal scene
  hashtags: string[]; // TikTok hashtags
  searchTerms: string[]; // phrases for Deezer and Genius
  tags: string[]; // Last.fm tags (mood, genre, aesthetic)
  lyricKeywords: Keyword[]; // the original lyrics TF-IDF index
  seedSongs: Candidate[]; // songs and audios known to be tied to the subject
};

export type UnderstandInput = { text: string } | { image: { base64: string; type: string } };

export const CLAUDE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ClaudeImageType = (typeof CLAUDE_IMAGE_TYPES)[number];

const Plan = z.object({
  scene: z
    .string()
    .describe("For a photo: a 1-2 sentence caption (subject, action, setting, mood). For text: the user's text, unchanged"),
  context: z
    .string()
    .describe("One sentence on what the input refers to and what people associate with it (a person, character, show, meme, aesthetic, era). Empty for a plain everyday scene"),
  hashtags: z
    .array(z.string())
    .describe("3-4 TikTok hashtags people really use for this, most relevant first, lowercase, no # or spaces (e.g. maddyperez, euphoria, baddie)"),
  search_terms: z
    .array(z.string())
    .describe("2-4 short phrases for a music search engine, e.g. 'euphoria soundtrack', 'baddie anthem', 'beach sunset'"),
  tags: z
    .array(z.string())
    .describe("2-4 Last.fm-style tags for the mood, genre or aesthetic, e.g. 'rnb', 'sexy', 'dark pop', 'summer'"),
  lyric_words: z
    .array(z.string())
    .describe("3-5 single English words that songs about this would use in their lyrics"),
  seed_songs: z
    .array(
      z.object({
        title: z.string(),
        artist: z.string(),
        why: z.string().describe("Under 10 words, e.g. 'viral Maddy Perez edit audio'"),
      })
    )
    .describe("Up to 8 released songs strongly tied to the subject that you are confident exist: audios famous in edits or trends about it, its soundtrack, or songs that define its vibe. Empty if nothing specific"),
});

const SYSTEM = `You plan music searches for Melodrip, an app that turns a photo or a few words into a playlist.

Work out what the input refers to before choosing search terms. People type names, characters, shows, films, memes, aesthetics and eras, and expect the playlist to match what everyone associates with them, especially on TikTok. For example, "maddy perez" is Maddy Perez, a character from HBO's Euphoria: search for hashtags like maddyperez and euphoria, the "baddie" aesthetic, the show's soundtrack, and the audios famously used in Maddy edits, never the separate words "maddy" and "perez". A plain scene ("beach at sunset", or a photo of a dog) needs no context: use its subject and mood.

For a photo, also notice anything recognisable (a famous person, a character, a film still, a landmark, a meme) and plan around it.`;

function cleanTag(tag: string) {
  return tag.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function unique(items: string[], max: number) {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))].slice(0, max);
}

export async function understandWithClaude(input: UnderstandInput): Promise<SearchPlan> {
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  let content: Anthropic.Beta.BetaContentBlockParam[];
  if ("text" in input) {
    content = [{ type: "text", text: `User's input: ${input.text}` }];
  } else {
    if (!CLAUDE_IMAGE_TYPES.includes(input.image.type as ClaudeImageType)) {
      throw new Error(`Unsupported image type ${input.image.type}`);
    }
    content = [
      { type: "image", source: { type: "base64", media_type: input.image.type as ClaudeImageType, data: input.image.base64 } },
      { type: "text", text: "The user's input is this photo." },
    ];
  }

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Plan) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Claude returned no search plan (${response.stop_reason})`);
  }
  const p = response.parsed_output;
  const scene = "text" in input ? input.text : p.scene.replace(/^["“]|["”]$/g, "").trim();
  return {
    scene,
    context: p.context.trim() || undefined,
    hashtags: unique(p.hashtags.map(cleanTag), 4),
    searchTerms: unique(p.search_terms, 4),
    tags: unique(p.tags.map((t) => t.toLowerCase()), 4),
    lyricKeywords: toKeywords(unique(p.lyric_words.map((w) => w.toLowerCase()), 5)),
    seedSongs: p.seed_songs.slice(0, 8).map((s) => ({ title: s.title, artist: s.artist, source: "claude", detail: s.why })),
  };
}

// Without Claude: TextRank keywords, plus the whole input as one hashtag and
// one search phrase when it's short, so names like "maddy perez" stay intact.
export function planFromText(scene: string): SearchPlan {
  const lyricKeywords = extractKeywords(scene);
  const words = lyricKeywords.map((k) => k.word);
  const wordCount = scene.trim().split(/\s+/).length;
  const whole = wordCount > 1 && wordCount <= 4 ? scene.trim() : null;
  return {
    scene,
    hashtags: unique([...(whole ? [cleanTag(whole)] : []), ...words.map(cleanTag)], 4),
    searchTerms: unique([...(wordCount <= 6 ? [scene.trim()] : []), ...words], 4),
    tags: words.slice(0, 4),
    lyricKeywords,
    seedSongs: [],
  };
}
