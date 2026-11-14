import type { Weather } from "../../shared/types";
import { forecastUrl, parseForecast, type OpenMeteoForecast } from "../../shared/weather";

export { parseForecast, describeWeatherCode } from "../../shared/weather";

export async function fetchWeather(lat: number, lon: number, locationName: string | null): Promise<Weather> {
  const url = forecastUrl(lat, lon);
  const res = await fetch(url, { cf: { cacheTtl: 900 } } as RequestInit);
  if (!res.ok) throw new Error(`날씨를 불러오지 못했어요 (${res.status})`);
  return parseForecast((await res.json()) as OpenMeteoForecast, locationName);
}

export interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

export async function geocode(q: string): Promise<GeoResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "ko");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`위치 검색 실패 (${res.status})`);
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results ?? [];
}
