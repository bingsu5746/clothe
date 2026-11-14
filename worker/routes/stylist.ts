import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { SuggestedOutfit, Weather } from "../../shared/types";
import { cacheGet, cachePut, getAllItems, wardrobeSignature } from "../lib/db";
import { geminiJson, OUTFITS_SCHEMA } from "../lib/gemini";
import { sanitizeOutfits, todayPrompt } from "../lib/stylist";
import { fetchWeather, geocode } from "../lib/weather";
import { isWeather } from "../../shared/weather";
import { HttpError, sha256Hex, todayKST } from "../lib/util";

const app = new Hono<AppEnv>();

app.get("/weather", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, "위치가 필요해요");
  return c.json(await fetchWeather(lat, lon, c.req.query("name") ?? null));
});

app.get("/geocode", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json([]);
  return c.json(await geocode(q));
});

export interface TodayResult {
  weather: Weather | null;
  briefing: string;
  outfits: SuggestedOutfit[];
}

/** 날씨 + 키워드 기반 오늘의 코디 추천. 같은 날/같은 조건이면 캐시 사용 (refresh=true면 새로 추천). */
app.post("/today", async (c) => {
  const b = await c.req.json<{ weather?: unknown; lat?: number; lon?: number; location_name?: string; keywords?: string; refresh?: boolean }>();
  const items = await getAllItems(c.env.DB);
  if (items.length < 2) throw new HttpError(400, "추천을 받으려면 옷장에 옷을 2벌 이상 등록해 주세요");

  // 날씨는 보통 브라우저가 Open-Meteo에서 직접 받아서 보낸다 (Worker 공용 IP의 요청 한도를 피하려고)
  let weather: Weather | null = isWeather(b.weather) ? b.weather : null;
  if (!weather && Number.isFinite(b.lat) && Number.isFinite(b.lon)) {
    weather = await fetchWeather(b.lat!, b.lon!, b.location_name ?? null).catch(() => null);
  }
  const today = todayKST();
  const keywords = (b.keywords ?? "").trim();
  const sig = await wardrobeSignature(c.env.DB);
  const wkey = weather ? `${Math.round(weather.temp_min)}|${Math.round(weather.temp_max)}|${weather.weather_code}` : "none";
  const key = `today:${await sha256Hex(`${today}|${wkey}|${keywords}|${sig}`)}`;

  if (!b.refresh) {
    const cached = await cacheGet<TodayResult>(c.env.DB, key);
    if (cached) return c.json({ ...cached, weather: weather ?? cached.weather });
  }

  const raw = await geminiJson<{ briefing: string; outfits: SuggestedOutfit[] }>(c.env, todayPrompt(items, weather, keywords, today), OUTFITS_SCHEMA);
  const result: TodayResult = {
    weather,
    briefing: raw.briefing,
    outfits: sanitizeOutfits(raw.outfits ?? [], new Set(items.map((i) => i.id))),
  };
  await cachePut(c.env.DB, key, result);
  return c.json(result);
});

export default app;
