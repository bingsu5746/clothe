import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import {
  SESSION_COOKIE, SESSION_DAYS, clearLoginFailures, createSessionToken, registerLoginAttempt, sessionSecret, timingSafeEqual, verifySessionToken,
  verifySignedImage,
} from "./lib/auth";
import { HttpError } from "./lib/util";
import { readJson } from "./lib/validate";
import { ensureSchema } from "./lib/schema";
import items from "./routes/items";
import outfits from "./routes/outfits";
import inspirations from "./routes/inspirations";
import wishlist from "./routes/wishlist";
import stylist from "./routes/stylist";
import misc, { serveImage } from "./routes/misc";
import webhook from "./routes/webhook";
import profile from "./routes/profile";
import logs from "./routes/logs";
import ootd from "./routes/ootd";
import trips from "./routes/trips";
import shopping from "./routes/shopping";
import tryon from "./routes/tryon";

const app = new Hono<AppEnv>().basePath("/api");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF 방어(심층 방어): 쿠키 인증 경로에서 상태를 바꾸는 요청에 Origin 헤더가 있으면 같은 origin이어야 한다.
 * SameSite=Lax 쿠키가 1차 방어이고, 이 검사는 같은 사이트(서브도메인 등)에서 오는 요청까지 막는다.
 * Origin이 없는 요청(오래된 클라이언트, 단축어 등)은 쿠키가 있어야만 통과하므로 그대로 둔다.
 */
export function sameOriginOrNoOrigin(method: string, origin: string | undefined, requestUrl: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase()) || !origin) return true;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/** 모든 오류는 { error: "한국어 메시지" } 로 통일 */
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof HTTPException) return c.json({ error: err.status === 413 ? "요청이 너무 커요" : "요청을 처리하지 못했어요" }, err.status);
  console.error(err);
  return c.json({ error: "서버 오류가 났어요. 잠시 후 다시 시도해 주세요." }, 500);
});

/**
 * 모든 API 응답 공통 헤더: 개인 데이터라 중간 캐시/브라우저 디스크 캐시에 남기지 않고(no-store, 이미지처럼 직접 정한 경우는 유지),
 * MIME 추측 금지, Referer 미전송, 다른 사이트의 프레임에 넣지 못하게.
 */
app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  if (!h.has("cache-control")) h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "no-referrer");
  h.set("x-frame-options", "DENY");
});

/** 요청 본문 전체 크기 제한 (사진 8MB + multipart 여유). JSON 본문은 readJson에서 64KB로 더 엄격하게 제한한다. */
app.use(
  "*",
  bodyLimit({
    maxSize: 9 * 1024 * 1024,
    onError: (c) => c.json({ error: "요청이 너무 커요 (최대 8MB)" }, 413),
  }),
);

// 처음 요청 때 DB 스키마를 최신 버전으로 (런타임 마이그레이션)
app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

app.post("/auth/login", async (c) => {
  if (!c.env.APP_PIN) throw new HttpError(503, "APP_PIN 시크릿이 설정되지 않았어요");
  const b = await readJson(c, { maxBytes: 1024 });
  const pin = typeof b.pin === "string" ? b.pin : typeof b.pin === "number" ? String(b.pin) : "";
  // 시도 횟수를 PIN 비교 전에 원자적으로 올린다 (동시 요청으로 잠금을 우회하지 못하게, worker/lib/auth.ts)
  await registerLoginAttempt(c.env.DB);
  if (!pin || pin.length > 100 || !timingSafeEqual(pin, c.env.APP_PIN)) {
    throw new HttpError(401, "PIN이 맞지 않아요");
  }
  await clearLoginFailures(c.env.DB);
  setCookie(c, SESSION_COOKIE, await createSessionToken(await sessionSecret(c.env)), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return c.json({ ok: true });
});

app.post("/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.route("/webhook", webhook);

/**
 * 서명된 임시 이미지 주소 (로그인 없이 접근). 가상 피팅 때 Replicate가 입력 사진을 내려받는 용도로만 쓰며 15분 뒤 만료된다.
 */
app.get("/public/images/:exp/:sig/:dir/:name", async (c) => {
  const key = `${c.req.param("dir")}/${c.req.param("name")}`;
  if (!(await verifySignedImage(await sessionSecret(c.env), c.req.param("exp"), c.req.param("sig"), key))) {
    return c.json({ error: "만료됐거나 올바르지 않은 주소예요" }, 403);
  }
  return serveImage(c.env.BUCKET, key, c.req.raw, "private, max-age=600");
});

// 여기부터는 로그인 필요
app.use("*", async (c, next) => {
  if (!(await verifySessionToken(await sessionSecret(c.env), getCookie(c, SESSION_COOKIE)))) {
    return c.json({ error: "로그인이 필요해요" }, 401);
  }
  if (!sameOriginOrNoOrigin(c.req.method, c.req.header("origin"), c.req.url)) {
    return c.json({ error: "다른 사이트에서 온 요청은 받을 수 없어요" }, 403);
  }
  await next();
});

app.get("/auth/me", (c) => c.json({ ok: true }));
app.route("/items", items);
app.route("/outfits", outfits);
app.route("/inspirations", inspirations);
app.route("/wishlist", wishlist);
app.route("/stylist", stylist);
app.route("/profile", profile);
app.route("/logs", logs);
app.route("/ootd", ootd);
app.route("/trips", trips);
app.route("/shopping", shopping);
app.route("/tryon", tryon);
app.route("/", misc);

app.all("*", (c) => c.json({ error: "없는 API예요" }, 404));

export default app;
