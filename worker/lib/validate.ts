import type { Context } from "hono";
import { CATEGORIES, type Category } from "../../shared/types";
import { HttpError, isDateString, isPublicHttpUrl } from "./util";

/**
 * 요청 본문 검증 도우미.
 * 규칙: 값이 없으면(undefined) undefined, null이거나 빈 문자열이면 null, 형식이 틀리면 400.
 */
export type Body = Record<string, unknown>;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DEFAULT_JSON_LIMIT = 64 * 1024;

function bad(label: string, why = "값이 올바르지 않아요"): HttpError {
  return new HttpError(400, `${label}: ${why}`);
}

/** JSON 본문을 읽는다. 객체가 아니거나 너무 크면 오류. allowEmpty면 빈 본문을 {}로 본다. */
export async function readJson(c: Context, opts: { maxBytes?: number; allowEmpty?: boolean } = {}): Promise<Body> {
  const max = opts.maxBytes ?? DEFAULT_JSON_LIMIT;
  const len = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(len) && len > max) throw new HttpError(413, "요청이 너무 커요");
  const text = await c.req.text();
  if (text.length > max) throw new HttpError(413, "요청이 너무 커요");
  if (!text.trim()) {
    if (opts.allowEmpty) return {};
    throw new HttpError(400, "요청 내용이 비어 있어요");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "요청 형식이 올바르지 않아요 (JSON이 아니에요)");
  }
  if (!isRecord(data)) throw new HttpError(400, "요청 형식이 올바르지 않아요");
  return data;
}

export function optStr(o: Body, key: string, max = 500, label = key): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw bad(label, "글자로 보내 주세요");
  const s = v.trim();
  if (s.length > max) throw bad(label, `너무 길어요 (최대 ${max}자)`);
  return s === "" ? null : s;
}

export function reqStr(o: Body, key: string, max = 500, message?: string): string {
  const v = optStr(o, key, max);
  if (v == null) throw new HttpError(400, message ?? `${key}: 값이 필요해요`);
  return v;
}

export function optNum(o: Body, key: string, range: { min?: number; max?: number; integer?: boolean } = {}, label = key): number | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw bad(label, "숫자로 보내 주세요");
  if (range.integer && !Number.isInteger(n)) throw bad(label, "정수로 보내 주세요");
  if (range.min !== undefined && n < range.min) throw bad(label, `${range.min} 이상이어야 해요`);
  if (range.max !== undefined && n > range.max) throw bad(label, `${range.max} 이하여야 해요`);
  return n;
}

export function optInt(o: Body, key: string, range: { min?: number; max?: number } = {}, label = key): number | null | undefined {
  return optNum(o, key, { ...range, integer: true }, label);
}

export function optBool(o: Body, key: string, label = key): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw bad(label, "true 또는 false로 보내 주세요");
  return v;
}

/** 문자열 배열. null이면 []. 빈 문자열은 버리고 중복을 없앤다. */
export function optStrArray(o: Body, key: string, opts: { maxItems?: number; maxLen?: number } = {}, label = key): string[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null) return [];
  const { maxItems = 30, maxLen = 100 } = opts;
  if (!Array.isArray(v)) throw bad(label, "목록으로 보내 주세요");
  if (v.length > maxItems) throw bad(label, `너무 많아요 (최대 ${maxItems}개)`);
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") throw bad(label, "글자 목록으로 보내 주세요");
    const s = x.trim();
    if (s.length > maxLen) throw bad(label, `항목이 너무 길어요 (최대 ${maxLen}자)`);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function optEnum<T extends string>(o: Body, key: string, values: readonly T[], label = key): T | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const found = values.find((x) => x === v);
  if (found === undefined) throw bad(label, `${values.join(", ")} 중 하나여야 해요`);
  return found;
}

export function optCategory(o: Body, key = "category"): Category | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const found = CATEGORIES.find((x) => x === v);
  if (!found) throw new HttpError(400, "카테고리가 올바르지 않아요");
  return found;
}

export function optDate(o: Body, key: string, label = key): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!isDateString(v)) throw bad(label, "날짜는 YYYY-MM-DD 형식이어야 해요");
  return v;
}

/** R2 이미지 key (예: img/uuid.webp) */
export const IMAGE_KEY_RE = /^(img|tryon)\/[A-Za-z0-9._-]{1,80}$/;

export function isImageKey(v: unknown): v is string {
  return typeof v === "string" && IMAGE_KEY_RE.test(v) && !v.includes("..");
}

export function optImageKey(o: Body, key: string, label = key): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!isImageKey(v)) throw bad(label, "이미지 key가 올바르지 않아요");
  return v;
}

export function optImageKeyArray(o: Body, key: string, maxItems = 10, label = key): string[] | undefined {
  const arr = optStrArray(o, key, { maxItems, maxLen: 100 }, label);
  if (arr === undefined) return undefined;
  for (const k of arr) if (!isImageKey(k)) throw bad(label, "이미지 key가 올바르지 않아요");
  return arr;
}

export function optUrl(o: Body, key: string, label = key): string | null | undefined {
  const v = optStr(o, key, 2000, label);
  if (v == null) return v;
  if (!isPublicHttpUrl(v)) throw new HttpError(400, "올바른 URL을 입력해 주세요");
  return v;
}

export function reqUrl(o: Body, key = "url"): string {
  const v = optUrl(o, key);
  if (v == null) throw new HttpError(400, "올바른 URL을 입력해 주세요");
  return v;
}

/** 옷 id 목록 (중복 제거) */
export function optIdArray(o: Body, key: string, maxItems = 30, label = key): string[] | undefined {
  return optStrArray(o, key, { maxItems, maxLen: 64 }, label);
}

/** URL 파라미터 id 형식 확인 (없는 값으로 DB를 두드리지 않게) */
export function paramId(c: Context, name = "id"): string {
  const v = c.req.param(name) ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new HttpError(404, "찾을 수 없어요");
  return v;
}

// ── AI 응답 등 신뢰할 수 없는 값을 안전하게 꺼내는 도우미 ──

export function asString(v: unknown, fallback = "", max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : fallback;
}

export function asStringArray(v: unknown, maxItems = 30, maxLen = 300): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim().slice(0, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

export function asEnum<T extends string>(v: unknown, values: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return values.find((x) => x.toLowerCase() === s) ?? null;
}

export function asCategory(v: unknown, fallback: Category): Category {
  return asEnum(v, CATEGORIES) ?? fallback;
}
