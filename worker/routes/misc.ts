import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError, parseJsonUnknown } from "../lib/util";
import { isImageKey } from "../lib/validate";

const app = new Hono<AppEnv>();

const ALLOWED_TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/heic", "image/heif", "image/gif", "image/avif"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function storeUpload(bucket: R2Bucket, file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new HttpError(415, "지원하지 않는 이미지 형식이에요");
  if (file.size === 0) throw new HttpError(400, "빈 파일이에요");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "이미지가 너무 커요 (최대 8MB)");
  const ext = file.type.split("/")[1];
  const key = `img/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

app.post("/images", async (c) => {
  const form = await c.req.formData().catch(() => {
    throw new HttpError(400, "파일 업로드 형식(multipart/form-data)이 아니에요");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "파일이 필요해요");
  return c.json({ key: await storeUpload(c.env.BUCKET, file) }, 201);
});

/**
 * R2 이미지를 내려준다. key마다 내용이 바뀌지 않으므로 1년 immutable 캐시 + ETag.
 * If-None-Match가 같으면 본문 없이 304.
 */
export async function serveImage(bucket: R2Bucket, key: string, request: Request, cacheControl: string): Promise<Response> {
  if (!isImageKey(key)) return Response.json({ error: "이미지를 찾을 수 없어요" }, { status: 404 });
  const obj = await bucket.get(key, { onlyIf: request.headers });
  if (!obj) return Response.json({ error: "이미지를 찾을 수 없어요" }, { status: 404 });
  const headers = new Headers({ "cache-control": cacheControl, etag: obj.httpEtag });
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  headers.set("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("content-length", String(obj.size));
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}

app.get("/images/:dir/:name", (c) =>
  serveImage(c.env.BUCKET, `${c.req.param("dir")}/${c.req.param("name")}`, c.req.raw, "private, max-age=31536000, immutable"),
);

const SETTING_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_SETTING_BYTES = 8 * 1024;

app.get("/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'login_%'").all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const r of results) {
    const v = parseJsonUnknown(r.value);
    if (v !== undefined) out[r.key] = v; // 깨진 값은 건너뜀
  }
  return c.json(out);
});

app.put("/settings/:key", async (c) => {
  const key = c.req.param("key");
  if (!SETTING_KEY_RE.test(key) || key.startsWith("login_")) throw new HttpError(400, "변경할 수 없는 설정이에요");
  const text = await c.req.text();
  if (text.length > MAX_SETTING_BYTES) throw new HttpError(413, "설정 값이 너무 커요");
  const value = parseJsonUnknown(text);
  if (value === undefined) throw new HttpError(400, "요청 형식이 올바르지 않아요 (JSON이 아니에요)");
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
  return c.json({ ok: true });
});

export default app;
