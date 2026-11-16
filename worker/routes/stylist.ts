import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { DormantItem, SimilarLookResult, TodayResult, Weather } from "../../shared/types";
import { cacheGet, cachePut, getAllItems, wardrobeSignature } from "../lib/db";
import { findDormantItems } from "../lib/dormant";
import { geminiJson, loadImage, OUTFITS_SCHEMA, type GeminiImage } from "../lib/gemini";
import { getProfile, profileForPrompt } from "../lib/profile";
import { coerceOutfits, sanitizeOutfits, SIMILAR_SCHEMA, similarPrompt, todayPrompt } from "../lib/stylist";
import { fetchWeather, geocode } from "../lib/weather";
import { isWeather } from "../../shared/weather";
import { HttpError, sha256Hex, todayKST } from "../lib/util";
import { asArray, asRecord, asString, isRecord, optBool, optEnum, optImageKey, optNum, optStr, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

export type { TodayResult };

function coordinate(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

app.get("/weather", async (c) => {
  const lat = coordinate(c.req.query("lat"), -90, 90);
  const lon = coordinate(c.req.query("lon"), -180, 180);
  if (lat === null || lon === null) throw new HttpError(400, "위치가 필요해요");
  const name = c.req.query("name")?.slice(0, 80) ?? null;
  return c.json(
    await fetchWeather(lat, lon, name).catch((e: unknown) => {
      throw new HttpError(502, e instanceof Error ? e.message : "날씨를 불러오지 못했어요");
    }),
  );
});

app.get("/geocode", async (c) => {
  const q = c.req.query("q")?.trim().slice(0, 80);
  if (!q) return c.json([]);
  return c.json(
    await geocode(q).catch((e: unknown) => {
      throw new HttpError(502, e instanceof Error ? e.message : "위치 검색에 실패했어요");
    }),
  );
});

function coerceDormant(v: unknown, validIds: Set<string>): DormantItem[] {
  const out: DormantItem[] = [];
  for (const x of asArray(v)) {
    if (!isRecord(x) || typeof x.item_id !== "string" || !validIds.has(x.item_id)) continue;
    out.push({
      item_id: x.item_id,
      reasons: asArray(x.reasons).flatMap((r) => (r === "never_worn" || r === "long_unworn" || r === "high_cpw" ? [r] : [])),
      reason: asString(x.reason),
      days_idle: typeof x.days_idle === "number" ? x.days_idle : null,
      cpw: typeof x.cpw === "number" ? x.cpw : null,
      score: typeof x.score === "number" ? x.score : 0,
    });
  }
  return out;
}

async function resolveWeather(b: Record<string, unknown>): Promise<Weather | null> {
  // 날씨는 보통 브라우저가 Open-Meteo에서 직접 받아서 보낸다 (Worker 공용 IP의 요청 한도를 피하려고)
  if (isWeather(b.weather)) return b.weather;
  const lat = optNum(b, "lat", { min: -90, max: 90 }, "위도");
  const lon = optNum(b, "lon", { min: -180, max: 180 }, "경도");
  if (lat == null || lon == null) return null;
  return fetchWeather(lat, lon, optStr(b, "location_name", 80) ?? null).catch(() => null);
}

/**
 * 날씨 + 키워드 기반 오늘의 코디 추천. 같은 날/같은 조건이면 캐시 사용 (refresh=true면 새로 추천).
 * 프로필(퍼스널 컬러/체형)이 있으면 프롬프트에 반영하고, 장롱템 후보를 넘겨 하나 섞어 달라고 한다.
 */
app.post("/today", async (c) => {
  const b = await readJson(c, { allowEmpty: true });
  const keywords = optStr(b, "keywords", 300, "키워드") ?? "";
  const refresh = optBool(b, "refresh") ?? false;
  const [items, profile, sig] = await Promise.all([getAllItems(c.env.DB), getProfile(c.env.DB), wardrobeSignature(c.env.DB)]);
  if (items.length < 2) throw new HttpError(400, "추천을 받으려면 옷장에 옷을 2벌 이상 등록해 주세요");

  const weather = await resolveWeather(b);
  const today = todayKST();
  const valid = new Set(items.map((i) => i.id));
  const wkey = weather ? `${Math.round(weather.temp_min)}|${Math.round(weather.temp_max)}|${weather.weather_code}` : "none";
  const key = `today:${await sha256Hex(`v2|${today}|${wkey}|${keywords}|${sig}|p${profile.version}`)}`;

  if (!refresh) {
    const cached = await cacheGet(c.env.DB, key);
    if (isRecord(cached)) {
      const result: TodayResult = {
        weather: weather ?? (isWeather(cached.weather) ? cached.weather : null),
        briefing: asString(cached.briefing),
        outfits: sanitizeOutfits(coerceOutfits(cached.outfits), valid),
        dormant: coerceDormant(cached.dormant, valid),
        profile_used: cached.profile_used === true,
      };
      return c.json(result);
    }
  }

  const dormant = findDormantItems(items, today, 8);
  const profileText = profileForPrompt(profile);
  const raw = asRecord(await geminiJson(c.env, todayPrompt(items, weather, keywords, today, { profile: profileText, dormant }), OUTFITS_SCHEMA));
  const result: TodayResult = {
    weather,
    briefing: asString(raw.briefing, "", 1000),
    outfits: sanitizeOutfits(coerceOutfits(raw.outfits), valid),
    dormant,
    profile_used: profileText !== null,
  };
  if (!result.outfits.length) throw new HttpError(502, "추천 결과가 비어 있어요. 다시 시도해 주세요.");
  await cachePut(c.env.DB, key, result);
  return c.json(result);
});

const MODES = ["similar", "couple"] as const;

/**
 * 시밀러룩/커플룩: 상대 옷차림(사진 그리고/또는 설명) → 내 옷장에서 어울리는 코디.
 * 같은 입력 + 같은 옷장이면 캐시 사용 (refresh=true면 새로 추천).
 */
app.post("/similar", async (c) => {
  const b = await readJson(c);
  const imageKey = optImageKey(b, "partner_image_key", "상대 옷 사진") ?? null;
  const description = optStr(b, "partner_description", 500, "상대 옷 설명") ?? "";
  if (!imageKey && !description) throw new HttpError(400, "상대가 입을 옷의 사진이나 설명을 넣어 주세요");
  const mode = optEnum(b, "mode", MODES, "모드") ?? "similar";
  const keywords = optStr(b, "keywords", 300, "키워드") ?? "";
  const refresh = optBool(b, "refresh") ?? false;

  const [items, profile, sig] = await Promise.all([getAllItems(c.env.DB), getProfile(c.env.DB), wardrobeSignature(c.env.DB)]);
  if (items.length < 2) throw new HttpError(400, "추천을 받으려면 옷장에 옷을 2벌 이상 등록해 주세요");
  const valid = new Set(items.map((i) => i.id));
  const weather = await resolveWeather(b);
  const wkey = weather ? `${Math.round(weather.temp_min)}|${Math.round(weather.temp_max)}` : "none";
  const key = `similar:${await sha256Hex(`${mode}|${imageKey ?? ""}|${description}|${keywords}|${wkey}|${sig}|p${profile.version}`)}`;

  if (!refresh) {
    const cached = await cacheGet(c.env.DB, key);
    if (isRecord(cached)) {
      const result: SimilarLookResult = {
        mode,
        partner_summary: asString(cached.partner_summary),
        outfits: sanitizeOutfits(coerceOutfits(cached.outfits), valid),
        cached: true,
      };
      return c.json(result);
    }
  }

  const images: GeminiImage[] = imageKey ? [await loadImage(c.env, imageKey)] : [];
  const prompt = similarPrompt(items, { mode, description, hasImage: images.length > 0, weather, keywords, profile: profileForPrompt(profile) });
  const raw = asRecord(await geminiJson(c.env, prompt, SIMILAR_SCHEMA, images));
  const result: SimilarLookResult = {
    mode,
    partner_summary: asString(raw.partner_summary, "", 600),
    outfits: sanitizeOutfits(coerceOutfits(raw.outfits, 4), valid),
    cached: false,
  };
  if (!result.outfits.length) throw new HttpError(502, "추천 결과가 비어 있어요. 다시 시도해 주세요.");
  await cachePut(c.env.DB, key, result);
  return c.json(result);
});

export default app;
