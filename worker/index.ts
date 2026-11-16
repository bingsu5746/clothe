import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import {
  SESSION_COOKIE, SESSION_DAYS, checkLoginLock, clearLoginFailures, createSessionToken, recordLoginFailure, sessionSecret, timingSafeEqual, verifySessionToken,
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

/** 모든 오류는 { error: "한국어 메시지" } 로 통일 */
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof HTTPException) return c.json({ error: err.status === 413 ? "요청이 너무 커요" : "요청을 처리하지 못했어요" }, err.status);
  console.error(err);
  return c.json({ error: "서버 오류가 났어요. 잠시 후 다시 시도해 주세요." }, 500);
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
  await checkLoginLock(c.env.DB);
  const b = await readJson(c, { maxBytes: 1024 });
  const pin = typeof b.pin === "string" ? b.pin : typeof b.pin === "number" ? String(b.pin) : "";
  if (!pin || pin.length > 100 || !timingSafeEqual(pin, c.env.APP_PIN)) {
    await recordLoginFailure(c.env.DB);
    throw new HttpError(401, "PIN이 맞지 않아요");
  }
  await clearLoginFailures(c.env.DB);
  setCookie(c, SESSION_COOKIE, await createSessionToken(sessionSecret(c.env)), {
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
  if (!(await verifySignedImage(sessionSecret(c.env), c.req.param("exp"), c.req.param("sig"), key))) {
    return c.json({ error: "만료됐거나 올바르지 않은 주소예요" }, 403);
  }
  return serveImage(c.env.BUCKET, key, c.req.raw, "private, max-age=600");
});

// 여기부터는 로그인 필요
app.use("*", async (c, next) => {
  if (!(await verifySessionToken(sessionSecret(c.env), getCookie(c, SESSION_COOKIE)))) {
    return c.json({ error: "로그인이 필요해요" }, 401);
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
