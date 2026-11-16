import { HttpError, parseJsonUnknown } from "./util";
import { isRecord } from "./validate";

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export const SESSION_COOKIE = "clothe_session";
export const SESSION_DAYS = 180;

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_DAYS * 86400 * 1000);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  return timingSafeEqual(sig, await hmac(secret, exp));
}

const LOCK_KEY = "login_failures";
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

interface Failures {
  count: number;
  first: number;
}

function parseFailures(value: string | undefined): Failures | null {
  const v = parseJsonUnknown(value);
  if (!isRecord(v) || typeof v.count !== "number" || typeof v.first !== "number") return null;
  return { count: v.count, first: v.first };
}

/** PIN 무차별 대입 방지: 15분 안에 5번 틀리면 15분 잠금 */
export async function checkLoginLock(db: D1Database, now = Date.now()): Promise<void> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(LOCK_KEY).first<{ value: string }>();
  const f = parseFailures(row?.value);
  if (!f) return;
  if (now - f.first > LOCK_MS) return;
  if (f.count >= MAX_FAILURES) {
    const mins = Math.ceil((f.first + LOCK_MS - now) / 60000);
    throw new HttpError(429, `PIN을 너무 많이 틀렸어요. ${mins}분 뒤에 다시 시도해 주세요.`);
  }
}

export async function recordLoginFailure(db: D1Database, now = Date.now()): Promise<void> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(LOCK_KEY).first<{ value: string }>();
  let f: Failures = parseFailures(row?.value) ?? { count: 0, first: now };
  if (now - f.first > LOCK_MS) f = { count: 0, first: now };
  f.count += 1;
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(LOCK_KEY, JSON.stringify(f))
    .run();
}

export async function clearLoginFailures(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = ?").bind(LOCK_KEY).run();
}

const SIGNED_IMAGE_TTL_MS = 15 * 60 * 1000;

/**
 * 외부 서비스(Replicate)가 잠깐 이미지를 내려받을 수 있게 하는 서명된 경로.
 * `/api/public/images/{만료시각}/{서명}/{key}` — 15분 뒤 만료, 서명은 세션 비밀키로 만든 HMAC.
 */
export async function signedImagePath(secret: string, key: string, now = Date.now()): Promise<string> {
  const exp = String(now + SIGNED_IMAGE_TTL_MS);
  return `/api/public/images/${exp}/${await hmac(secret, `img:${exp}:${key}`)}/${key}`;
}

export async function verifySignedImage(secret: string, exp: string, sig: string, key: string, now = Date.now()): Promise<boolean> {
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return timingSafeEqual(sig, await hmac(secret, `img:${exp}:${key}`));
}

export function sessionSecret(env: { SESSION_SECRET?: string; APP_PIN?: string }): string {
  const s = env.SESSION_SECRET || env.APP_PIN;
  if (!s) throw new HttpError(503, "APP_PIN 시크릿이 설정되지 않았어요");
  return s;
}
