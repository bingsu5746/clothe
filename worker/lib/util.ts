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

/** 점 4개짜리 IPv4 문자열 → 32비트 정수 (아니면 null). WHATWG URL 파서가 10진/8진/16진 표기를 이미 이 형태로 바꿔 준다. */
function ipv4ToInt(h: string): number | null {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** 공용 인터넷에서 쓰지 않는 IPv4 대역 (RFC 6890 특수 목적 주소 + 멀티캐스트/예약) */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function isBlockedV4(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

/** IPv6 문자열(URL 파서가 정규화한 형태)을 8개의 16비트 값으로 */
function ipv6Groups(h: string): number[] | null {
  if (!h.includes(":")) return null;
  const [head, tail = ""] = h.split("::");
  if (h.split("::").length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((x) => parseInt(x, 16)) : []);
  const a = parse(head);
  const b = parse(tail);
  if ([...a, ...b].some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
  const fill = h.includes("::") ? 8 - a.length - b.length : 0;
  if (fill < 0) return null;
  const out = [...a, ...Array<number>(fill).fill(0), ...b];
  return out.length === 8 ? out : null;
}

function isBlockedV6(g: number[]): boolean {
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true; // :: , ::1
  // IPv4 매핑/호환/NAT64 주소는 안쪽 IPv4로 다시 판단 (::ffff:127.0.0.1, ::127.0.0.1, 64:ff9b::/96)
  const v4 = ((g[6] << 16) >>> 0) + g[7];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(v4);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(v4);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 고유 로컬
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // 링크 로컬, 사이트 로컬(폐기)
  if ((g[0] & 0xff00) === 0xff00) return true; // 멀티캐스트
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 문서용
  return false;
}

/**
 * http(s)이고 로컬/사설 주소가 아닌 URL인지 (서버가 대신 불러올 URL 검증).
 * - 10진/8진/16진 IPv4 표기(http://2130706433, http://0x7f.1)는 URL 파서가 점 4개 표기로 바꾼 뒤 검사된다.
 * - IPv4 매핑 IPv6(::ffff:7f00:1), NAT64, CGNAT(100.64/10) 등도 거절.
 * - 사용자 정보(user:pass@)가 들어간 URL도 거절.
 * 한계: DNS 이름이 사설 IP로 풀리는 경우는 Workers에서 미리 확인할 수 없다 (Workers의 fetch는 사설망에 닿지 않는다).
 */
export function isPublicHttpUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return false;
  const v4 = ipv4ToInt(h);
  if (v4 !== null) return !isBlockedV4(v4);
  if (/^[\d.]+$/.test(h)) return false; // 파서가 받아들이지 않은 이상한 숫자 표기
  const v6 = ipv6Groups(h);
  if (v6) return !isBlockedV6(v6);
  if (h.includes(":")) return false;
  return true;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
}

/**
 * 사용자가 준 URL(쇼핑몰 페이지, 외부 이미지)을 서버가 대신 불러올 때 쓰는 fetch.
 * 리다이렉트를 자동으로 따라가지 않고(redirect: "manual") 한 단계씩 따라가면서 매번 isPublicHttpUrl로 다시 검사한다.
 * (자동 follow는 공개 주소 → 302 → http://127.0.0.1/ 같은 우회를 막지 못한다)
 * 실패하면 Error를 던진다. 돌려준 Response의 url 대신 finalUrl을 쓴다.
 */
export async function safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<{ res: Response; finalUrl: string }> {
  const { timeoutMs = 15000, maxRedirects = 5 } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error("허용되지 않는 주소예요");
    const res = await fetch(current, { ...init, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) throw new Error("리다이렉트 주소가 없어요");
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error("리다이렉트가 너무 많아요");
}

/** 응답 본문을 최대 maxBytes까지만 읽는다. 넘으면 null (content-length를 믿지 않고 실제로 센다). */
export async function readBodyLimited(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** 링크로 저장할 URL 검사: http(s) 이거나 scheme이 없는 글자만 허용 (javascript:, data:, vbscript: 등은 거절) */
export function isSafeLinkValue(value: string): boolean {
  // 브라우저는 URL 안의 탭/줄바꿈 등 제어 문자를 지운 뒤 해석한다 ("java\tscript:") → 제어 문자가 있으면 거절
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x20 || value.charCodeAt(i) === 0x7f) return false;
  const scheme = value.trim().match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return true;
  return scheme === "http" || scheme === "https";
}
