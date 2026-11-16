import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import type { Profile } from "../../shared/types";
import { geminiJson, loadImage } from "../lib/gemini";
import { deleteUnreferencedImages } from "../lib/images";
import { BODY_SCHEMA, bodyPrompt, COLOR_SCHEMA, colorPrompt, getProfile, sanitizeBodyAnalysis, sanitizeColorAnalysis, sanitizeSamples } from "../lib/profile";
import { HttpError } from "../lib/util";
import { optBool, optImageKey, optImageKeyArray, optNum, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

type SqlValue = string | number | null;

/** 프로필 행(id='me')을 만들거나 고친다. bumpVersion이면 version을 1 올린다. */
async function saveProfile(db: D1Database, fields: Record<string, SqlValue>, bumpVersion: boolean): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const insertCols = ["id", ...keys, "version"];
  const updates = [...keys.map((k) => `${k} = excluded.${k}`), "updated_at = datetime('now')"];
  if (bumpVersion) updates.push("version = profile.version + 1");
  await db
    .prepare(
      `INSERT INTO profile (${insertCols.join(", ")}) VALUES ('me', ${keys.map(() => "?").join(", ")}, ?)
       ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`,
    )
    .bind(...Object.values(fields), bumpVersion ? 1 : 0)
    .run();
}

async function cleanupReplaced(env: Env, before: Profile, after: Profile): Promise<void> {
  const still = new Set([after.face_image_key, after.body_image_key, ...after.mannequin_images]);
  const gone = [before.face_image_key, before.body_image_key, ...before.mannequin_images].filter((k) => k && !still.has(k));
  await deleteUnreferencedImages(env, gone);
}

app.get("/", async (c) => c.json(await getProfile(c.env.DB)));

/** 키/몸무게/사진 저장 (보낸 필드만 바뀜. null을 보내면 지움) */
async function updateProfile(env: Env, b: Record<string, unknown>): Promise<Profile> {
  const before = await getProfile(env.DB);
  const fields: Record<string, SqlValue> = {};
  const height = optNum(b, "height_cm", { min: 50, max: 250 }, "키");
  if (height !== undefined) fields.height_cm = height;
  const weight = optNum(b, "weight_kg", { min: 20, max: 300 }, "몸무게");
  if (weight !== undefined) fields.weight_kg = weight;
  const face = optImageKey(b, "face_image_key", "얼굴 사진");
  if (face !== undefined) fields.face_image_key = face;
  const body = optImageKey(b, "body_image_key", "전신 사진");
  if (body !== undefined) fields.body_image_key = body;
  const mannequins = optImageKeyArray(b, "mannequin_images", 6, "마네킹 사진");
  if (mannequins !== undefined) fields.mannequin_images = JSON.stringify(mannequins);

  // 키/몸무게가 바뀌면 체형 조언에 영향을 주므로 version을 올린다 (사진만 바뀐 경우는 진단을 다시 해야 바뀜)
  const bump = (height !== undefined && height !== before.height_cm) || (weight !== undefined && weight !== before.weight_kg);
  await saveProfile(env.DB, fields, bump);
  const after = await getProfile(env.DB);
  await cleanupReplaced(env, before, after);
  return after;
}

app.put("/", async (c) => c.json(await updateProfile(c.env, await readJson(c))));
app.patch("/", async (c) => c.json(await updateProfile(c.env, await readJson(c))));

/**
 * 퍼스널 컬러 진단. 얼굴 사진(image_key, 없으면 프로필의 face_image_key) + 선택적으로 클라이언트가 뽑은 색 샘플.
 * 같은 사진의 진단 결과가 이미 있으면 Gemini를 다시 부르지 않는다 (force=true면 다시 진단).
 */
app.post("/analyze-color", async (c) => {
  const b = await readJson(c, { allowEmpty: true });
  const profile = await getProfile(c.env.DB);
  const imageKey = optImageKey(b, "image_key", "얼굴 사진") ?? profile.face_image_key;
  if (!imageKey) throw new HttpError(400, "얼굴 사진을 먼저 올려 주세요");
  const force = optBool(b, "force") ?? false;
  if (!force && profile.color_analysis?.image_key === imageKey) {
    if (profile.face_image_key !== imageKey) await saveProfile(c.env.DB, { face_image_key: imageKey }, false);
    return c.json({ ...(await getProfile(c.env.DB)), cached: true });
  }

  const samples = sanitizeSamples(b.samples);
  const img = await loadImage(c.env, imageKey);
  const raw = await geminiJson(c.env, colorPrompt(samples), COLOR_SCHEMA, [img], 0.2);
  const analysis = sanitizeColorAnalysis(raw, samples, imageKey, new Date().toISOString());
  if (!analysis) throw new HttpError(502, "퍼스널 컬러 진단 결과를 해석하지 못했어요. 다시 시도해 주세요.");
  await saveProfile(c.env.DB, { face_image_key: imageKey, color_analysis: JSON.stringify(analysis) }, true);
  const after = await getProfile(c.env.DB);
  await cleanupReplaced(c.env, profile, after);
  return c.json({ ...after, cached: false });
});

/**
 * 체형 진단. 전신 사진(image_key, 없으면 프로필의 body_image_key → 첫 번째 마네킹 사진).
 * 같은 사진의 진단 결과가 이미 있으면 다시 부르지 않는다 (force=true면 다시 진단).
 */
app.post("/analyze-body", async (c) => {
  const b = await readJson(c, { allowEmpty: true });
  const profile = await getProfile(c.env.DB);
  const imageKey = optImageKey(b, "image_key", "전신 사진") ?? profile.body_image_key ?? profile.mannequin_images[0] ?? null;
  if (!imageKey) throw new HttpError(400, "전신 사진을 먼저 올려 주세요");
  const force = optBool(b, "force") ?? false;
  if (!force && profile.body_analysis?.image_key === imageKey) {
    if (profile.body_image_key !== imageKey) await saveProfile(c.env.DB, { body_image_key: imageKey }, false);
    return c.json({ ...(await getProfile(c.env.DB)), cached: true });
  }

  const img = await loadImage(c.env, imageKey);
  const raw = await geminiJson(c.env, bodyPrompt(profile.height_cm, profile.weight_kg), BODY_SCHEMA, [img], 0.2);
  const analysis = sanitizeBodyAnalysis(raw, imageKey, new Date().toISOString());
  if (!analysis) throw new HttpError(502, "체형 진단 결과를 해석하지 못했어요. 다시 시도해 주세요.");
  await saveProfile(c.env.DB, { body_image_key: imageKey, body_analysis: JSON.stringify(analysis) }, true);
  const after = await getProfile(c.env.DB);
  await cleanupReplaced(c.env, profile, after);
  return c.json({ ...after, cached: false });
});

/** 진단 결과 지우기 (kind = color | body) */
app.delete("/analysis/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "color" && kind !== "body") throw new HttpError(404, "없는 API예요");
  await saveProfile(c.env.DB, { [kind === "color" ? "color_analysis" : "body_analysis"]: null }, true);
  return c.json(await getProfile(c.env.DB));
});

export default app;
