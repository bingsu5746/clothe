import type { Env } from "../env";
import { HttpError, toBase64 } from "./util";

export interface GeminiImage {
  mimeType: string;
  data: Uint8Array;
}

type Schema = Record<string, unknown>;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** Gemini에 JSON 응답을 요청한다. schema는 Gemini responseSchema(OpenAPI 부분집합) 형식. */
export async function geminiJson<T>(env: Env, prompt: string, schema: Schema, images: GeminiImage[] = []): Promise<T> {
  if (!env.GEMINI_API_KEY) {
    throw new HttpError(503, "GEMINI_API_KEY가 설정되지 않았어요. Cloudflare 대시보드에서 시크릿을 추가해 주세요.");
  }
  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const parts: unknown[] = images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: toBase64(img.data) } }));
  parts.push({ text: prompt });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.7 },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (res.status === 429) {
    throw new HttpError(429, "Gemini 무료 사용량을 다 썼어요. 잠시 뒤나 내일 다시 시도해 주세요.");
  }
  if (!res.ok) {
    throw new HttpError(502, `Gemini 오류 (${res.status}): ${body.error?.message ?? "알 수 없는 오류"}`);
  }
  if (body.promptFeedback?.blockReason) {
    throw new HttpError(422, `Gemini가 요청을 거절했어요: ${body.promptFeedback.blockReason}`);
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, "Gemini 응답을 해석하지 못했어요. 다시 시도해 주세요.");
  }
}

export async function loadImage(env: Env, key: string): Promise<GeminiImage> {
  const obj = await env.BUCKET.get(key);
  if (!obj) throw new HttpError(404, "이미지를 찾을 수 없어요");
  return {
    mimeType: obj.httpMetadata?.contentType ?? "image/jpeg",
    data: new Uint8Array(await obj.arrayBuffer()),
  };
}

const str = { type: "STRING" };
const strArr = { type: "ARRAY", items: str };

const outfitList = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { title: str, item_ids: strArr, reason: str },
    required: ["title", "item_ids", "reason"],
  },
};

export const OUTFITS_SCHEMA: Schema = {
  type: "OBJECT",
  properties: { briefing: str, outfits: outfitList },
  required: ["briefing", "outfits"],
};

export const TAGGING_SCHEMA: Schema = {
  type: "OBJECT",
  properties: {
    name: str,
    category: str,
    sub_category: str,
    colors: strArr,
    material: str,
    fit: str,
    season: strArr,
    style_tags: strArr,
    warmth: { type: "INTEGER" },
  },
  required: ["name", "category", "sub_category", "colors", "material", "fit", "season", "style_tags", "warmth"],
};

export const INSPIRATION_SCHEMA: Schema = {
  type: "OBJECT",
  properties: {
    summary: str,
    pieces: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { category: str, description: str, colors: strArr, matched_item_ids: strArr },
        required: ["category", "description", "colors", "matched_item_ids"],
      },
    },
  },
  required: ["summary", "pieces"],
};

export const WISH_COMBOS_SCHEMA: Schema = {
  type: "OBJECT",
  properties: {
    verdict: str,
    similar_item_ids: strArr,
    outfits: outfitList,
  },
  required: ["verdict", "similar_item_ids", "outfits"],
};
