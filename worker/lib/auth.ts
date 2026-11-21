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

function lockedError(f: Failures, now: number): HttpError {
  const mins = Math.max(1, Math.ceil((f.first + LOCK_MS - now) / 60000));
  return new HttpError(429, `PIN을 너무 많이 틀렸어요. ${mins}분 뒤에 다시 시도해 주세요.`);
}

/**
 * PIN을 비교하기 "전에" 시도 횟수를 원자적으로 1 올리고, 올린 뒤의 값으로 잠금 여부를 판단한다.
 * (예전 방식: 잠금 확인 → PIN 비교 → 실패 기록 은 동시 요청 수백 개가 모두 잠금 확인을 통과하고,
 *  읽고-고치고-쓰기 사이에 실패 횟수가 서로 덮어써져서 잠금이 사실상 무력화됐다.)
 * 한 문장의 UPSERT ... RETURNING 이라 D1에서 직렬화된다. 로그인에 성공하면 clearLoginFailures로 지운다.
 */
export async function registerLoginAttempt(db: D1Database, now = Date.now()): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?1, json_object('count', 1, 'first', ?2))
       ON CONFLICT(key) DO UPDATE SET value = CASE
         WHEN json_valid(settings.value) = 0
           OR json_type(settings.value, '$.count') NOT IN ('integer', 'real')
           OR json_type(settings.value, '$.first') NOT IN ('integer', 'real')
           OR ?2 - json_extract(settings.value, '$.first') > ?3
         THEN json_object('count', 1, 'first', ?2)
         ELSE json_set(settings.value, '$.count', json_extract(settings.value, '$.count') + 1)
       END
       RETURNING value`,
    )
    .bind(LOCK_KEY, now, LOCK_MS)
    .first<{ value: string }>();
  const f = parseFailures(row?.value);
  if (f && f.count > MAX_FAILURES) throw lockedError(f, now);
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

/** SESSION_SECRET이 이보다 짧으면 쓰지 않고 DB에 만든 무작위 키를 쓴다 */
export const MIN_SESSION_SECRET_LENGTH = 16;
/** 자동 생성 서명 키를 저장하는 settings 키 (login_ 접두사라 GET/PUT /settings로 보이거나 바뀌지 않는다) */
export const GENERATED_SECRET_KEY = "login_session_secret";

let generatedSecret: { db: D1Database; value: string } | null = null;

/** 테스트용 */
export function resetSessionSecretCache(): void {
  generatedSecret = null;
}

function randomSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * 쿠키·서명 주소용 HMAC 키.
 * 예전에는 SESSION_SECRET이 없으면 APP_PIN(보통 4~6자리 숫자)을 키로 썼다. 그러면 Replicate에 넘긴 서명 주소
 * (`exp` + `HMAC(PIN, ...)`) 하나만 있어도 PIN 10^4~10^6개를 오프라인으로 대입해서 PIN과 세션 쿠키를 모두 알아낼 수 있었다.
 * 이제는 SESSION_SECRET(16자 이상)이 있으면 그것을, 없으면 처음 한 번 무작위 32바이트 키를 만들어 D1에 저장해서 쓴다.
 * (여러 인스턴스가 동시에 만들어도 INSERT OR IGNORE 후 다시 읽으므로 모두 같은 키를 쓴다.)
 */
export async function sessionSecret(env: { SESSION_SECRET?: string; APP_PIN?: string; DB: D1Database }): Promise<string> {
  if (!env.APP_PIN) throw new HttpError(503, "APP_PIN 시크릿이 설정되지 않았어요");
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= MIN_SESSION_SECRET_LENGTH) return env.SESSION_SECRET;
  if (generatedSecret && generatedSecret.db === env.DB) return generatedSecret.value;
  const read = () => env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(GENERATED_SECRET_KEY).first<{ value: string }>();
  let row = await read();
  if (!row) {
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(GENERATED_SECRET_KEY, JSON.stringify(randomSecret())).run();
    row = await read();
  }
  const value = parseJsonUnknown(row?.value);
  if (typeof value !== "string" || value.length < 32) throw new HttpError(500, "서명 키를 준비하지 못했어요");
  generatedSecret = { db: env.DB, value };
  return value;
}
