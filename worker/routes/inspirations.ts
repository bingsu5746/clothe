import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { Inspiration, InspirationAnalysis } from "../../shared/types";
import { coerceInspirationAnalysis, getAllItems, rowToInspiration, type Row } from "../lib/db";
import { geminiJson, INSPIRATION_SCHEMA, loadImage } from "../lib/gemini";
import { deleteUnreferencedImages } from "../lib/images";
import { inspirationPrompt } from "../lib/stylist";
import { searchShopping, toRecommendedLinks, wishSearchQuery } from "../lib/shopping";
import { HttpError, newId } from "../lib/util";
import { optEnum, optImageKey, optLink, optStr, paramId, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

async function getInspiration(db: D1Database, id: string): Promise<Inspiration> {
  const row = await db.prepare("SELECT * FROM inspirations WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "저장한 코디 사진을 찾을 수 없어요");
  return rowToInspiration(row);
}

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM inspirations ORDER BY created_at DESC").all<Row>();
  return c.json(results.map(rowToInspiration));
});

app.get("/:id", async (c) => c.json(await getInspiration(c.env.DB, paramId(c))));

app.post("/", async (c) => {
  const b = await readJson(c);
  const image_key = optImageKey(b, "image_key", "사진");
  if (!image_key) throw new HttpError(400, "사진이 필요해요");
  const id = newId();
  const kind = optEnum(b, "kind", ["photo", "collage"] as const, "종류") ?? "photo";
  await c.env.DB.prepare("INSERT INTO inspirations (id, kind, image_key, source_url, note) VALUES (?, ?, ?, ?, ?)")
    .bind(id, kind, image_key, optLink(b, "source_url", 2000, "출처 링크") ?? null, optStr(b, "note", 500, "메모") ?? null)
    .run();
  return c.json(await getInspiration(c.env.DB, id), 201);
});

app.patch("/:id", async (c) => {
  const id = paramId(c);
  const b = await readJson(c);
  // 예전 동작 유지: 보낸 값만 바꾸고, null/빈 값은 "바꾸지 않음"으로 본다
  await c.env.DB.prepare("UPDATE inspirations SET note = COALESCE(?, note), source_url = COALESCE(?, source_url) WHERE id = ?")
    .bind(optStr(b, "note", 500, "메모") ?? null, optLink(b, "source_url", 2000, "출처 링크") ?? null, id)
    .run();
  return c.json(await getInspiration(c.env.DB, id));
});

app.delete("/:id", async (c) => {
  const id = paramId(c);
  const row = await c.env.DB.prepare("SELECT image_key FROM inspirations WHERE id = ?").bind(id).first<{ image_key: string }>();
  await c.env.DB.prepare("DELETE FROM inspirations WHERE id = ?").bind(id).run();
  // 위시리스트 등이 같은 이미지를 쓰고 있으면 지우지 않음
  await deleteUnreferencedImages(c.env, [row?.image_key]);
  return c.json({ ok: true });
});

/** Gemini 응답 정리: 옷장에 없는 id 제거(최대 3개), 이전 분석의 wishlist_id 유지 */
export function sanitizeInspirationAnalysis(raw: unknown, validIds: Set<string>, previous: InspirationAnalysis | null): InspirationAnalysis {
  const a = coerceInspirationAnalysis(raw) ?? { summary: "", pieces: [] };
  return {
    summary: a.summary,
    pieces: a.pieces.slice(0, 12).map((p, i) => ({
      ...p,
      matched_item_ids: p.matched_item_ids.filter((x) => validIds.has(x)).slice(0, 3),
      wishlist_id: previous?.pieces[i]?.wishlist_id ?? null,
    })),
  };
}

/** 사진 속 옷을 나눠 분석하고 내 옷장과 매칭. 결과는 DB에 저장되어 재호출하지 않음 (force=true면 다시 분석). */
app.post("/:id/analyze", async (c) => {
  const id = paramId(c);
  const force = c.req.query("force") === "true";
  const insp = await getInspiration(c.env.DB, id);
  if (insp.analysis && !force) return c.json(insp);

  const items = await getAllItems(c.env.DB);
  const img = await loadImage(c.env, insp.image_key);
  const raw = await geminiJson(c.env, inspirationPrompt(items), INSPIRATION_SCHEMA, [img], 0.4);
  const analysis = sanitizeInspirationAnalysis(raw, new Set(items.map((i) => i.id)), insp.analysis);
  if (!analysis.pieces.length) throw new HttpError(422, "사진에서 옷을 찾지 못했어요. 옷이 잘 보이는 사진으로 다시 시도해 주세요.");
  await c.env.DB.prepare("UPDATE inspirations SET analysis = ? WHERE id = ?").bind(JSON.stringify(analysis), id).run();
  return c.json({ ...insp, analysis });
});

/**
 * 분석된 piece 하나를 위시리스트에 추가하고, 바로 구매 링크(네이버 쇼핑 결과 또는 쇼핑몰 검색 링크)도 찾아 둔다.
 * 링크 찾기가 실패해도 추가는 성공으로 본다.
 */
app.post("/:id/pieces/:index/wishlist", async (c) => {
  const id = paramId(c);
  const index = Number(c.req.param("index"));
  const insp = await getInspiration(c.env.DB, id);
  const piece = Number.isInteger(index) ? insp.analysis?.pieces[index] : undefined;
  if (!insp.analysis || !piece) throw new HttpError(400, "먼저 사진을 분석해 주세요");
  if (piece.wishlist_id) return c.json({ wishlist_id: piece.wishlist_id });

  const wid = newId();
  piece.wishlist_id = wid;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO wishlist (id, name, category, description, colors, image_key, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(wid, piece.description || "스크랩에서 추가한 옷", piece.category, insp.analysis.summary, JSON.stringify(piece.colors), insp.image_key, id),
    c.env.DB.prepare("UPDATE inspirations SET analysis = ? WHERE id = ?").bind(JSON.stringify(insp.analysis), id),
  ]);
  try {
    const name = piece.description || "스크랩에서 추가한 옷";
    const links = toRecommendedLinks(await searchShopping(c.env, wishSearchQuery({ name, colors: piece.colors }).slice(0, 100), 5));
    await c.env.DB.prepare("UPDATE wishlist SET recommended_links = ? WHERE id = ?").bind(JSON.stringify(links), wid).run();
  } catch (e) {
    console.error("wishlist links failed", e);
  }
  return c.json({ wishlist_id: wid }, 201);
});

export default app;
