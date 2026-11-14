import { Hono } from "hono";
import type { AppEnv } from "../env";
import { CATEGORIES, type InspirationAnalysis } from "../../shared/types";
import { getAllItems, rowToInspiration } from "../lib/db";
import { geminiJson, INSPIRATION_SCHEMA, loadImage } from "../lib/gemini";
import { inspirationPrompt } from "../lib/stylist";
import { HttpError, newId } from "../lib/util";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM inspirations ORDER BY created_at DESC").all();
  return c.json(results.map(rowToInspiration));
});

app.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM inspirations WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) throw new HttpError(404, "저장한 코디 사진을 찾을 수 없어요");
  return c.json(rowToInspiration(row));
});

app.post("/", async (c) => {
  const b = await c.req.json<{ image_key: string; source_url?: string; note?: string }>();
  if (!b.image_key) throw new HttpError(400, "사진이 필요해요");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO inspirations (id, image_key, source_url, note) VALUES (?, ?, ?, ?)")
    .bind(id, b.image_key, b.source_url ?? null, b.note ?? null)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM inspirations WHERE id = ?").bind(id).first();
  return c.json(rowToInspiration(row!), 201);
});

app.patch("/:id", async (c) => {
  const b = await c.req.json<{ note?: string; source_url?: string }>();
  await c.env.DB.prepare("UPDATE inspirations SET note = COALESCE(?, note), source_url = COALESCE(?, source_url) WHERE id = ?")
    .bind(b.note ?? null, b.source_url ?? null, c.req.param("id"))
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM inspirations WHERE id = ?").bind(c.req.param("id")).first();
  return c.json(rowToInspiration(row!));
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT image_key FROM inspirations WHERE id = ?").bind(id).first<{ image_key: string }>();
  await c.env.DB.prepare("DELETE FROM inspirations WHERE id = ?").bind(id).run();
  // 위시리스트가 같은 이미지를 쓰고 있으면 지우지 않음
  if (row?.image_key) {
    const used = await c.env.DB.prepare("SELECT 1 FROM wishlist WHERE image_key = ? LIMIT 1").bind(row.image_key).first();
    if (!used) await c.env.BUCKET.delete(row.image_key);
  }
  return c.json({ ok: true });
});

/** 사진 속 옷을 나눠 분석하고 내 옷장과 매칭. 결과는 DB에 저장되어 재호출하지 않음 (force=true면 다시 분석). */
app.post("/:id/analyze", async (c) => {
  const id = c.req.param("id");
  const force = c.req.query("force") === "true";
  const row = await c.env.DB.prepare("SELECT * FROM inspirations WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "저장한 코디 사진을 찾을 수 없어요");
  const insp = rowToInspiration(row);
  if (insp.analysis && !force) return c.json(insp);

  const items = await getAllItems(c.env.DB);
  const valid = new Set(items.map((i) => i.id));
  const img = await loadImage(c.env, insp.image_key);
  const raw = await geminiJson<InspirationAnalysis>(c.env, inspirationPrompt(items), INSPIRATION_SCHEMA, [img]);
  const prevPieces = insp.analysis?.pieces ?? [];
  const analysis: InspirationAnalysis = {
    summary: raw.summary,
    pieces: raw.pieces.map((p, i) => ({
      category: CATEGORIES.includes(p.category) ? p.category : "accessory",
      description: p.description,
      colors: p.colors ?? [],
      matched_item_ids: (p.matched_item_ids ?? []).filter((x) => valid.has(x)).slice(0, 3),
      wishlist_id: prevPieces[i]?.wishlist_id ?? null,
    })),
  };
  await c.env.DB.prepare("UPDATE inspirations SET analysis = ? WHERE id = ?").bind(JSON.stringify(analysis), id).run();
  return c.json({ ...insp, analysis });
});

/** 분석된 piece 하나를 위시리스트에 추가 */
app.post("/:id/pieces/:index/wishlist", async (c) => {
  const id = c.req.param("id");
  const index = Number(c.req.param("index"));
  const row = await c.env.DB.prepare("SELECT * FROM inspirations WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "저장한 코디 사진을 찾을 수 없어요");
  const insp = rowToInspiration(row);
  const piece = insp.analysis?.pieces[index];
  if (!insp.analysis || !piece) throw new HttpError(400, "먼저 사진을 분석해 주세요");
  if (piece.wishlist_id) return c.json({ wishlist_id: piece.wishlist_id });

  const wid = newId();
  piece.wishlist_id = wid;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO wishlist (id, name, category, description, colors, image_key, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(wid, piece.description, piece.category, insp.analysis.summary, JSON.stringify(piece.colors), insp.image_key, id),
    c.env.DB.prepare("UPDATE inspirations SET analysis = ? WHERE id = ?").bind(JSON.stringify(insp.analysis), id),
  ]);
  return c.json({ wishlist_id: wid }, 201);
});

export default app;
