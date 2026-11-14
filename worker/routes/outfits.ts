import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rowToOutfit } from "../lib/db";
import { HttpError, newId } from "../lib/util";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM outfits ORDER BY created_at DESC").all();
  return c.json(results.map(rowToOutfit));
});

app.post("/", async (c) => {
  const b = await c.req.json<{ name?: string; item_ids: string[]; source?: string; reason?: string; tags?: string[] }>();
  if (!b.item_ids?.length) throw new HttpError(400, "옷을 하나 이상 골라 주세요");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO outfits (id, name, item_ids, source, reason, tags) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, b.name?.trim() || "내 코디", JSON.stringify(b.item_ids), b.source ?? "manual", b.reason ?? null, JSON.stringify(b.tags ?? []))
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM outfits WHERE id = ?").bind(id).first();
  return c.json(rowToOutfit(row!), 201);
});

app.patch("/:id", async (c) => {
  const b = await c.req.json<{ name?: string; item_ids?: string[]; tags?: string[] }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.name !== undefined) (sets.push("name = ?"), vals.push(b.name));
  if (b.item_ids !== undefined) (sets.push("item_ids = ?"), vals.push(JSON.stringify(b.item_ids)));
  if (b.tags !== undefined) (sets.push("tags = ?"), vals.push(JSON.stringify(b.tags)));
  if (sets.length) await c.env.DB.prepare(`UPDATE outfits SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, c.req.param("id")).run();
  const row = await c.env.DB.prepare("SELECT * FROM outfits WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) throw new HttpError(404, "코디를 찾을 수 없어요");
  return c.json(rowToOutfit(row));
});

app.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM outfits WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default app;
