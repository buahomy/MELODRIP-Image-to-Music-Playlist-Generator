// Image input helpers, plus backup photo captioning on Hugging Face Inference
// Providers (HF_TOKEN) for when Claude isn't configured. With Claude, the
// photo is captioned as part of the search plan (lib/understand.ts). The
// original BLIP model is no longer hosted by Hugging Face's API.
const HF_MODEL = process.env.HF_CAPTION_MODEL ?? "google/gemma-4-26B-A4B-it";

const PROMPT =
  "Write a caption for this photo in one or two sentences (under 30 words): the main subject, what is happening, the setting, and the mood. Use plain, concrete words. Reply with the caption only.";

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

export const hfCaptionEnabled = () => Boolean(process.env.HF_TOKEN);

export async function captionWithHuggingFace(base64: string, type: string): Promise<string> {
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
  const caption = (data.choices?.[0]?.message?.content ?? "").replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
  if (!caption) throw new CaptionError("Couldn't describe that image. Try another one.");
  return caption;
}
