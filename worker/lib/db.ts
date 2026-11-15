import {
  SEASONS,
  type Inspiration,
  type InspirationAnalysis,
  type InspirationPiece,
  type Item,
  type Outfit,
  type OutfitLog,
  type PurchaseValidation,
  type ShoppingLink,
  type WishlistItemV2,
} from "../../shared/types";
import { parseJsonUnknown } from "./util";
import { asArray, asCategory, asEnum, asNumber, asRecord, asString, asStringArray, isRecord } from "./validate";

export type Row = Record<string, unknown>;

export function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** JSON 컬럼(문자열 배열)을 안전하게 읽는다. 깨진 값이면 빈 배열. */
export function jsonStrings(v: unknown, maxItems = 200): string[] {
  return asStringArray(parseJsonUnknown(v), maxItems, 500);
}

export function rowToItem(r: Row): Item {
  return {
    id: String(r.id),
    name: asString(r.name, "이름 없는 옷"),
    brand: strOrNull(r.brand),
    category: asCategory(r.category, "top"),
    sub_category: strOrNull(r.sub_category),
    colors: jsonStrings(r.colors),
    material: strOrNull(r.material),
    fit: strOrNull(r.fit),
    season: jsonStrings(r.season).flatMap((s) => SEASONS.filter((x) => x === s)),
    style_tags: jsonStrings(r.style_tags),
    warmth: numOrNull(r.warmth),
    image_key: strOrNull(r.image_key),
    original_shop_url: strOrNull(r.original_shop_url),
    purchase_price: numOrNull(r.purchase_price),
    wear_count: numOrNull(r.wear_count) ?? 0,
    last_worn_date: strOrNull(r.last_worn_date),
    notes: strOrNull(r.notes),
    created_at: asString(r.created_at),
  };
}

export function rowToOutfit(r: Row): Outfit {
  return {
    id: String(r.id),
    name: asString(r.name, "내 코디"),
    item_ids: jsonStrings(r.item_ids),
    source: asEnum(r.source, ["manual", "ai", "reference"] as const) ?? "manual",
    reason: strOrNull(r.reason),
    tags: jsonStrings(r.tags),
    created_at: asString(r.created_at),
  };
}

export function coerceInspirationAnalysis(v: unknown): InspirationAnalysis | null {
  if (!isRecord(v) || !Array.isArray(v.pieces)) return null;
  const pieces: InspirationPiece[] = v.pieces.filter(isRecord).map((p) => ({
    category: asCategory(p.category, "accessory"),
    description: asString(p.description),
    colors: asStringArray(p.colors, 10, 40),
    matched_item_ids: asStringArray(p.matched_item_ids, 3, 64),
    wishlist_id: strOrNull(p.wishlist_id),
  }));
  return { summary: asString(v.summary), pieces };
}

export function rowToInspiration(r: Row): Inspiration {
  return {
    id: String(r.id),
    image_key: asString(r.image_key),
    source_url: strOrNull(r.source_url),
    note: strOrNull(r.note),
    analysis: coerceInspirationAnalysis(parseJsonUnknown(r.analysis)),
    created_at: asString(r.created_at),
  };
}

const LINK_SOURCES = ["naver_search", "musinsa_search", "29cm_search", "naver_item", "custom"] as const;

