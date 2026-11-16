import { Hono } from "hono";
import type { AppEnv } from "../env";
import { SEASONS, type ItemTagging } from "../../shared/types";
import { cacheGet, cachePut, getAllItems, rowToItem, type Row } from "../lib/db";
import { findDormantItems } from "../lib/dormant";
import { geminiJson, loadImage, TAGGING_SCHEMA } from "../lib/gemini";
import { deleteUnreferencedImages } from "../lib/images";
import { createLog } from "../lib/logs";
import { fetchProduct, saveRemoteImage } from "../lib/shop";
import { taggingPrompt } from "../lib/stylist";
import { HttpError, newId, todayKST } from "../lib/util";
import {
  asCategory, asNumber, asRecord, asString, asStringArray, isRecord, optCategory, optDate, optImageKey, optInt, optLink, optStr, optStrArray, paramId, readJson, reqUrl,
  type Body,
} from "../lib/validate";
import { readLogFields, toLogInput } from "./logs";

const app = new Hono<AppEnv>();

type SqlValue = string | number | null;

/** 요청 본문에서 옷 필드를 읽어 DB 컬럼 값으로 바꾼다 (보낸 필드만) */
export function readItemFields(b: Body): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  const put = (key: string, v: SqlValue | undefined) => {
    if (v !== undefined) out[key] = v;
  };
  put("name", optStr(b, "name", 120, "이름"));
  put("brand", optStr(b, "brand", 80, "브랜드"));
  put("category", optCategory(b));
  put("sub_category", optStr(b, "sub_category", 60, "세부 종류"));
  put("material", optStr(b, "material", 80, "소재"));
  put("fit", optStr(b, "fit", 60, "핏"));
  put("warmth", optInt(b, "warmth", { min: 1, max: 5 }, "보온성"));
  put("image_key", optImageKey(b, "image_key", "사진"));
  put("original_shop_url", optLink(b, "original_shop_url", 2000, "쇼핑몰 링크"));
  put("purchase_price", optInt(b, "purchase_price", { min: 0, max: 1_000_000_000 }, "구매 가격"));
  put("wear_count", optInt(b, "wear_count", { min: 0, max: 100000 }, "착용 횟수"));
  put("last_worn_date", optDate(b, "last_worn_date", "마지막 착용일"));
  put("notes", optStr(b, "notes", 1000, "메모"));
  const colors = optStrArray(b, "colors", { maxItems: 10, maxLen: 30 }, "색");
  if (colors !== undefined) out.colors = JSON.stringify(colors);
  const season = optStrArray(b, "season", { maxItems: 4, maxLen: 10 }, "계절");
  if (season !== undefined) {
    if (season.some((s) => !SEASONS.some((x) => x === s))) throw new HttpError(400, "계절: spring, summer, fall, winter 중에서 골라 주세요");
    out.season = JSON.stringify(season);
  }
  const tags = optStrArray(b, "style_tags", { maxItems: 15, maxLen: 30 }, "스타일 태그");
  if (tags !== undefined) out.style_tags = JSON.stringify(tags);
  // 직접 입력한 마지막 착용일은 기준값으로도 저장 (착용 기록을 지워도 이 날짜 아래로 내려가지 않음, worker/lib/wear.ts)
  if ("last_worn_date" in out) out.base_last_worn_date = out.last_worn_date;
  if ("name" in out && out.name === null) throw new HttpError(400, "이름을 입력해 주세요");
  if ("category" in out && out.category === null) throw new HttpError(400, "카테고리를 골라 주세요");
  if ("wear_count" in out && out.wear_count === null) out.wear_count = 0;
  return out;
}

app.get("/", async (c) => c.json(await getAllItems(c.env.DB)));

/** 장롱템 목록 (기준은 worker/lib/dormant.ts) */
app.get("/dormant", async (c) => {
  const items = await getAllItems(c.env.DB);
  return c.json(findDormantItems(items, todayKST(), 50));
});

