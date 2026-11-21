import type { Env } from "../env";
import { fetchWithRetry, HttpError, toBase64 } from "./util";
import { isRecord } from "./validate";
import { loadImage as loadR2Image, type LoadedImage } from "./images";

export type GeminiImage = LoadedImage;
export type Schema = Record<string, unknown>;

const GEMINI_TIMEOUT_MS = 45000;
/** Gemini에 한 번에 보내는 이미지 한 장의 최대 크기 */
export const GEMINI_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
/**
 * 요청 하나에 넣는 이미지 원본 바이트 합계 상한.
 * 문서(https://ai.google.dev/gemini-api/docs/image-understanding, 2026-11-16 확인):
 * "Inline image data limits your total request size (text prompts, system instructions, and inline bytes) to 20MB."
 * base64는 4/3배로 커지므로 원본 13MB → 약 17.3MB + 프롬프트 여유.
 */
export const GEMINI_INLINE_TOTAL_MAX_BYTES = 13 * 1024 * 1024;

const BLOCK_FINISH_REASONS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);

export function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function buildGeminiBody(prompt: string, schema: Schema, images: GeminiImage[], temperature: number): Record<string, unknown> {
  const parts: Record<string, unknown>[] = images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: toBase64(img.data) } }));
  parts.push({ text: prompt });
  return {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature },
  };
}

function errorMessage(body: unknown): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") return body.error.message.slice(0, 300);
  return "알 수 없는 오류";
}

/** 모델이 JSON 앞뒤에 ```json 을 붙여도 읽을 수 있게 벗겨 낸다 */
export function extractJsonText(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : t;
}

/**
 * Gemini generateContent 응답(HTTP 상태 + 본문)을 해석해서 JSON 값을 돌려준다.
 * 실패 종류별로 다른 HttpError를 던진다: 429(한도), 422(안전 필터), 502(그 밖의 오류/깨진 JSON).
 */
export function parseGeminiJsonResponse(status: number, body: unknown): unknown {
  if (status === 429) throw new HttpError(429, "Gemini 무료 사용량을 다 썼어요. 잠시 뒤나 내일 다시 시도해 주세요.");
  if (status === 401 || status === 403) throw new HttpError(502, `Gemini API 키를 확인해 주세요 (${status}): ${errorMessage(body)}`);
  if (status < 200 || status >= 300) throw new HttpError(502, `Gemini 오류 (${status}): ${errorMessage(body)}`);
  if (!isRecord(body)) throw new HttpError(502, "Gemini 응답을 해석하지 못했어요. 다시 시도해 주세요.");

  if (isRecord(body.promptFeedback) && typeof body.promptFeedback.blockReason === "string") {
    throw new HttpError(422, `Gemini가 이 요청을 처리하지 않았어요 (안전 필터: ${body.promptFeedback.blockReason}). 다른 사진으로 시도해 주세요.`);
  }
  const candidate: unknown = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  if (!isRecord(candidate)) throw new HttpError(502, "Gemini가 빈 응답을 보냈어요. 다시 시도해 주세요.");
  const finish = typeof candidate.finishReason === "string" ? candidate.finishReason : "";
  if (BLOCK_FINISH_REASONS.has(finish)) {
    throw new HttpError(422, `Gemini가 답변을 중단했어요 (안전 필터: ${finish}). 다른 사진이나 표현으로 시도해 주세요.`);
  }
  const parts: unknown[] = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map((p) => (isRecord(p) && typeof p.text === "string" && p.thought !== true ? p.text : "")).join("");
  if (!text.trim()) {
    if (finish === "MAX_TOKENS") throw new HttpError(502, "Gemini 응답이 너무 길어서 중간에 끊겼어요. 다시 시도해 주세요.");
    throw new HttpError(502, "Gemini가 빈 응답을 보냈어요. 다시 시도해 주세요.");
  }
  try {
    return JSON.parse(extractJsonText(text)) as unknown;
  } catch {
    if (finish === "MAX_TOKENS") throw new HttpError(502, "Gemini 응답이 너무 길어서 중간에 끊겼어요. 다시 시도해 주세요.");
    throw new HttpError(502, "Gemini 응답을 해석하지 못했어요. 다시 시도해 주세요.");
  }
}

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export function geminiModel(env: Pick<Env, "GEMINI_MODEL">): string {
  return env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function requireGeminiKey(env: Env): string {
  if (!env.GEMINI_API_KEY) {
    throw new HttpError(503, "GEMINI_API_KEY가 설정되지 않았어요. Cloudflare 대시보드에서 시크릿을 추가해 주세요.");
  }
  return env.GEMINI_API_KEY;
}

/**
 * Gemini에 JSON 응답을 요청한다. schema는 Gemini responseSchema(OpenAPI 부분집합) 형식.
 * 돌려주는 값은 검증되지 않은 unknown이므로 호출하는 쪽에서 반드시 정리(sanitize)해서 쓴다.
 * 타임아웃 45초, 5xx/네트워크 오류면 한 번 재시도.
 */
export async function geminiJson(env: Env, prompt: string, schema: Schema, images: GeminiImage[] = [], temperature = 0.7): Promise<unknown> {
  const key = requireGeminiKey(env);
  const total = images.reduce((n, img) => n + img.data.byteLength, 0);
  if (total > GEMINI_INLINE_TOTAL_MAX_BYTES) throw new HttpError(413, "사진이 너무 커서 AI에 보낼 수 없어요. 더 작은 사진으로 다시 시도해 주세요.");
  const model = geminiModel(env);
  const res = await fetchWithRetry(
    geminiUrl(model),
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(buildGeminiBody(prompt, schema, images, temperature)),
    },
    { timeoutMs: GEMINI_TIMEOUT_MS, retries: 1, label: "Gemini" },
  );
  const body: unknown = await res.json().catch(() => null);
  return parseGeminiJsonResponse(res.status, body);
}

export async function loadImage(env: Env, key: string): Promise<GeminiImage> {
  return loadR2Image(env, key, GEMINI_IMAGE_MAX_BYTES);
}

const str = { type: "STRING" };
const strArr = { type: "ARRAY", items: str };
const num = { type: "NUMBER" };

export const S = { str, strArr, num };

export function obj(properties: Record<string, unknown>, required: string[] = Object.keys(properties)): Schema {
  return { type: "OBJECT", properties, required };
}

export function arr(items: unknown): Schema {
  return { type: "ARRAY", items };
}

export function enumOf(values: readonly string[]): Schema {
  return { type: "STRING", enum: [...values] };
}

export const OUTFIT_LIST_SCHEMA = arr(obj({ title: str, item_ids: strArr, reason: str }));

export const OUTFITS_SCHEMA: Schema = obj({ briefing: str, outfits: OUTFIT_LIST_SCHEMA });

export const TAGGING_SCHEMA: Schema = obj({
  name: str,
  category: str,
  sub_category: str,
  colors: strArr,
  material: str,
  fit: str,
  season: strArr,
  style_tags: strArr,
  warmth: { type: "INTEGER" },
});

export const INSPIRATION_SCHEMA: Schema = obj({
  summary: str,
  pieces: arr(obj({ category: str, description: str, colors: strArr, matched_item_ids: strArr })),
});

export const WISH_COMBOS_SCHEMA: Schema = obj({ verdict: str, similar_item_ids: strArr, outfits: OUTFIT_LIST_SCHEMA });
