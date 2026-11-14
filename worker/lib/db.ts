import type { Item, Outfit, Inspiration, WishlistItem, InspirationAnalysis } from "../../shared/types";
import { parseJson } from "./util";

type Row = Record<string, unknown>;

export function rowToItem(r: Row): Item {
  return {
    ...(r as unknown as Item),
    colors: parseJson(r.colors, []),
    season: parseJson(r.season, []),
    style_tags: parseJson(r.style_tags, []),
  };
}

export function rowToOutfit(r: Row): Outfit {
  return { ...(r as unknown as Outfit), item_ids: parseJson(r.item_ids, []), tags: parseJson(r.tags, []) };
}

export function rowToInspiration(r: Row): Inspiration {
  return { ...(r as unknown as Inspiration), analysis: parseJson<InspirationAnalysis | null>(r.analysis, null) };
}

export function rowToWish(r: Row): WishlistItem {
  return { ...(r as unknown as WishlistItem), colors: parseJson(r.colors, []) };
}

export async function getAllItems(db: D1Database): Promise<Item[]> {
  const { results } = await db.prepare("SELECT * FROM items ORDER BY created_at DESC").all();
  return results.map(rowToItem);
}

/** 옷장이 바뀌면 달라지는 문자열 (AI 캐시 키에 사용) */
export async function wardrobeSignature(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS u, COALESCE(GROUP_CONCAT(id), '') AS ids FROM items")
    .first<{ n: number; u: string; ids: string }>();
  return `${row?.n}|${row?.u}|${row?.ids}`;
}

export async function cacheGet<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM ai_cache WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function cachePut(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare("INSERT INTO ai_cache (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = datetime('now')")
    .bind(key, JSON.stringify(value))
    .run();
}

/** Gemini 프롬프트에 넣을 옷장 요약 (이미지 없이 텍스트만 → 토큰 절약) */
export function wardrobeForPrompt(items: Item[]): string {
  return items
    .map((i) =>
      [
        `id=${i.id}`,
        `category=${i.category}`,
        `name=${i.name}`,
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