/** 사진으로 옷 정보 자동 태깅 (결과는 이미지별로 캐시) */
app.post("/analyze", async (c) => {
  const b = await readJson(c);
  const image_key = optImageKey(b, "image_key", "사진");
  if (!image_key) throw new HttpError(400, "image_key가 필요해요");
  const cacheKey = `tag:${image_key}`;
  const cached = await cacheGet(c.env.DB, cacheKey);
  if (isRecord(cached) && typeof cached.name === "string") return c.json(sanitizeTagging(cached));
  const img = await loadImage(c.env, image_key);
  const tagging = sanitizeTagging(await geminiJson(c.env, taggingPrompt(), TAGGING_SCHEMA, [img], 0.3));
  await cachePut(c.env.DB, cacheKey, tagging);
  return c.json(tagging);
});

export function sanitizeTagging(raw: unknown): ItemTagging {
  const r = asRecord(raw);
  const warmth = asNumber(r.warmth);
  return {
    name: asString(r.name, "", 120) || "새 옷",
    category: asCategory(r.category, "top"),
    sub_category: asString(r.sub_category, "", 60),
    colors: asStringArray(r.colors, 10, 30),
    material: asString(r.material, "", 80),
    fit: asString(r.fit, "", 60),
    season: asStringArray(r.season, 4, 10).flatMap((s) => SEASONS.filter((x) => x === s.toLowerCase())),
    style_tags: asStringArray(r.style_tags, 8, 30),
    warmth: Math.min(5, Math.max(1, Math.round(warmth ?? 3))),
  };
}

/** 쇼핑몰 URL → 상품 정보 + 이미지 R2 저장 */
app.post("/import-url", async (c) => {
  const url = reqUrl(await readJson(c));
  const product = await fetchProduct(url).catch((e: unknown) => {
    throw new HttpError(502, e instanceof Error ? e.message : "페이지를 불러오지 못했어요");
  });
  const image_key = product.image_url ? await saveRemoteImage(c.env.BUCKET, product.image_url) : null;
  return c.json({ ...product, image_key });
});

/**
 * 착용 기록 (예전부터 있던 엔드포인트. POST /logs 와 같은 규칙).
 * 같은 날짜에 같은 옷 조합을 다시 보내면 기록을 새로 만들지 않고 횟수도 올리지 않는다 (duplicate: true).
 */
app.post("/wear", async (c) => {
  const { log, duplicate } = await createLog(c.env, toLogInput(readLogFields(await readJson(c))));
  return c.json({ ok: true, log_id: log.id, duplicate });
});

app.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(paramId(c)).first<Row>();
  if (!row) throw new HttpError(404, "옷을 찾을 수 없어요");
  return c.json(rowToItem(row));
});

app.post("/", async (c) => {
  const data = readItemFields(await readJson(c));
  if (!data.name) throw new HttpError(400, "이름을 입력해 주세요");
  if (!data.category) throw new HttpError(400, "카테고리를 골라 주세요");
  const id = newId();
  const cols = ["id", ...Object.keys(data)];
  await c.env.DB.prepare(`INSERT INTO items (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(id, ...Object.values(data))
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(500, "옷을 저장하지 못했어요");
  return c.json(rowToItem(row), 201);
});

app.patch("/:id", async (c) => {
  const id = paramId(c);
  const data = readItemFields(await readJson(c));
  const keys = Object.keys(data);
  const before = await c.env.DB.prepare("SELECT image_key FROM items WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  if (!before) throw new HttpError(404, "옷을 찾을 수 없어요");
  if (keys.length) {
    // 착용 횟수/마지막 착용일만 바뀐 경우에는 updated_at을 건드리지 않는다 (AI 추천 캐시가 불필요하게 무효화되지 않게)
    const touch = keys.some((k) => k !== "wear_count" && k !== "last_worn_date" && k !== "base_last_worn_date");
    await c.env.DB.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(", ")}${touch ? ", updated_at = datetime('now')" : ""} WHERE id = ?`)
      .bind(...Object.values(data), id)
      .run();
    if ("image_key" in data && before.image_key && before.image_key !== data.image_key) await deleteUnreferencedImages(c.env, [before.image_key]);
  }
  const row = await c.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "옷을 찾을 수 없어요");
  return c.json(rowToItem(row));
});

app.delete("/:id", async (c) => {
  const id = paramId(c);
  const row = await c.env.DB.prepare("SELECT image_key FROM items WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  await c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  // 스크랩/위시리스트/피팅 기록 등이 같은 이미지를 쓰면 지우지 않음
  await deleteUnreferencedImages(c.env, [row?.image_key]);
  return c.json({ ok: true });
});

export default app;
