import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import type { Category, TryOn } from "../../shared/types";
import { sessionSecret, signedImagePath } from "../lib/auth";
import { rowToItem, rowToWish, type Row } from "../lib/db";
import { deleteUnreferencedImages, loadImage, type LoadedImage } from "../lib/images";
import { getProfile } from "../lib/profile";
import { saveRemoteImage } from "../lib/shop";
import { dataUrl, geminiTryOn, idmCategory, imageExtension, replicateCreate, replicateDownload, replicateGet, rowToTryOn, tryOnAvailability } from "../lib/tryon";
import { HttpError, isPublicHttpUrl, newId } from "../lib/util";
import { optCategory, optImageKey, optStr, paramId, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

/** 가상 피팅 입력 사진 한 장의 최대 크기 */
const TRYON_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
/** Replicate 문서: 256kb 이하는 data URL, 그보다 크면 HTTP URL 권장 */
const DATA_URL_MAX_BYTES = 256 * 1024;
const REPLICATE_STALE_MS = 15 * 60 * 1000;
const GEMINI_STALE_MS = 4 * 60 * 1000;

async function getJob(db: D1Database, id: string): Promise<{ job: TryOn; row: Row }> {
  const row = await db.prepare("SELECT * FROM tryons WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "가상 피팅 기록을 찾을 수 없어요");
  return { job: rowToTryOn(row), row };
}

function sqlTime(v: string): number {
  const t = Date.parse(`${v.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? 0 : t;
}

async function finish(env: Env, id: string, result: { image?: LoadedImage; error?: string }): Promise<void> {
  if (result.image) {
    const key = `tryon/${id}.${imageExtension(result.image.mimeType)}`;
    await env.BUCKET.put(key, result.image.data, { httpMetadata: { contentType: result.image.mimeType } });
    await env.DB.prepare("UPDATE tryons SET status = 'succeeded', result_image_key = ?, error = NULL, updated_at = datetime('now') WHERE id = ?").bind(key, id).run();
  } else {
    await env.DB.prepare("UPDATE tryons SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .bind((result.error ?? "가상 피팅에 실패했어요").slice(0, 500), id)
      .run();
  }
}

function failureMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  console.error("tryon failed", e);
  return "가상 피팅 중 오류가 났어요. 잠시 후 다시 시도해 주세요.";
}

/**
 * 작업을 한 단계 진행시킨다 (폴링할 때마다 호출).
 * - replicate: Replicate에 상태를 물어보고, 끝났으면 결과 이미지를 R2에 복사한다.
 * - gemini: 아직 queued면 이 요청이 작업을 "차지"해서 그 자리에서 생성한다 (그래서 첫 폴링 응답은 오래 걸릴 수 있다).
 *   동시에 온 다른 폴링은 processing을 보고 바로 돌아간다.
 */
async function advance(env: Env, job: TryOn, row: Row): Promise<void> {
  if (job.status === "succeeded" || job.status === "failed") return;
  const age = Date.now() - sqlTime(job.updated_at);

  if (job.provider === "replicate") {
    const externalId = typeof row.external_id === "string" ? row.external_id : "";
    if (!externalId) return finish(env, job.id, { error: "가상 피팅 요청 정보가 없어요. 다시 시도해 주세요." });
    try {
      const p = await replicateGet(env, externalId);
      if (p.status === "succeeded") {
        if (!p.output) return await finish(env, job.id, { error: "가상 피팅 결과 이미지가 없어요. 다시 시도해 주세요." });
        return await finish(env, job.id, { image: await replicateDownload(env, p.output) });
      }
      if (p.status === "failed" || p.status === "canceled") {
        return await finish(env, job.id, { error: `가상 피팅에 실패했어요${p.error ? `: ${p.error}` : ""}` });
      }
    } catch (e) {
      // 일시적인 조회 실패는 다음 폴링에서 다시 시도. 너무 오래되면 아래에서 실패 처리.
      console.error("replicate poll failed", e);
    }
    if (Date.now() - sqlTime(job.created_at) > REPLICATE_STALE_MS) await finish(env, job.id, { error: "가상 피팅이 너무 오래 걸려서 중단했어요. 다시 시도해 주세요." });
    return;
  }

  // gemini
  if (job.status === "queued") {
    const claim = await env.DB.prepare("UPDATE tryons SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'queued'").bind(job.id).run();
    if (claim.meta.changes !== 1) return; // 다른 요청이 먼저 차지함
    try {
      const [person, garment] = await Promise.all([
        loadImage(env, job.person_image_key, TRYON_IMAGE_MAX_BYTES),
        loadImage(env, job.garment_image_key, TRYON_IMAGE_MAX_BYTES),
      ]);
      const description = typeof row.description === "string" ? row.description : "";
      await finish(env, job.id, { image: await geminiTryOn(env, job.model, person, garment, job.category, description) });
    } catch (e) {
      await finish(env, job.id, { error: failureMessage(e) });
    }
    return;
  }
  if (age > GEMINI_STALE_MS) await finish(env, job.id, { error: "가상 피팅이 너무 오래 걸려서 중단했어요. 다시 시도해 주세요." });
}

/** 가상 피팅을 쓸 수 있는지. 못 쓰면 reason/setup_hint에 이유와 켜는 방법 (프런트는 이때 2D 콜라주만 보여 준다). */
app.get("/status", (c) => c.json(tryOnAvailability(c.env)));

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM tryons ORDER BY created_at DESC LIMIT 50").all<Row>();
  return c.json(results.map(rowToTryOn));
});

interface Garment {
  image_key: string;
  item_id: string | null;
  wish_id: string | null;
  category: Category | null;
  description: string;
}

async function resolveGarment(env: Env, b: Record<string, unknown>): Promise<Garment> {
  const itemId = optStr(b, "item_id", 64);
  const wishId = optStr(b, "wish_id", 64);
  const rawKey = optImageKey(b, "garment_image_key", "옷 사진");
  if ([itemId, wishId, rawKey].filter(Boolean).length !== 1) throw new HttpError(400, "입혀 볼 옷을 하나만 골라 주세요 (item_id, wish_id, garment_image_key 중 하나)");

  if (itemId) {
    const row = await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first<Row>();
    if (!row) throw new HttpError(404, "옷을 찾을 수 없어요");
    const item = rowToItem(row);
    if (!item.image_key) throw new HttpError(400, "이 옷에는 사진이 없어서 가상 피팅을 할 수 없어요");
    return { image_key: item.image_key, item_id: item.id, wish_id: null, category: item.category, description: [item.colors[0], item.name].filter(Boolean).join(" ") };
  }
  if (wishId) {
    const row = await env.DB.prepare("SELECT * FROM wishlist WHERE id = ?").bind(wishId).first<Row>();
    if (!row) throw new HttpError(404, "위시리스트 항목을 찾을 수 없어요");
    const wish = rowToWish(row);
    let key = wish.image_key;
    if (!key && wish.image_url && isPublicHttpUrl(wish.image_url)) {
      // 쇼핑몰 이미지 URL만 있는 경우: R2로 가져와서 위시리스트에도 저장해 둔다
      key = await saveRemoteImage(env.BUCKET, wish.image_url);
      if (key) await env.DB.prepare("UPDATE wishlist SET image_key = ? WHERE id = ?").bind(key, wish.id).run();
    }
    if (!key && wish.image_url) throw new HttpError(422, "쇼핑몰에서 이 옷 사진을 가져오지 못했어요 (사이트가 막았을 수 있어요). 사진을 저장해서 위시리스트에 직접 올려 주세요.");
    if (!key) throw new HttpError(400, "이 위시리스트 항목에는 사진이 없어서 가상 피팅을 할 수 없어요");
    return { image_key: key, item_id: null, wish_id: wish.id, category: wish.category, description: wish.name };
  }
  if (!rawKey) throw new HttpError(400, "입혀 볼 옷을 골라 주세요");
  return { image_key: rawKey, item_id: null, wish_id: null, category: null, description: "" };
}

/** Replicate가 내려받을 수 있는 이미지 주소: 작으면 data URL, 크면 15분짜리 서명 URL (로컬 개발처럼 공개 주소가 아니면 data URL) */
async function replicateImageRef(env: Env, origin: string, key: string): Promise<string> {
  const img = await loadImage(env, key, TRYON_IMAGE_MAX_BYTES);
  if (img.data.length <= DATA_URL_MAX_BYTES || !origin.startsWith("https://") || !isPublicHttpUrl(origin)) return dataUrl(img);
  return `${origin}${await signedImagePath(await sessionSecret(env), key)}`;
}

/**
 * 가상 피팅 시작 → 202 + TryOn(status: queued | processing). 이후 GET /tryon/:id 로 폴링.
 * 본문: { person_image_key?, item_id? | wish_id? | garment_image_key?, category?, description? }
 */
app.post("/", async (c) => {
  const availability = tryOnAvailability(c.env);
  if (!availability.available || !availability.provider || !availability.model) {
    throw new HttpError(503, availability.reason ?? "가상 피팅을 쓸 수 없어요");
  }
  const b = await readJson(c);
  const garment = await resolveGarment(c.env, b);
  const category = optCategory(b) ?? garment.category;
  const description = optStr(b, "description", 200, "옷 설명") ?? garment.description;

  let person = optImageKey(b, "person_image_key", "전신 사진") ?? null;
  if (!person) {
    const profile = await getProfile(c.env.DB);
    person = profile.mannequin_images[0] ?? profile.body_image_key;
  }
  if (!person) throw new HttpError(400, "전신 사진을 먼저 등록해 주세요 (프로필의 마네킹 사진)");

  const id = newId();
  let externalId: string | null = null;
  let status: "queued" | "processing" = "queued";

  if (availability.provider === "replicate") {
    const idm = idmCategory(category);
    if (!idm) throw new HttpError(400, "이 종류(신발/가방/액세서리)는 가상 피팅을 지원하지 않아요. 상의·아우터·하의·원피스만 가능해요.");
    const origin = new URL(c.req.url).origin;
    const [human_img, garm_img] = await Promise.all([replicateImageRef(c.env, origin, person), replicateImageRef(c.env, origin, garment.image_key)]);
    // crop: true → 사진 비율이 3:4가 아니어도 모델이 알아서 잘라 쓴다 (전신 사진은 보통 3:4가 아님)
    const prediction = await replicateCreate(c.env, availability.model, { human_img, garm_img, garment_des: description, category: idm, crop: true });
    externalId = prediction.id;
    status = "processing";
  } else {
    // 사진이 있는지 미리 확인 (없으면 여기서 404)
    await Promise.all([loadImage(c.env, person, TRYON_IMAGE_MAX_BYTES), loadImage(c.env, garment.image_key, TRYON_IMAGE_MAX_BYTES)]);
  }

  await c.env.DB.prepare(
    `INSERT INTO tryons (id, status, provider, model, person_image_key, garment_image_key, garment_item_id, garment_wish_id, category, description, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, status, availability.provider, availability.model, person, garment.image_key, garment.item_id, garment.wish_id, category ?? null, description, externalId)
    .run();
  return c.json((await getJob(c.env.DB, id)).job, 202);
});

/** 작업 상태 조회(폴링). 진행 중이면 한 단계 진행시킨 뒤 최신 상태를 돌려준다. */
app.get("/:id", async (c) => {
  const id = paramId(c);
  const { job, row } = await getJob(c.env.DB, id);
  if (job.status === "succeeded" || job.status === "failed") return c.json(job);
  await advance(c.env, job, row);
  return c.json((await getJob(c.env.DB, id)).job);
});

app.delete("/:id", async (c) => {
  const id = paramId(c);
  const row = await c.env.DB.prepare("SELECT person_image_key, garment_image_key, result_image_key FROM tryons WHERE id = ?").bind(id).first<Row>();
  await c.env.DB.prepare("DELETE FROM tryons WHERE id = ?").bind(id).run();
  if (row) {
    const keys = [row.result_image_key, row.person_image_key, row.garment_image_key].filter((k): k is string => typeof k === "string");
    await deleteUnreferencedImages(c.env, keys); // 프로필/옷장이 쓰는 사진은 남는다
  }
  return c.json({ ok: true });
});

export default app;
