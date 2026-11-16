import type { Weather } from "../../shared/types";
import { forecastUrl, parseForecast, type OpenMeteoForecast } from "../../shared/weather";
import { asArray, asString, isRecord } from "./validate";

export { parseForecast, describeWeatherCode } from "../../shared/weather";

const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === "number");

/** Open-Meteo 응답이 parseForecast가 기대하는 모양인지 확인 */
export function isForecast(v: unknown): v is OpenMeteoForecast {
  if (!isRecord(v) || !isRecord(v.daily)) return false;
  const d = v.daily;
  return Array.isArray(d.time) && d.time.length > 0 && d.time.every((t) => typeof t === "string") && numbers(d.temperature_2m_max) && numbers(d.temperature_2m_min);
}

export async function fetchWeather(lat: number, lon: number, locationName: string | null): Promise<Weather> {
  const res = await fetch(forecastUrl(lat, lon), { signal: AbortSignal.timeout(10000) }).catch(() => {
    throw new Error("날씨 서버에 연결하지 못했어요");
  });
  if (!res.ok) throw new Error(`날씨를 불러오지 못했어요 (${res.status})`);
  const data: unknown = await res.json().catch(() => null);
  if (!isForecast(data)) throw new Error("날씨 데이터가 비어 있어요");
  return parseForecast(data, locationName);
}

export interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

export function parseGeocode(data: unknown): GeoResult[] {
  const out: GeoResult[] = [];
  for (const r of asArray(isRecord(data) ? data.results : null)) {
    if (!isRecord(r) || typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
    const name = asString(r.name, "", 100);
    if (!name) continue;
    const g: GeoResult = { name, latitude: r.latitude, longitude: r.longitude };
    if (typeof r.admin1 === "string") g.admin1 = r.admin1;
    if (typeof r.country === "string") g.country = r.country;
    out.push(g);
  }
  return out;
}

export async function geocode(q: string): Promise<GeoResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "ko");
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => {
    throw new Error("위치 검색 서버에 연결하지 못했어요");
  });
  if (!res.ok) throw new Error(`위치 검색 실패 (${res.status})`);
  return parseGeocode(await res.json().catch(() => null));
}

export function geoLabel(g: GeoResult): string {
  return [g.name, g.admin1 && g.admin1 !== g.name ? g.admin1 : "", g.country ?? ""].filter(Boolean).join(", ");
}
