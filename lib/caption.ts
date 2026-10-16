import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Photo captioning. Claude (vision) is used when ANTHROPIC_API_KEY is set;
// otherwise a vision model on Hugging Face Inference Providers (HF_TOKEN).
// The original BLIP model is no longer hosted by Hugging Face's API.
const CLAUDE_MODEL = "claude-sonnet-5-5";
const HF_MODEL = process.env.HF_CAPTION_MODEL ?? "google/gemma-4-26B-A4B-it";

const PROMPT =
  "Write a caption for this photo in one or two sentences (under 30 words): the main subject, what is happening, the setting, and the mood. Use plain, concrete words. Reply with the caption only.";

// Claude also picks the hashtags, since TextRank can't rank the words of a
// single long sentence (they all tie) and would just keep the first five.
const ClaudeCaption = z.object({
  caption: z.string().describe("One or two sentences, under 30 words: subject, action, setting, mood"),
  hashtags: z
    .array(z.string())
    .describe("3 to 5 single lowercase words, no #, most important first: the things and mood a song about this photo would mention"),
});

export type Caption = { caption: string; keywords?: string[] };

const CLAUDE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ClaudeImageType = (typeof CLAUDE_TYPES)[number];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class CaptionError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export async function fetchImage(url: string): Promise<{ bytes: ArrayBuffer; type: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CaptionError("That doesn't look like a valid image link.", 400);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CaptionError("Image links must start with http:// or https://.", 400);
  }
  const res = await fetch(parsed, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res?.ok) throw new CaptionError("Couldn't download that image.", 400);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!type.startsWith("image/")) throw new CaptionError("That link isn't an image.", 400);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new CaptionError("That image is too large (max 8 MB).", 400);
  return { bytes, type };
}

async function captionWithClaude(base64: string, type: string): Promise<Caption> {
  if (!CLAUDE_TYPES.includes(type as ClaudeImageType)) {
    throw new CaptionError("Use a JPEG, PNG, GIF or WebP image.", 400);
  }
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ClaudeCaption) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: type as ClaudeImageType, data: base64 } },
          { type: "text", text: "Caption this photo and choose its hashtags." },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new CaptionError("Couldn't describe that image. Try another one.", 400);
  }
  const { caption, hashtags } = response.parsed_output;
  const keywords = [...new Set(hashtags.map((h) => h.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean))];
  return { caption, keywords: keywords.slice(0, 5) };
}

async function captionWithHuggingFace(base64: string, type: string): Promise<string> {
  const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: HF_MODEL,
      max_tokens: 80,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${type};base64,${base64}` } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  }).catch(() => null);
  if (!res) throw new CaptionError("The captioning service didn't respond. Try again.");
  if (res.status === 402) throw new CaptionError("Photo captioning is out of Hugging Face credits.", 503);
  if (!res.ok) throw new CaptionError(`Captioning failed (${res.status}).`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function captionImage(bytes: ArrayBuffer, type: string): Promise<Caption> {
  const base64 = Buffer.from(bytes).toString("base64");
  let result: Caption;
  if (process.env.ANTHROPIC_API_KEY) result = await captionWithClaude(base64, type);
  else if (process.env.HF_TOKEN) result = { caption: await captionWithHuggingFace(base64, type) };
  else throw new CaptionError("Photo captioning isn't set up on the server.", 500);

  const caption = result.caption.replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
  if (!caption) throw new CaptionError("Couldn't describe that image. Try another one.");
  return { caption, keywords: result.keywords?.length ? result.keywords : undefined };
}
