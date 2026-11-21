import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { CATEGORY_LABEL, type Category, type PurchaseValidation, type ShoppingLink, type WishCombos, type WishlistItemV2 } from "../../shared/types";
import { cacheGet, cachePut, coerceLinks, getAllItems, MAX_STORED_LINKS, rowToItem, rowToWish, wardrobeSignature, type Row } from "../lib/db";
import { geminiJson, loadImage, WISH_COMBOS_SCHEMA, type GeminiImage } from "../lib/gemini";
import { deleteUnreferencedImages } from "../lib/images";
import { getProfile, profileForPrompt } from "../lib/profile";
import { fetchProduct, saveRemoteImage } from "../lib/shop";
import { searchShopping, toRecommendedLinks, wishSearchQuery } from "../lib/shopping";
import { coerceOutfits, sanitizeOutfits, wishPrompt } from "../lib/stylist";
import { HttpError, newId, sha256Hex } from "../lib/util";
import { computeValidation, VALIDATE_SCHEMA, validatePrompt, validationComment } from "../lib/validator";
import { asRecord, asString, asStringArray, isRecord, optCategory, optEnum, optImageKey, optInt, optLink, optStr, optStrArray, paramId, readJson, reqUrl, type Body } from "../lib/validate";

const app = new Hono<AppEnv>();

export type { WishCombos };

const STATUSES = ["wanted", "bought", "dropped"] as const;

export interface WishInput {
  name?: string | null;
  category?: Category | null;
  description?: string | null;
  colors?: string[];
  estimated_price?: number | null;
  image_key?: string | null;
  image_url?: string | null;
  shop_url?: string | null;
}

function readWishFields(b: Body): WishInput & { status?: (typeof STATUSES)[number] | null; recommended_links?: string } {
  const out: WishInput & { status?: (typeof STATUSES)[number] | null; recommended_links?: string } = {};
  const name = optStr(b, "name", 200, "이름");
  if (name !== undefined) out.name = name;
  const category = optCategory(b);
  if (category !== undefined) out.category = category;
  const description = optStr(b, "description", 1000, "설명");
  if (description !== undefined) out.description = description;
  const colors = optStrArray(b, "colors", { maxItems: 10, maxLen: 30 }, "색");
  if (colors !== undefined) out.colors = colors;
  const price = optInt(b, "estimated_price", { min: 0, max: 1_000_000_000 }, "예상 가격");
  if (price !== undefined) out.estimated_price = price;
  const imageKey = optImageKey(b, "image_key", "사진");
  if (imageKey !== undefined) out.image_key = imageKey;
  const imageUrl = optLink(b, "image_url", 2000, "이미지 링크");
  if (imageUrl !== undefined) out.image_url = imageUrl;
  const shopUrl = optLink(b, "shop_url", 2000, "쇼핑몰 링크");
  if (shopUrl !== undefined) out.shop_url = shopUrl;
  const status = optEnum(b, "status", STATUSES, "상태");
  if (status !== undefined) out.status = status;
  if (b.recommended_links !== undefined) {
    if (b.recommended_links !== null && !Array.isArray(b.recommended_links)) throw new HttpError(400, "구매 링크: 목록으로 보내 주세요");
    out.recommended_links = JSON.stringify(coerceLinks(b.recommended_links ?? [], MAX_STORED_LINKS));
  }
  return out;
}