export function coerceLinks(v: unknown, max = 20): ShoppingLink[] {
  const out: ShoppingLink[] = [];
  for (const x of asArray(v)) {
    if (!isRecord(x)) continue;
    const url = asString(x.url);
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      title: asString(x.title, url, 200) || url,
      url,
      source: asEnum(x.source, LINK_SOURCES) ?? "custom",
      price: asNumber(x.price),
      image_url: strOrNull(x.image_url),
      mall: strOrNull(x.mall),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** DB에 저장해 둔 판독 결과를 읽는다 (우리가 저장한 JSON이지만 모양이 깨졌으면 null) */
export function coerceValidation(v: unknown): PurchaseValidation | null {
  if (!isRecord(v) || typeof v.score !== "number" || !isRecord(v.breakdown)) return null;
  const b = v.breakdown;
  for (const k of ["duplicate", "synergy", "personal_color", "body_fit"]) {
    const part = b[k];
    if (!isRecord(part) || typeof part.max !== "number" || typeof part.comment !== "string") return null;
  }
  if (!Array.isArray(asRecord(b.duplicate).similar) || !Array.isArray(asRecord(b.synergy).outfits)) return null;
  return { ...(v as unknown as PurchaseValidation), stale: false };
}

export function rowToWish(r: Row): WishlistItemV2 {
  return {
    id: String(r.id),
    name: asString(r.name, "이름 없는 옷"),
    category: asEnum(r.category, ["outer", "top", "bottom", "dress", "shoes", "bag", "accessory"] as const),
    description: strOrNull(r.description),
    colors: jsonStrings(r.colors),
    estimated_price: numOrNull(r.estimated_price),
    image_key: strOrNull(r.image_key),
    image_url: strOrNull(r.image_url),
    shop_url: strOrNull(r.shop_url),
    reference_id: strOrNull(r.reference_id),
    status: asEnum(r.status, ["wanted", "bought", "dropped"] as const) ?? "wanted",
    bought_item_id: strOrNull(r.bought_item_id),
    created_at: asString(r.created_at),
    validator_score: numOrNull(r.validator_score),
    validator_comment: strOrNull(r.validator_comment),
    validation: coerceValidation(parseJsonUnknown(r.validation)),
    recommended_links: coerceLinks(parseJsonUnknown(r.recommended_links)),
  };
}

export function rowToLog(r: Row): OutfitLog {
  return {
    id: String(r.id),
    worn_date: asString(r.worn_date),
    outfit_id: strOrNull(r.outfit_id),
    item_ids: jsonStrings(r.item_ids),
    weather_summary: strOrNull(r.weather_summary),
    selfie_key: strOrNull(r.selfie_key),
    rating: numOrNull(r.rating),
    occasion_tags: jsonStrings(r.occasion_tags),
    note: strOrNull(r.note),
    created_at: asString(r.created_at),
  };
}

export async function getAllItems(db: D1Database): Promise<Item[]> {
  const { results } = await db.prepare("SELECT * FROM items ORDER BY created_at DESC").all<Row>();
  return results.map(rowToItem);
}

/** 옷장이 바뀌면 달라지는 문자열 (AI 캐시 키에 사용). 착용 횟수만 바뀐 경우에는 달라지지 않는다. */
export async function wardrobeSignature(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS u, COALESCE(GROUP_CONCAT(id), '') AS ids FROM items")
    .first<{ n: number; u: string; ids: string }>();
  return `${row?.n}|${row?.u}|${row?.ids}`;
}

/** AI 캐시 조회. 타입은 호출하는 쪽에서 검증한다. */
export async function cacheGet(db: D1Database, key: string): Promise<unknown> {
  const row = await db.prepare("SELECT value FROM ai_cache WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (parseJsonUnknown(row.value) ?? null) : null;
}

const CACHE_TTL_DAYS = 90;

export async function cachePut(db: D1Database, key: string, value: unknown): Promise<void> {
  const put = db
    .prepare("INSERT INTO ai_cache (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = datetime('now')")
    .bind(key, JSON.stringify(value));
  // 가끔 오래된 캐시를 정리한다 (표가 끝없이 커지지 않게)
  if (Math.random() < 0.05) {
    await db.batch([put, db.prepare(`DELETE FROM ai_cache WHERE created_at < datetime('now', '-${CACHE_TTL_DAYS} days')`)]);
  } else {
    await put.run();
  }
}

/** Gemini 프롬프트에 넣을 옷장 요약 (이미지 없이 텍스트만 → 토큰 절약) */
export function wardrobeForPrompt(items: Item[]): string {
  return items
    .map((i) =>
      [
        `id=${i.id}`,
        `category=${i.category}`,
        `name=${i.name}`,
        i.sub_category ? `kind=${i.sub_category}` : "",
        i.colors.length ? `colors=${i.colors.join("/")}` : "",
        i.material ? `material=${i.material}` : "",
        i.fit ? `fit=${i.fit}` : "",
        i.warmth ? `warmth=${i.warmth}/5` : "",
        i.season.length ? `season=${i.season.join("/")}` : "",
        i.style_tags.length ? `style=${i.style_tags.join("/")}` : "",
        `worn=${i.wear_count}`,
        i.last_worn_date ? `last_worn=${i.last_worn_date}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}
