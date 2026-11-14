import { Hono } from "hono";
import type { AppEnv } from "../env";
import { CATEGORIES, SEASONS, type ItemTagging } from "../../shared/types";
import { cacheGet, cachePut, rowToItem } from "../lib/db";
import { geminiJson, loadImage, TAGGING_SCHEMA } from "../lib/gemini";
import { fetchProduct, saveRemoteImage } from "../lib/shop";
import { taggingPrompt } from "../lib/stylist";
import { HttpError, newId, todayKST } from "../lib/util";

const app = new Hono<AppEnv>();

const FIELDS = [
  "name", "brand", "category", "sub_category", "colors", "material", "fit", "season", "style_tags",
  "warmth", "image_key", "original_shop_url", "purchase_price", "wear_count", "last_worn_date", "notes",
] as const;
const JSON_FIELDS = new Set(["colors", "season", "style_tags"]);

function normalize(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    out[f] = JSON_FIELDS.has(f) ? JSON.stringify(Array.isArray(v) ? v : []) : v === "" ? null : v;
  }
  if ("category" in out && !CATEGORIES.includes(out.category as never)) throw new HttpError(400, "카테고리가 올바르지 않아요");
  return out;
}

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM items ORDER BY created_at DESC").all();
  return c.json(results.map(rowToItem));
});

app.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) throw new HttpError(404, "옷을 찾을 수 없어요");
  return c.json(rowToItem(row));
});

app.post("/", async (c) => {
  const data = normalize(await c.req.json());
  if (!data.name) throw new HttpError(400, "이름을 입력해 주세요");
  if (!data.category) throw new HttpError(400, "카테고리를 골라 주세요");
  const id = newId();
  const cols = ["id", ...Object.keys(data)];
  await c.env.DB.prepare(`INSERT INTO items (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(id, ...Object.values(data))
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first();
  return c.json(rowToItem(row!), 201);
});

app.patch("/:id", async (c) => {
  const data = normalize(await c.req.json());
  const keys = Object.keys(data);
  if (keys.length) {
    await c.env.DB.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...Object.values(data), c.req.param("id"))
      .run();
  }
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) throw new HttpError(404, "옷을 찾을 수 없어요");
  return c.json(rowToItem(row));
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT image_key FROM items WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  await c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  if (row?.image_key) {
    // 저장한 코디 사진이나 위시리스트가 같은 이미지를 쓰면 지우지 않음
    const used = await c.env.DB.prepare(
      "SELECT 1 FROM inspirations WHERE image_key = ?1 UNION ALL SELECT 1 FROM wishlist WHERE image_key = ?1 LIMIT 1",
    ).bind(row.image_key).first();
    if (!used) await c.env.BUCKET.delete(row.image_key);
  }
  return c.json({ ok: true });
});

/** 사진으로 옷 정보 자동 태깅 (결과는 이미지별로 캐시) */
app.post("/analyze", async (c) => {
  const { image_key } = await c.req.json<{ image_key: string }>();
  if (!image_key) throw new HttpError(400, "image_key가 필요해요");
  const cacheKey = `tag:${image_key}`;
  const cached = await cacheGet<ItemTagging>(c.env.DB, cacheKey);
  if (cached) return c.json(cached);
  const img = await loadImage(c.env, image_key);
  const raw = await geminiJson<ItemTagging>(c.env, taggingPrompt(), TAGGING_SCHEMA, [img]);
  const tagging: ItemTagging = {
    ...raw,
    category: CATEGORIES.includes(raw.category) ? raw.category : "top",
    season: (raw.season ?? []).filter((s) => SEASONS.includes(s)),
    warmth: Math.min(5, Math.max(1, Math.round(raw.warmth || 3))),
  };
  await cachePut(c.env.DB, cacheKey, tagging);
  return c.json(tagging);
});

/** 쇼핑몰 URL → 상품 정보 + 이미지 R2 저장 */
app.post("/import-url", async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  if (!url || !/^https?:\/\//.test(url)) throw new HttpError(400, "올바른 URL을 입력해 주세요");
  const product = await fetchProduct(url).catch((e: Error) => {
    throw new HttpError(502, e.message);
  });
  const image_key = product.image_url ? await saveRemoteImage(c.env.BUCKET, product.image_url) : null;
  return c.json({ ...product, image_key });
});

/** 착용 기록: 착용 횟수 +1, 마지막 착용일 갱신, 기록 저장 */
app.post("/wear", async (c) => {
  const body = await c.req.json<{ item_ids: string[]; outfit_id?: string; date?: string; weather_summary?: string }>();
  const ids = [...new Set(body.item_ids ?? [])];
  if (!ids.length) throw new HttpError(400, "입은 옷을 골라 주세요");
  const date = body.date ?? todayKST();
  const stmts = [
    c.env.DB.prepare("INSERT INTO outfit_logs (id, worn_date, outfit_id, item_ids, weather_summary) VALUES (?, ?, ?, ?, ?)").bind(
      newId(), date, body.outfit_id ?? null, JSON.stringify(ids), body.weather_summary ?? null,
    ),
    ...ids.map((id) =>
      c.env.DB.prepare(
        "UPDATE items SET wear_count = wear_count + 1, last_worn_date = CASE WHEN last_worn_date IS NULL OR last_worn_date < ? THEN ? ELSE last_worn_date END WHERE id = ?",
      ).bind(date, date, id),
    ),
  ];
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

export default app;
