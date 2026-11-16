import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import type { Item, OotdAnalysis, OotdPiece } from "../../shared/types";
import { cacheGet, cachePut, getAllItems, wardrobeSignature } from "../lib/db";
import { geminiJson, loadImage, type GeminiImage } from "../lib/gemini";
import { loadImage as loadR2Image } from "../lib/images";
import { applyVerification, OOTD_SCHEMA, OOTD_VERIFY_SCHEMA, ootdPrompt, ootdVerifyPrompt, pickVerifyTargets, sanitizeOotd, suggestedItemIds } from "../lib/ootd";
import { HttpError, sha256Hex } from "../lib/util";
import { asString, isRecord, optBool, optImageKey, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

/** 후보 옷 사진 한 장의 최대 크기 (무료 티어 토큰/요청 크기를 아끼려고 큰 사진은 대조에서 뺀다) */
const VERIFY_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const VERIFY_MAX_IMAGES = 6;

/**
 * 2단계: 헷갈리는 piece만 후보 옷 사진을 같이 보내 다시 확인한다.
 * 실패해도(사진 없음, Gemini 오류) 1단계 결과를 그대로 쓴다.
 */
async function verifyWithImages(env: Env, selfie: GeminiImage, pieces: OotdPiece[], items: Item[]): Promise<{ pieces: OotdPiece[]; verified: boolean }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const targets = pickVerifyTargets(pieces, (id) => Boolean(byId.get(id)?.image_key), VERIFY_MAX_IMAGES);
  if (!targets.length) return { pieces, verified: false };
  try {
    const ids = [...new Set(targets.flatMap((t) => t.item_ids))];
    const loaded = await Promise.all(
      ids.map(async (id) => {
        const key = byId.get(id)?.image_key;
        return key ? loadR2Image(env, key, VERIFY_IMAGE_MAX_BYTES).catch(() => null) : null;
      }),
    );
    const okIds = ids.filter((_, i) => loaded[i] !== null);
    const images = loaded.filter((x): x is GeminiImage => x !== null);
    const usable = targets.map((t) => ({ ...t, item_ids: t.item_ids.filter((id) => okIds.includes(id)) })).filter((t) => t.item_ids.length >= 2);
    if (!usable.length) return { pieces, verified: false };
    const raw = await geminiJson(env, ootdVerifyPrompt(pieces, usable, okIds), OOTD_VERIFY_SCHEMA, [selfie, ...images], 0.1);
    return { pieces: applyVerification(pieces, usable, raw), verified: true };
  } catch (e) {
    console.error("ootd verify failed", e);
    return { pieces, verified: false };
  }
}

/**
 * 거울 셀카 → 옷장 매칭 후보.
 * 요청 { image_key, force?, verify? } → OotdAnalysis. 같은 사진 + 같은 옷장이면 캐시.
 * 기록 저장은 사용자가 후보를 확인한 뒤 POST /logs 로 한다 (selfie_key 포함).
 */
app.post("/analyze", async (c) => {
  const b = await readJson(c);
  const imageKey = optImageKey(b, "image_key", "셀카");
  if (!imageKey) throw new HttpError(400, "셀카 사진이 필요해요");
  const force = optBool(b, "force") ?? false;
  const verify = optBool(b, "verify") ?? true;

  const [items, sig] = await Promise.all([getAllItems(c.env.DB), wardrobeSignature(c.env.DB)]);
  if (!items.length) throw new HttpError(400, "옷장에 옷을 먼저 등록해 주세요");
  const valid = new Set(items.map((i) => i.id));
  const key = `ootd:${await sha256Hex(`${imageKey}|${sig}`)}`;

  if (!force) {
    const cached = await cacheGet(c.env.DB, key);
    if (isRecord(cached)) {
      const { summary, pieces } = sanitizeOotd(cached, valid);
      const result: OotdAnalysis = {
        image_key: imageKey,
        summary,
        pieces,
        suggested_item_ids: suggestedItemIds(pieces),
        verified: cached.verified === true,
        analyzed_at: asString(cached.analyzed_at),
        cached: true,
      };
      return c.json(result);
    }
  }

  const selfie = await loadImage(c.env, imageKey);
  const first = sanitizeOotd(await geminiJson(c.env, ootdPrompt(items), OOTD_SCHEMA, [selfie], 0.2), valid);
  if (!first.pieces.length) throw new HttpError(422, "사진에서 옷을 찾지 못했어요. 전신이 잘 보이는 사진으로 다시 시도해 주세요.");
  const { pieces, verified } = verify ? await verifyWithImages(c.env, selfie, first.pieces, items) : { pieces: first.pieces, verified: false };

  const result: OotdAnalysis = {
    image_key: imageKey,
    summary: first.summary,
    pieces,
    suggested_item_ids: suggestedItemIds(pieces),
    verified,
    analyzed_at: new Date().toISOString(),
    cached: false,
  };
  await cachePut(c.env.DB, key, result);
  return c.json(result);
});

export default app;
