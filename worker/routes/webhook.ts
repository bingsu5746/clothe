import { Hono } from "hono";
import type { AppEnv } from "../env";
import { timingSafeEqual } from "../lib/auth";
import { fetchProduct, saveRemoteImage } from "../lib/shop";
import { HttpError, newId } from "../lib/util";
import { storeUpload } from "./misc";
import { createWish } from "./wishlist";

const app = new Hono<AppEnv>();

type Target = "inspiration" | "wishlist";

const INSPIRATION_HOSTS = /(^|\.)(instagram\.com|pinterest\.[a-z.]+|pin\.it|threads\.net|x\.com|twitter\.com)$/i;

/**
 * iOS 단축어용 엔드포인트.
 * - 헤더: X-Shortcut-Token
 * - 본문: multipart(file 또는 url, target) / JSON {url, target, note} / 텍스트(URL)
 * - target 생략 시: 이미지 → 코디 사진(inspiration), 쇼핑몰 URL → 위시리스트, 인스타/핀터레스트 URL → 코디 사진
 */
app.post("/shortcut", async (c) => {
  const token = c.req.header("x-shortcut-token") ?? "";
  if (!c.env.SHORTCUT_TOKEN || !timingSafeEqual(token, c.env.SHORTCUT_TOKEN)) throw new HttpError(401, "토큰이 올바르지 않아요");

  const type = c.req.header("content-type") ?? "";
  let file: File | null = null;
  let url: string | null = null;
  let target: Target | null = null;
  let note: string | null = null;

  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.formData();
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
    url = (form.get("url") as string | null)?.trim() || null;
    target = (form.get("target") as Target | null) || null;
    note = (form.get("note") as string | null) || null;
  } else if (type.includes("application/json")) {
    const b = await c.req.json<{ url?: string; target?: Target; note?: string }>();
    url = b.url?.trim() || null;
    target = b.target ?? null;
    note = b.note ?? null;
  } else if (type.startsWith("image/")) {
    const buf = await c.req.arrayBuffer();
    file = new File([buf], "upload", { type: type.split(";")[0] });
  } else {
    url = (await c.req.text()).trim().match(/https?:\/\/\S+/)?.[0] ?? null;
  }

  if (file) {
    const image_key = await storeUpload(c.env.BUCKET, file);
    if (target === "wishlist") {
      const wish = await createWish(c.env, { name: note || "단축어로 추가한 옷", image_key, shop_url: url });
      return c.json({ ok: true, type: "wishlist", id: wish.id, message: "위시리스트에 추가했어요" });
    }
    const id = newId();
    await c.env.DB.prepare("INSERT INTO inspirations (id, image_key, source_url, note) VALUES (?, ?, ?, ?)").bind(id, image_key, url, note).run();
    return c.json({ ok: true, type: "inspiration", id, message: "코디 사진을 저장했어요" });
  }

  if (!url || !/^https?:\/\//.test(url)) throw new HttpError(400, "이미지나 URL을 보내 주세요");
  const host = new URL(url).hostname;
  target ??= INSPIRATION_HOSTS.test(host) ? "inspiration" : "wishlist";

  // URL 자체가 이미지인 경우
  const direct = await saveRemoteImage(c.env.BUCKET, url);
  if (direct) {
    const id = newId();
    await c.env.DB.prepare("INSERT INTO inspirations (id, image_key, source_url, note) VALUES (?, ?, ?, ?)").bind(id, direct, url, note).run();
    return c.json({ ok: true, type: "inspiration", id, message: "코디 사진을 저장했어요" });
  }

  const p = await fetchProduct(url).catch(() => null);
  const image_key = p?.image_url ? await saveRemoteImage(c.env.BUCKET, p.image_url) : null;

  if (target === "inspiration") {
    if (!image_key) throw new HttpError(422, "이 링크에서 사진을 가져오지 못했어요. 사진을 직접 공유해 주세요.");
    const id = newId();
    await c.env.DB.prepare("INSERT INTO inspirations (id, image_key, source_url, note) VALUES (?, ?, ?, ?)").bind(id, image_key, url, note).run();
    return c.json({ ok: true, type: "inspiration", id, message: "코디 사진을 저장했어요" });
  }

  const wish = await createWish(c.env, {
    name: [p?.brand, p?.name].filter(Boolean).join(" ") || note || url,
    estimated_price: p?.price ?? null,
    image_key,
    image_url: p?.image_url ?? null,
    shop_url: url,
  });
  return c.json({ ok: true, type: "wishlist", id: wish.id, message: `위시리스트에 추가했어요: ${wish.name}` });
});

export default app;
