import type { Env } from "../env";
import type { Category, TryOn, TryOnAvailability } from "../../shared/types";
import { strOrNull, type Row } from "./db";
import { sniffImageType, type LoadedImage } from "./images";
import { fetchWithRetry, fromBase64, HttpError, readBodyLimited, toBase64 } from "./util";
import { asCategory, asEnum, asString, isRecord } from "./validate";

/**
 * 가상 피팅 제공자 2가지 (둘 다 유료 API라서 시크릿/변수를 넣어야만 켜진다).
 *
 * 1) replicate — Replicate에 올라와 있는 IDM-VTON (cuuupid/idm-vton)
 *    - API 문서: https://replicate.com/docs/reference/http (2026-11-15 확인)
 *      POST https://api.replicate.com/v1/predictions, 헤더 `Authorization: Bearer <token>`, 본문 { version, input }.
 *      GET  https://api.replicate.com/v1/predictions/{id}. status: starting | processing | succeeded | failed | canceled.
 *      파일 입력은 HTTP URL 또는 data URL (256kb 이하는 data URL 권장). 결과 파일은 HTTPS URL이고 받을 때도 Authorization 헤더 필요,
 *      결과는 1시간 뒤 지워지므로 바로 R2에 복사한다.
 *    - 모델 입력 스키마: https://replicate.com/cuuupid/idm-vton/api/schema (2026-11-15 확인)
 *      필수 human_img, garm_img / 선택 garment_des, category(upper_body|lower_body|dresses, 기본 upper_body), crop(3:4가 아니면 true),
 *      steps(1~40, 기본 30), seed. 출력은 이미지 URL 문자열 하나. 최신 버전 id는 아래 상수.
 *      모델 설명: "non-commercial use only" (CC BY-NC-SA 4.0) → 개인용으로만.
 *
 * 2) gemini — Gemini 이미지 생성/편집 모델 ("Nano Banana")
 *    - 문서: https://ai.google.dev/gemini-api/docs/image-generation?generate-content=true (2026-11-15 확인)
 *      POST https://generativelanguage.googleapis.com/v1/models/{model}:generateContent, 헤더 x-goog-api-key,
 *      본문 contents[].parts[] 에 {inline_data:{mime_type,data}} 이미지들과 {text}. 응답 이미지는 candidates[0].content.parts[].inlineData(.data base64).
 *      같은 문서에 "옷 사진 + 사람 사진 → 그 옷을 입은 전신 사진" 예시가 있다.
 *    - 가격표(https://ai.google.dev/gemini-api/docs/pricing, 2026-11-15 확인): 이미지 모델은 전부 Free Tier "Not available".
 *      즉 무료 키로는 안 되고 결제가 연결된 키여야 한다. 그래서 GEMINI_API_KEY가 있어도 자동으로 켜지 않고
 *      TRYON_PROVIDER=gemini 를 직접 설정했을 때만 쓴다.
 */
export const REPLICATE_IDM_VTON_VERSION = "0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985";
export const DEFAULT_REPLICATE_MODEL = `cuuupid/idm-vton:${REPLICATE_IDM_VTON_VERSION}`;
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-nano-banana-2.1";

const SETUP_HINT =
  "켜려면 Cloudflare 대시보드 → Workers → clothe → Settings → Variables and Secrets 에서 둘 중 하나를 설정하세요. " +
  "① Replicate: 시크릿 REPLICATE_API_TOKEN 추가 (replicate.com 계정의 API 토큰, 유료). " +
  "② Gemini: 변수 TRYON_PROVIDER=gemini 추가 (GEMINI_API_KEY가 결제가 연결된 유료 키여야 해요. 이미지 생성 모델은 무료 티어가 없어요). " +
  "설정 전에는 2D 콜라주 보드만 쓸 수 있어요.";

