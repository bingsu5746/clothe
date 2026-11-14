import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/util";

const app = new Hono<AppEnv>();

const ALLOWED_TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/heic", "image/heif", "image/gif", "image/avif"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function storeUpload(bucket: R2Bucket, file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new HttpError(415, "지원하지 않는 이미지 형식이에요");
  if (file.size > MAX_BYTES) throw new HttpError(413, "이미지가 너무 커요 (최대 8MB)");
  const ext = file.type.split("/")[1];
  const key = `img/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

app.post("/images", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "파일이 필요해요");
  return c.json({ key: await storeUpload(c.env.BUCKET, file) }, 201);
});

app.get("/images/:dir/:name", async (c) => {
  const key = `${c.req.param("dir")}/${c.req.param("name")}`;
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.text("not found", 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=31536000, immutable",
      etag: obj.httpEtag,
    },
  });
});

app.get("/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'login_%'").all<{ key: string; value: string }>();
  return c.json(Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value)])));
});

app.put("/settings/:key", async (c) => {
  const key = c.req.param("key");
  if (key.startsWith("login_")) throw new HttpError(400, "변경할 수 없는 설정이에요");
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(await c.req.json()))
    .run();
  return c.json({ ok: true });
});

export default app;
