import { Hono } from "hono";
import type { AppEnv } from "../env";
import { timingSafeEqual } from "../lib/auth";
import { fetchProduct, saveRemoteImage } from "../lib/shop";
import { HttpError, isPublicHttpUrl, newId, parseJsonUnknown } from "../lib/util";
import { isRecord } from "../lib/validate";
import type { ItemTagging, UrlImport } from "../../shared/types";
import { tagItemImage } from "./items";
import { storeUpload } from "./misc";
import { createWish } from "./wishlist";

const app = new Hono<AppEnv>();

/** inspiration = 스크랩, wishlist = 위시리스트, closet = 옷장 (item 도 같은 뜻으로 받음) */
type Target = "inspiration" | "wishlist" | "closet";

const INSPIRATION_HOSTS = /(^|\.)(instagram\.com|pinterest\.[a-z.]+|pin\.it|threads\.net|x\.com|twitter\.com)$/i;

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function target(v: unknown): Target | null {
  if (v === "closet" || v === "item") return "closet";
  return v === "inspiration" || v === "wishlist" ? v : null;
}

/**
 * iOS 단축어용 엔드포인트.
 * - 헤더: X-Shortcut-Token
 * - 본문: multipart(file 또는 url, target) / JSON {url, target, note} / 이미지 바이트 / 텍스트(URL)
 * - target 생략 시: 이미지 → 코디 사진(inspiration), 쇼핑몰 URL → 위시리스트, 인스타/핀터레스트 URL → 코디 사진
 * - target=closet: 옷장에 바로 등록. 상품 페이지의 이름/브랜드/가격/카테고리를 쓰고, Gemini 키가 있으면 사진으로 색·소재·계절 등을 채운다
 *   (AI가 실패해도 등록은 한다. 카테고리를 끝내 모르면 상의로 넣고 메모에 확인해 달라고 남긴다).
 */
app.post("/shortcut", async (c) => {
  const token = c.req.header("x-shortcut-token") ?? "";
  if (!c.env.SHORTCUT_TOKEN || !timingSafeEqual(token, c.env.SHORTCUT_TOKEN)) throw new HttpError(401, "토큰이 올바르지 않아요");

  const type = c.req.header("content-type") ?? "";
  let file: File | null = null;
  let url: string | null = null;
  let want: Target | null = null;
  let note: string | null = null;

  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.formData().catch(() => {
      throw new HttpError(400, "요청 형식이 올바르지 않아요");
    });
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
    url = text(form.get("url"), 2000);
    want = target(form.get("target"));
    note = text(form.get("note"), 500);
  } else if (type.includes("application/json")) {
    const b = parseJsonUnknown(await c.req.text());
    if (!isRecord(b)) throw new HttpError(400, "요청 형식이 올바르지 않아요 (JSON이 아니에요)");
    url = text(b.url, 2000);
    want = target(b.target);
    note = text(b.note, 500);
  } else if (type.startsWith("image/")) {
    const buf = await c.req.arrayBuffer();
    file = new File([buf], "upload", { type: type.split(";")[0] });
  } else {
    url = (await c.req.text()).trim().match(/https?:\/\/\S+/)?.[0]?.slice(0, 2000) ?? null;
  }

  // 사진과 같이 온 링크는 출처로만 쓰니 공개 http(s) 주소일 때만 남긴다
  if (file && url && !isPublicHttpUrl(url)) url = null;

  const saveInspiration = async (image_key: string) => {
    const id = newId();
    await c.env.DB.prepare("INSERT INTO inspirations (id, image_key, source_url, note) VALUES (?, ?, ?, ?)").bind(id, image_key, url, note).run();
    return c.json({ ok: true, type: "inspiration", id, message: "코디 사진을 저장했어요" });
  };

  /** 옷장에 등록 (사진이 있으면 AI 태깅을 시도하되 실패해도 저장) */
  const saveItem = async (image_key: string | null, p: UrlImport | null) => {
    let tag: ItemTagging | null = null;
    if (image_key && c.env.GEMINI_API_KEY) {
      tag = await tagItemImage(c.env, image_key).catch((e: unknown) => {
        console.error("shortcut tagging failed", e);
        return null;
      });
    }
    const category = p?.category ?? tag?.category ?? null;
    const name = (p?.name ?? tag?.name ?? note ?? "단축어로 추가한 옷").slice(0, 120);
    const notes = [note && note !== name ? note : null, category ? null : "단축어로 추가 — 카테고리를 확인해 주세요"].filter(Boolean).join("\n") || null;
    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO items (id, name, brand, category, sub_category, colors, material, fit, season, style_tags, warmth, image_key, original_shop_url, purchase_price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        name,
        p?.brand?.slice(0, 80) ?? null,
        category ?? "top",
        tag?.sub_category || null,
        JSON.stringify(tag?.colors ?? []),
        tag?.material || null,
        tag?.fit || null,
        JSON.stringify(tag?.season ?? []),
        JSON.stringify(tag?.style_tags ?? []),
        tag?.warmth ?? null,
        image_key,
        url,
        p?.price ?? null,
        notes,
      )
      .run();
    return c.json({ ok: true, type: "item", id, message: `옷장에 넣었어요: ${name}` });
  };

  if (file) {
    const image_key = await storeUpload(c.env.BUCKET, file);
    if (want === "closet") return saveItem(image_key, null);
    if (want === "wishlist") {
      const wish = await createWish(c.env, { name: note || "단축어로 추가한 옷", image_key, shop_url: url });
      return c.json({ ok: true, type: "wishlist", id: wish.id, message: "위시리스트에 추가했어요" });
    }
    return saveInspiration(image_key);
  }

  if (!url || !isPublicHttpUrl(url)) throw new HttpError(400, "이미지나 URL을 보내 주세요");
  want ??= INSPIRATION_HOSTS.test(new URL(url).hostname) ? "inspiration" : "wishlist";

  // URL 자체가 이미지인 경우
  const direct = await saveRemoteImage(c.env.BUCKET, url);
  if (direct) {
    if (want === "closet") return saveItem(direct, null);
    return saveInspiration(direct);
  }

  const p = await fetchProduct(url).catch(() => null);
  const image_key = p?.image_url ? await saveRemoteImage(c.env.BUCKET, p.image_url) : null;

  if (want === "closet") return saveItem(image_key, p);

  if (want === "inspiration") {
    if (!image_key) throw new HttpError(422, "이 링크에서 사진을 가져오지 못했어요. 사진을 직접 공유해 주세요.");
    return saveInspiration(image_key);
  }

  const wish = await createWish(c.env, {
    name: [p?.brand, p?.name].filter(Boolean).join(" ") || note || url,
    category: p?.category ?? null,
    estimated_price: p?.price ?? null,
    image_key,
    image_url: p?.image_url ?? null,
    shop_url: url,
  });
  return c.json({ ok: true, type: "wishlist", id: wish.id, message: `위시리스트에 추가했어요: ${wish.name}` });
});

export default app;
