import { Hono } from "hono";
import type { AppEnv } from "../env";
import { CATEGORY_LABEL, type SuggestedOutfit, type WishlistItem } from "../../shared/types";
import { cacheGet, cachePut, getAllItems, rowToItem, rowToWish, wardrobeSignature } from "../lib/db";
import { geminiJson, WISH_COMBOS_SCHEMA } from "../lib/gemini";
import { fetchProduct, saveRemoteImage } from "../lib/shop";
import { sanitizeOutfits, wishPrompt } from "../lib/stylist";
import { HttpError, newId, sha256Hex } from "../lib/util";

const app = new Hono<AppEnv>();

const FIELDS = ["name", "category", "description", "colors", "estimated_price", "image_key", "image_url", "shop_url", "status"] as const;

async function getWish(db: D1Database, id: string): Promise<WishlistItem> {
  const row = await db.prepare("SELECT * FROM wishlist WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "위시리스트 항목을 찾을 수 없어요");
  return rowToWish(row);
}

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM wishlist ORDER BY status = 'wanted' DESC, created_at DESC").all();
  return c.json(results.map(rowToWish));
});

app.get("/:id", async (c) => c.json(await getWish(c.env.DB, c.req.param("id"))));

export async function createWish(env: AppEnv["Bindings"], b: Partial<WishlistItem>): Promise<WishlistItem> {
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO wishlist (id, name, category, description, colors, estimated_price, image_key, image_url, shop_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      b.name?.trim() || "이름 없는 옷",
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

app.post("/", async (c) => c.json(await createWish(c.env, await c.req.json()), 201));

/** 쇼핑몰 URL로 위시리스트 추가 */
app.post("/from-url", async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  if (!url || !/^https?:\/\//.test(url)) throw new HttpError(400, "올바른 URL을 입력해 주세요");
  const p = await fetchProduct(url).catch((e: Error) => {
    throw new HttpError(502, e.message);
  });
  const image_key = p.image_url ? await saveRemoteImage(c.env.BUCKET, p.image_url) : null;
  const wish = await createWish(c.env, {
    name: [p.brand, p.name].filter(Boolean).join(" ") || url,
    estimated_price: p.price,
    image_key,
    image_url: p.image_url,
    shop_url: url,
  });
  return c.json(wish, 201);
});

app.patch("/:id", async (c) => {
  const b = (await c.req.json()) as Record<string, unknown>;
  const keys = FIELDS.filter((f) => f in b);
  if (keys.length) {
    const vals = keys.map((k) => (k === "colors" ? JSON.stringify(b[k] ?? []) : b[k] === "" ? null : b[k]));
    await c.env.DB.prepare(`UPDATE wishlist SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...vals, c.req.param("id"))
      .run();
  }
  return c.json(await getWish(c.env.DB, c.req.param("id")));
});

app.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM wishlist WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export interface WishCombos {
  verdict: string;
  similar_item_ids: string[];
  outfits: SuggestedOutfit[];
}

/** 이 옷을 사면 지금 옷장과 만들 수 있는 코디. 옷장이 바뀌지 않으면 캐시 사용. */
app.post("/:id/combos", async (c) => {
  const wish = await getWish(c.env.DB, c.req.param("id"));
  const desc = [
    wish.name,
    wish.category ? `종류: ${CATEGORY_LABEL[wish.category]} (${wish.category})` : "",
    wish.colors.length ? `색: ${wish.colors.join("/")}` : "",
    wish.description ? `참고: ${wish.description}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const sig = await wardrobeSignature(c.env.DB);
  const key = `wish:${await sha256Hex(`${desc}|${sig}`)}`;
  if (c.req.query("force") !== "true") {
    const cached = await cacheGet<WishCombos>(c.env.DB, key);
    if (cached) return c.json(cached);
  }
  const items = await getAllItems(c.env.DB);
  if (!items.length) throw new HttpError(400, "옷장에 옷을 먼저 등록해 주세요");
  const valid = new Set([...items.map((i) => i.id), "NEW"]);
  const raw = await geminiJson<WishCombos>(c.env, wishPrompt(items, desc), WISH_COMBOS_SCHEMA);
  const result: WishCombos = {
    verdict: raw.verdict,
    similar_item_ids: (raw.similar_item_ids ?? []).filter((id) => id !== "NEW" && valid.has(id)),
    outfits: sanitizeOutfits(raw.outfits ?? [], valid).filter((o) => o.item_ids.includes("NEW")),
  };
  await cachePut(c.env.DB, key, result);
  return c.json(result);
});

/** 샀어요 → 옷장으로 이동 */
app.post("/:id/bought", async (c) => {
  const wish = await getWish(c.env.DB, c.req.param("id"));
  if (wish.bought_item_id) return c.json({ item_id: wish.bought_item_id });
  const b = await c.req.json<{ purchase_price?: number | null }>().catch(() => ({}) as { purchase_price?: number | null });
  const itemId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO items (id, name, category, colors, image_key, original_shop_url, purchase_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      itemId,
      wish.name,
      wish.category ?? "top",
      JSON.stringify(wish.colors),
      wish.image_key,
      wish.shop_url,
      b.purchase_price ?? wish.estimated_price,
      wish.description,
    ),
    c.env.DB.prepare("UPDATE wishlist SET status = 'bought', bought_item_id = ? WHERE id = ?").bind(itemId, wish.id),
  ]);
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first();
  return c.json({ item_id: itemId, item: rowToItem(row!) }, 201);
});

export default app;
