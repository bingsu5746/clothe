import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import {
  SESSION_COOKIE, SESSION_DAYS, checkLoginLock, clearLoginFailures, createSessionToken, recordLoginFailure, timingSafeEqual, verifySessionToken,
} from "./lib/auth";
import { HttpError } from "./lib/util";
import { ensureSchema } from "./lib/schema";
import items from "./routes/items";
import outfits from "./routes/outfits";
import inspirations from "./routes/inspirations";
import wishlist from "./routes/wishlist";
import stylist from "./routes/stylist";
import misc from "./routes/misc";
import webhook from "./routes/webhook";

const app = new Hono<AppEnv>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: "서버 오류가 났어요. 잠시 후 다시 시도해 주세요." }, 500);
});

function sessionSecret(env: AppEnv["Bindings"]): string {
  const s = env.SESSION_SECRET || env.APP_PIN;
  if (!s) throw new HttpError(503, "APP_PIN 시크릿이 설정되지 않았어요");
  return s;
}

// 처음 요청 때 DB 테이블 자동 생성
app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

app.post("/auth/login", async (c) => {
  if (!c.env.APP_PIN) throw new HttpError(503, "APP_PIN 시크릿이 설정되지 않았어요");
  await checkLoginLock(c.env.DB);
  const { pin } = await c.req.json<{ pin: string }>();
  if (!timingSafeEqual(String(pin ?? ""), c.env.APP_PIN)) {
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
app.route("/", misc);

app.all("*", (c) => c.json({ error: "없는 API예요" }, 404));

export default app;