export function tryOnAvailability(env: Pick<Env, "TRYON_PROVIDER" | "TRYON_MODEL" | "REPLICATE_API_TOKEN" | "GEMINI_API_KEY">): TryOnAvailability {
  const wanted = (env.TRYON_PROVIDER ?? "").trim().toLowerCase();
  const model = (env.TRYON_MODEL ?? "").trim();
  const off = (reason: string): TryOnAvailability => ({ available: false, provider: null, model: null, reason, setup_hint: SETUP_HINT });

  if (wanted && wanted !== "replicate" && wanted !== "gemini") {
    return off(`TRYON_PROVIDER 값이 올바르지 않아요 ("${wanted.slice(0, 20)}"). replicate 또는 gemini 중 하나여야 해요.`);
  }
  if (wanted === "gemini") {
    if (!env.GEMINI_API_KEY) return off("TRYON_PROVIDER=gemini 인데 GEMINI_API_KEY 시크릿이 없어요.");
    return { available: true, provider: "gemini", model: model || DEFAULT_GEMINI_IMAGE_MODEL, reason: null, setup_hint: null };
  }
  if (wanted === "replicate" || env.REPLICATE_API_TOKEN) {
    if (!env.REPLICATE_API_TOKEN) return off("TRYON_PROVIDER=replicate 인데 REPLICATE_API_TOKEN 시크릿이 없어요.");
    return { available: true, provider: "replicate", model: model || DEFAULT_REPLICATE_MODEL, reason: null, setup_hint: null };
  }
  return off("가상 피팅용 API 키가 설정되지 않아서 꺼져 있어요.");
}

/** IDM-VTON이 받는 category 값. 신발/가방/액세서리는 지원하지 않는다 (null). */
export function idmCategory(category: Category | null): "upper_body" | "lower_body" | "dresses" | null {
  switch (category) {
    case "top":
    case "outer":
    case null:
      return "upper_body";
    case "bottom":
      return "lower_body";
    case "dress":
      return "dresses";
    default:
      return null;
  }
}

export interface ReplicateInput {
  human_img: string;
  garm_img: string;
  garment_des: string;
  category: "upper_body" | "lower_body" | "dresses";
  crop: boolean;
}

export function replicateCreateBody(model: string, input: ReplicateInput): Record<string, unknown> {
  return { version: model, input: { ...input } };
}

export interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: string | null;
  error: string | null;
}

/** Replicate prediction 객체에서 필요한 값만 꺼낸다. 모양이 다르면 null. */
export function parseReplicatePrediction(body: unknown): ReplicatePrediction | null {
  if (!isRecord(body) || typeof body.id !== "string") return null;
  const status = asEnum(body.status, ["starting", "processing", "succeeded", "failed", "canceled"] as const);
  if (!status) return null;
  const o = body.output;
  const first: unknown = Array.isArray(o) ? o[0] : o;
  return {
    id: body.id,
    status,
    output: typeof first === "string" && /^https:\/\//.test(first) ? first : null,
    error: body.error == null ? null : asString(typeof body.error === "string" ? body.error : JSON.stringify(body.error), "", 300),
  };
}

function replicateError(status: number, body: unknown): HttpError {
  const detail = isRecord(body) && typeof body.detail === "string" ? `: ${body.detail.slice(0, 200)}` : "";
  if (status === 401) return new HttpError(502, "Replicate API 토큰이 올바르지 않아요. REPLICATE_API_TOKEN을 확인해 주세요.");
  if (status === 402) return new HttpError(502, `Replicate 결제 정보가 필요해요${detail}`);
  if (status === 429) return new HttpError(429, "Replicate 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
  return new HttpError(502, `Replicate 오류 (${status})${detail}`);
}

export async function replicateCreate(env: Env, model: string, input: ReplicateInput): Promise<ReplicatePrediction> {
  const res = await fetchWithRetry(
    "https://api.replicate.com/v1/predictions",
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(replicateCreateBody(model, input)),
    },
    { timeoutMs: 30000, retries: 0, label: "Replicate" }, // 만들기 요청은 재시도하지 않는다 (중복 과금 방지)
  );
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw replicateError(res.status, body);
  const p = parseReplicatePrediction(body);
  if (!p) throw new HttpError(502, "Replicate 응답을 해석하지 못했어요.");
  return p;
}