function wishDescription(wish: WishlistItemV2): string {
  return [
    wish.name,
    wish.category ? `종류: ${CATEGORY_LABEL[wish.category]} (${wish.category})` : "",
    wish.colors.length ? `색: ${wish.colors.join("/")}` : "",
    wish.description ? `참고: ${wish.description}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** 판독 캐시 키: 옷 설명 + 옷장 시그니처 + 프로필 버전 */
async function validationKey(desc: string, wardrobeSig: string, profileVersion: number, imageKey: string | null): Promise<string> {
  return sha256Hex(`validate:v2|${desc}|${imageKey ?? ""}|${wardrobeSig}|${profileVersion}`);
}

async function getWishRow(db: D1Database, id: string): Promise<Row> {
  const row = await db.prepare("SELECT * FROM wishlist WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "위시리스트 항목을 찾을 수 없어요");
  return row;
}

/** 저장된 판독 결과가 지금 옷장/프로필 기준으로도 유효한지 표시 */
async function withStale(row: Row, wardrobeSig: string, profileVersion: number): Promise<WishlistItemV2> {
  const wish = rowToWish(row);
  if (wish.validation) {
    wish.validation.stale = row.validation_key !== (await validationKey(wishDescription(wish), wardrobeSig, profileVersion, wish.image_key));
  }
  return wish;
}

async function freshness(db: D1Database): Promise<{ sig: string; version: number }> {
  const [sig, p] = await Promise.all([
    wardrobeSignature(db),
    db.prepare("SELECT version FROM profile WHERE id = 'me'").first<{ version: number }>(),
  ]);
  return { sig, version: p?.version ?? 0 };
}

async function getWish(db: D1Database, id: string): Promise<WishlistItemV2> {
  const [row, f] = await Promise.all([getWishRow(db, id), freshness(db)]);
  return withStale(row, f.sig, f.version);
}

app.get("/", async (c) => {
  const [{ results }, f] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM wishlist ORDER BY status = 'wanted' DESC, created_at DESC").all<Row>(),
    freshness(c.env.DB),
  ]);
  return c.json(await Promise.all(results.map((r) => withStale(r, f.sig, f.version))));
});

app.get("/:id", async (c) => c.json(await getWish(c.env.DB, paramId(c))));

export async function createWish(env: Env, b: WishInput): Promise<WishlistItemV2> {
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO wishlist (id, name, category, description, colors, estimated_price, image_key, image_url, shop_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      b.name?.trim().slice(0, 200) || "이름 없는 옷",
      b.category ?? null,
      b.description ?? null,
      JSON.stringify(b.colors ?? []),
      b.estimated_price ?? null,
      b.image_key ?? null,
      b.image_url ?? null,
      b.shop_url ?? null,
    )
    .run();
  return getWish(env.DB, id);
}

app.post("/", async (c) => c.json(await createWish(c.env, readWishFields(await readJson(c))), 201));

/** 쇼핑몰 URL로 위시리스트 추가 */
app.post("/from-url", async (c) => {
  const url = reqUrl(await readJson(c));
  const p = await fetchProduct(url).catch((e: unknown) => {
    throw new HttpError(502, e instanceof Error ? e.message : "페이지를 불러오지 못했어요");
  });
  const image_key = p.image_url ? await saveRemoteImage(c.env.BUCKET, p.image_url) : null;
  const wish = await createWish(c.env, {
    name: [p.brand, p.name].filter(Boolean).join(" ") || url,
    category: p.category,
    estimated_price: p.price,
    image_key,
    image_url: p.image_url,
    shop_url: url,
  });
  return c.json(wish, 201);
});

app.patch("/:id", async (c) => {
  const id = paramId(c);
  const fields = readWishFields(await readJson(c));
  const before = rowToWish(await getWishRow(c.env.DB, id));
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null | undefined) => {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (fields.name !== undefined) set("name", fields.name ?? "이름 없는 옷");
  set("category", fields.category);
  set("description", fields.description);
  if (fields.colors !== undefined) set("colors", JSON.stringify(fields.colors));
  set("estimated_price", fields.estimated_price);
  set("image_key", fields.image_key);
  set("image_url", fields.image_url);
  set("shop_url", fields.shop_url);
  if (fields.status !== undefined) set("status", fields.status ?? "wanted");
  set("recommended_links", fields.recommended_links);
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE wishlist SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...vals, id)
      .run();
    if (fields.image_key !== undefined && before.image_key && before.image_key !== fields.image_key) await deleteUnreferencedImages(c.env, [before.image_key]);
  }
  return c.json(await getWish(c.env.DB, id));
});

app.delete("/:id", async (c) => {
  const id = paramId(c);
  const row = await c.env.DB.prepare("SELECT image_key FROM wishlist WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  await c.env.DB.prepare("DELETE FROM wishlist WHERE id = ?").bind(id).run();
  // 스크랩 사진이나 "샀어요"로 옮긴 옷이 같은 이미지를 쓰면 지우지 않음
  await deleteUnreferencedImages(c.env, [row?.image_key]);
  return c.json({ ok: true });
});

function coerceCombos(v: unknown, validWithNew: Set<string>): WishCombos {
  const r = asRecord(v);
  return {
    verdict: asString(r.verdict, "", 1000),
    similar_item_ids: asStringArray(r.similar_item_ids, 10, 64).filter((id) => id !== "NEW" && validWithNew.has(id)),
    outfits: sanitizeOutfits(coerceOutfits(r.outfits, 6), validWithNew).filter((o) => o.item_ids.includes("NEW")),
  };
}

async function combosKey(desc: string, sig: string): Promise<string> {
  return `wish:${await sha256Hex(`${desc}|${sig}`)}`;
}

/** 이 옷을 사면 지금 옷장과 만들 수 있는 코디. 옷장이 바뀌지 않으면 캐시 사용. */
app.post("/:id/combos", async (c) => {
  const wish = rowToWish(await getWishRow(c.env.DB, paramId(c)));
  const desc = wishDescription(wish);
  const [sig, items] = await Promise.all([wardrobeSignature(c.env.DB), getAllItems(c.env.DB)]);
  const valid = new Set([...items.map((i) => i.id), "NEW"]);
  const key = await combosKey(desc, sig);
  if (c.req.query("force") !== "true") {
    const cached = await cacheGet(c.env.DB, key);
    if (isRecord(cached)) return c.json(coerceCombos(cached, valid));
  }
  if (!items.length) throw new HttpError(400, "옷장에 옷을 먼저 등록해 주세요");
  const result = coerceCombos(await geminiJson(c.env, wishPrompt(items, desc), WISH_COMBOS_SCHEMA), valid);
  await cachePut(c.env.DB, key, result);
  return c.json(result);
});

/**
 * 살까 말까 판독: 0~100점 + 항목별 내역 (규칙은 worker/lib/validator.ts).
 * 결과는 wishlist 행에 저장하고, (옷 설명 + 옷장 + 프로필 버전)이 같으면 다시 호출하지 않는다. ?force=true 면 다시 판독.
 */
app.post("/:id/validate", async (c) => {
  const id = paramId(c);
  const [row, items, profile, sig] = await Promise.all([getWishRow(c.env.DB, id), getAllItems(c.env.DB), getProfile(c.env.DB), wardrobeSignature(c.env.DB)]);
  const wish = rowToWish(row);
  const desc = wishDescription(wish);
  const key = await validationKey(desc, sig, profile.version, wish.image_key);
  if (wish.validation && row.validation_key === key && c.req.query("force") !== "true") {
    return c.json({ ...wish.validation, stale: false, cached: true });
  }
  if (!items.length) throw new HttpError(400, "옷장에 옷을 먼저 등록해 주세요");

  // 옷 사진이 있으면 같이 보낸다 (색/디자인 판단이 정확해짐). 사진을 못 읽어도 글만으로 진행.
  const images: GeminiImage[] = [];
  if (wish.image_key) {
    const img = await loadImage(c.env, wish.image_key).catch(() => null);
    if (img) images.push(img);
  }
  const raw = await geminiJson(c.env, validatePrompt(items, desc, profileForPrompt(profile), images.length > 0), VALIDATE_SCHEMA, images, 0.4);
  const validation: PurchaseValidation = computeValidation(raw, {
    validIds: new Set(items.map((i) => i.id)),
    hasColorProfile: profile.color_analysis !== null,
    hasBodyProfile: profile.body_analysis !== null,
    now: new Date().toISOString(),
  });

  // 같은 판단을 /combos 캐시에도 넣어서, 코디 보기 화면이 Gemini를 한 번 더 부르지 않게 한다
  const combos: WishCombos = {
    verdict: validation.verdict,
    similar_item_ids: validation.breakdown.duplicate.similar.map((s) => s.item_id),
    outfits: validation.breakdown.synergy.outfits,
  };
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE wishlist SET validator_score = ?, validator_comment = ?, validation = ?, validation_key = ? WHERE id = ?").bind(
      validation.score,
      validationComment(validation),
      JSON.stringify(validation),
      key,
      id,
    ),
    c.env.DB.prepare("INSERT INTO ai_cache (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = datetime('now')").bind(
      await combosKey(desc, sig),
      JSON.stringify(combos),
    ),
  ]);
  return c.json({ ...validation, cached: false });
});

/**
 * 검색으로 찾은 링크(naver_item, *_search)는 새 결과로 바꾸고, 직접 추가한 링크(custom)는 그대로 둔다.
 * 같은 주소가 새 결과에도 있으면 새 결과 쪽 하나만 남긴다.
 */
export function mergeRecommendedLinks(previous: ShoppingLink[], fresh: ShoppingLink[]): ShoppingLink[] {
  const custom = previous.filter((l) => l.source === "custom" && !fresh.some((f) => f.url === l.url));
  return [...fresh, ...custom].slice(0, MAX_STORED_LINKS);
}

/** 이 옷의 구매 링크를 찾아서 저장 (네이버 쇼핑 API 키가 있으면 상품, 없으면 쇼핑몰 검색 링크). 직접 추가한 링크는 유지. */
app.post("/:id/links", async (c) => {
  const id = paramId(c);
  const wish = rowToWish(await getWishRow(c.env.DB, id));
  const b = await readJson(c, { allowEmpty: true });
  const query = optStr(b, "query", 100, "검색어") ?? wishSearchQuery(wish);
  const search = await searchShopping(c.env, query, 10);
  const links = mergeRecommendedLinks(wish.recommended_links, toRecommendedLinks(search));
  await c.env.DB.prepare("UPDATE wishlist SET recommended_links = ? WHERE id = ?").bind(JSON.stringify(links), id).run();
  return c.json({ query, source: search.source, notice: search.notice, recommended_links: links });
});

/** 샀어요 → 옷장으로 이동 */
app.post("/:id/bought", async (c) => {
  const wish = rowToWish(await getWishRow(c.env.DB, paramId(c)));
  if (wish.bought_item_id) return c.json({ item_id: wish.bought_item_id });
  const b = await readJson(c, { allowEmpty: true });
  const price = optInt(b, "purchase_price", { min: 0, max: 1_000_000_000 }, "구매 가격");
  const itemId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO items (id, name, category, colors, image_key, original_shop_url, purchase_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(itemId, wish.name, wish.category ?? "top", JSON.stringify(wish.colors), wish.image_key, wish.shop_url, price ?? wish.estimated_price, wish.description),
    c.env.DB.prepare("UPDATE wishlist SET status = 'bought', bought_item_id = ? WHERE id = ?").bind(itemId, wish.id),
  ]);
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first<Row>();
  if (!row) throw new HttpError(500, "옷장으로 옮기지 못했어요");
  return c.json({ item_id: itemId, item: rowToItem(row) }, 201);
});

export default app;
