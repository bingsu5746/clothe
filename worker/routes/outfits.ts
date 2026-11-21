import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rowToOutfit, type Row } from "../lib/db";
import { deleteUnreferencedImages } from "../lib/images";
import { HttpError, newId } from "../lib/util";
import { optEnum, optIdArray, optImageKey, optStr, optStrArray, paramId, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

const SOURCES = ["manual", "ai", "reference"] as const;

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM outfits ORDER BY created_at DESC").all<Row>();
  return c.json(results.map(rowToOutfit));
});

app.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM outfits WHERE id = ?").bind(paramId(c)).first<Row>();
  if (!row) throw new HttpError(404, "코디를 찾을 수 없어요");
  return c.json(rowToOutfit(row));
});

app.post("/", async (c) => {
  const b = await readJson(c);
  const itemIds = optIdArray(b, "item_ids", 30, "옷 목록") ?? [];
  if (!itemIds.length) throw new HttpError(400, "옷을 하나 이상 골라 주세요");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO outfits (id, name, item_ids, source, reason, tags, cover_image_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(
      id,
      optStr(b, "name", 80, "이름") ?? "내 코디",
      JSON.stringify(itemIds),
      optEnum(b, "source", SOURCES) ?? "manual",
      optStr(b, "reason", 1000, "설명") ?? null,
      JSON.stringify(optStrArray(b, "tags", { maxItems: 15, maxLen: 30 }, "태그") ?? []),
      optImageKey(b, "cover_image_key", "대표 사진") ?? null,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM outfits WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(500, "코디를 저장하지 못했어요");
  return c.json(rowToOutfit(row), 201);
});

app.patch("/:id", async (c) => {
  const id = paramId(c);
  const b = await readJson(c);
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  const name = optStr(b, "name", 80, "이름");
  if (name !== undefined) {
    sets.push("name = ?");
    vals.push(name ?? "내 코디");
  }
  const itemIds = optIdArray(b, "item_ids", 30, "옷 목록");
  if (itemIds !== undefined) {
    if (!itemIds.length) throw new HttpError(400, "옷을 하나 이상 골라 주세요");
    sets.push("item_ids = ?");
    vals.push(JSON.stringify(itemIds));
  }
  const tags = optStrArray(b, "tags", { maxItems: 15, maxLen: 30 }, "태그");
  if (tags !== undefined) {
    sets.push("tags = ?");
    vals.push(JSON.stringify(tags));
  }
  const cover = optImageKey(b, "cover_image_key", "대표 사진");
  const before = await c.env.DB.prepare("SELECT cover_image_key FROM outfits WHERE id = ?").bind(id).first<{ cover_image_key: string | null }>();
  if (!before) throw new HttpError(404, "코디를 찾을 수 없어요");
  if (cover !== undefined) {
    sets.push("cover_image_key = ?");
    vals.push(cover);
  }
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE outfits SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...vals, id)
      .run();
    // 대표 사진을 바꾸거나 지우면 예전 그림은 다른 곳에서 안 쓸 때만 정리
    if (cover !== undefined && before.cover_image_key && before.cover_image_key !== cover) await deleteUnreferencedImages(c.env, [before.cover_image_key]);
  }
  const row = await c.env.DB.prepare("SELECT * FROM outfits WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "코디를 찾을 수 없어요");
  return c.json(rowToOutfit(row));
});

app.delete("/:id", async (c) => {
  const id = paramId(c);
  const row = await c.env.DB.prepare("SELECT cover_image_key FROM outfits WHERE id = ?").bind(id).first<{ cover_image_key: string | null }>();
  await c.env.DB.prepare("DELETE FROM outfits WHERE id = ?").bind(id).run();
  await deleteUnreferencedImages(c.env, [row?.cover_image_key]);
  return c.json({ ok: true });
});

export default app;