export async function replicateGet(env: Env, id: string): Promise<ReplicatePrediction> {
  const res = await fetchWithRetry(
    `https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}` } },
    { timeoutMs: 15000, retries: 1, label: "Replicate" },
  );
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw replicateError(res.status, body);
  const p = parseReplicatePrediction(body);
  if (!p) throw new HttpError(502, "Replicate 응답을 해석하지 못했어요.");
  return p;
}

/**
 * Replicate 결과 파일 호스트인지.
 * 문서(https://replicate.com/docs/topics/predictions/output-files, 2026-11-16 확인):
 * "Output files are served by `replicate.delivery` and its subdomains."
 */
export function isReplicateFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return u.protocol === "https:" && (h === "replicate.delivery" || h.endsWith(".replicate.delivery"));
  } catch {
    return false;
  }
}

/**
 * Replicate 결과 파일 내려받기.
 * prediction의 output은 모델이 내놓는 값이라(TRYON_MODEL로 다른 모델을 쓸 수도 있다) 아무 주소나 될 수 있다.
 * Replicate 파일 호스트가 아니면 받지 않는다 → API 토큰이 다른 서버로 새거나 내부 주소를 부르는 일을 막는다.
 * 리다이렉트도 따라가지 않는다.
 */
export async function replicateDownload(env: Env, url: string): Promise<LoadedImage> {
  if (!isReplicateFileUrl(url)) throw new HttpError(502, "가상 피팅 결과 주소가 Replicate 파일 주소가 아니에요.");
  const res = await fetchWithRetry(
    url,
    { headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}` }, redirect: "manual" },
    { timeoutMs: 30000, retries: 1, label: "Replicate" },
  );
  if (!res.ok) throw new HttpError(502, `가상 피팅 결과 이미지를 받지 못했어요 (${res.status})`);
  const data = await readBodyLimited(res, 20 * 1024 * 1024);
  if (!data || !data.length) throw new HttpError(502, "가상 피팅 결과 이미지가 올바르지 않아요.");
  const sniffed = sniffImageType(data);
  if (!sniffed) throw new HttpError(502, "가상 피팅 결과가 이미지가 아니에요.");
  return { mimeType: sniffed === "isobmff" ? "image/heif" : sniffed, data };
}

export function dataUrl(img: LoadedImage): string {
  return `data:${img.mimeType};base64,${toBase64(img.data)}`;
}

export function geminiImageUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
}

const GEMINI_TARGET: Record<Category, string> = {
  top: "Replace only the top the person is wearing with this garment; keep every other piece of clothing unchanged.",
  outer: "Put this outerwear on the person over (or instead of) their current top layer; keep every other piece of clothing unchanged.",
  bottom: "Replace only the bottoms the person is wearing with this garment; keep every other piece of clothing unchanged.",
  dress: "Replace the person's outfit with this dress; keep shoes and accessories unchanged.",
  shoes: "Replace only the shoes the person is wearing with these shoes; keep all clothing unchanged.",
  bag: "Add this bag so the person is carrying it naturally; keep all clothing unchanged.",
  accessory: "Add this accessory so the person is wearing it naturally; keep all clothing unchanged.",
};

/** Gemini 이미지 모델용 지시문 (이미지 순서: 1 = 옷, 2 = 사람). 모델 문서의 예시처럼 영어로 쓴다. */
export function geminiTryOnPrompt(category: Category | null, description: string): string {
  const what = description ? ` (${description.replace(/\s+/g, " ").slice(0, 120)})` : "";
  return `Virtual try-on. The first image is a garment${what}. The second image is a full-body photo of a person.
Generate a realistic photo of the same person from the second image wearing the garment from the first image.
- ${GEMINI_TARGET[category ?? "top"]}
- Keep the person's face, hair, body shape, pose, and the background exactly the same.
- Preserve the garment's color, pattern, fabric texture, and details faithfully, with natural fit, folds, lighting and shadows.
- Output a single image only, with the same framing and aspect ratio as the person photo. Do not add text or watermarks.`;
}

export function geminiTryOnBody(person: LoadedImage, garment: LoadedImage, prompt: string): Record<string, unknown> {
  return {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: garment.mimeType, data: toBase64(garment.data) } },
          { inline_data: { mime_type: person.mimeType, data: toBase64(person.data) } },
          { text: prompt },
        ],
      },
    ],
  };
}

/** Gemini generateContent 응답에서 생성된 이미지를 꺼낸다. 이미지가 없으면 이유에 맞는 HttpError. */
export function parseGeminiImageResponse(status: number, body: unknown): LoadedImage {
  const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message.slice(0, 300) : "알 수 없는 오류";
  if (status === 429) throw new HttpError(429, `Gemini 이미지 생성 한도를 넘었어요. 이미지 모델은 무료 티어가 없어서 결제가 연결된 키가 필요해요. (${message})`);
  if (status < 200 || status >= 300) throw new HttpError(502, `Gemini 이미지 생성 오류 (${status}): ${message}`);
  if (!isRecord(body)) throw new HttpError(502, "Gemini 응답을 해석하지 못했어요.");
  if (isRecord(body.promptFeedback) && typeof body.promptFeedback.blockReason === "string") {
    throw new HttpError(422, `Gemini가 이 사진으로는 이미지를 만들지 않았어요 (안전 필터: ${body.promptFeedback.blockReason}).`);
  }
  const candidate: unknown = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  const parts: unknown[] = isRecord(candidate) && isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  for (const p of parts) {
    if (!isRecord(p)) continue;
    const inline = isRecord(p.inlineData) ? p.inlineData : isRecord(p.inline_data) ? p.inline_data : null;
    if (!inline || typeof inline.data !== "string" || !inline.data) continue;
    const mime = typeof inline.mimeType === "string" ? inline.mimeType : typeof inline.mime_type === "string" ? inline.mime_type : "image/png";
    try {
      return { mimeType: mime.startsWith("image/") ? mime : "image/png", data: fromBase64(inline.data) };
    } catch {
      throw new HttpError(502, "Gemini가 보낸 이미지를 해석하지 못했어요.");
    }
  }
  const finish = isRecord(candidate) && typeof candidate.finishReason === "string" ? candidate.finishReason : "";
  if (finish && finish !== "STOP") throw new HttpError(422, `Gemini가 이미지를 만들지 않았어요 (${finish}). 다른 사진으로 시도해 주세요.`);
  throw new HttpError(502, "Gemini가 이미지를 돌려주지 않았어요. 다시 시도해 주세요.");
}

export async function geminiTryOn(env: Env, model: string, person: LoadedImage, garment: LoadedImage, category: Category | null, description: string): Promise<LoadedImage> {
  const res = await fetchWithRetry(
    geminiImageUrl(model),
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(geminiTryOnBody(person, garment, geminiTryOnPrompt(category, description))),
    },
    { timeoutMs: 120000, retries: 0, label: "Gemini 이미지 생성" }, // 과금되는 요청이라 재시도하지 않는다
  );
  const body: unknown = await res.json().catch(() => null);
  return parseGeminiImageResponse(res.status, body);
}

export function imageExtension(mime: string): string {
  const ext = mime.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "png";
  return /^[a-z0-9]{1,5}$/.test(ext) ? (ext === "jpeg" ? "jpg" : ext) : "png";
}

export function rowToTryOn(r: Row): TryOn {
  const category = strOrNull(r.category);
  return {
    id: String(r.id),
    status: asEnum(r.status, ["queued", "processing", "succeeded", "failed"] as const) ?? "failed",
    provider: r.provider === "gemini" ? "gemini" : "replicate",
    model: asString(r.model),
    person_image_key: asString(r.person_image_key),
    garment_image_key: asString(r.garment_image_key),
    garment_item_id: strOrNull(r.garment_item_id),
    garment_wish_id: strOrNull(r.garment_wish_id),
    category: category ? asCategory(category, "top") : null,
    result_image_key: strOrNull(r.result_image_key),
    error: strOrNull(r.error),
    created_at: asString(r.created_at),
    updated_at: asString(r.updated_at),
  };
}
