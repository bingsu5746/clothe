export function newId(): string {
  return crypto.randomUUID();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** JSON 문자열을 파싱한다. 실패하면 undefined (타입은 호출하는 쪽에서 검증) */
export function parseJsonUnknown(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 실제로 있는 날짜인 YYYY-MM-DD 문자열인지 */
export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** b - a (일) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface FetchRetryOptions {
  timeoutMs?: number;
  /** 5xx 응답이나 네트워크 오류일 때 다시 시도할 횟수 (기본 1) */
  retries?: number;
  retryDelayMs?: number;
  /** 한국어 서비스 이름 (오류 메시지용) */
  label?: string;
}

/**
 * 외부 API 호출: 타임아웃 + 5xx/네트워크 오류일 때 한 번 재시도.
 * 타임아웃이면 재시도하지 않고 504를 던진다 (기다린 시간이 두 배가 되지 않게).
 */
export async function fetchWithRetry(url: string, init: RequestInit, opts: FetchRetryOptions = {}): Promise<Response> {
  const { timeoutMs = 30000, retries = 1, retryDelayMs = 400, label = "외부 서비스" } = opts;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt < retries) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      return res;
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new HttpError(504, `${label} 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.`);
      }
      lastError = e;
    }
  }
  console.error(`${label} fetch failed`, lastError);
  throw new HttpError(502, `${label}에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.`);
}

/** http(s)이고 로컬/사설 주소가 아닌 URL인지 (서버가 대신 불러올 URL 검증) */
export function isPublicHttpUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === "::1" || h === "::" || /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("fe80:")) return false;
  return true;
}
