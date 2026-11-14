import type { Weather } from "../../shared/types";
import { forecastUrl, parseForecast } from "../../shared/weather";
import { api } from "./api";

/** 브라우저에서 Open-Meteo를 직접 호출 (실패하면 서버 경유) */
export async function loadWeather(lat: number, lon: number, name: string | null): Promise<Weather> {
  try {
    const res = await fetch(forecastUrl(lat, lon));
    if (!res.ok) throw new Error(String(res.status));
    return parseForecast(await res.json(), name);
  } catch {
    return api<Weather>(`/stylist/weather?lat=${lat}&lon=${lon}${name ? `&name=${encodeURIComponent(name)}` : ""}`);
  }
}

export interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

export async function searchPlace(q: string): Promise<GeoResult[]> {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", q);
    url.searchParams.set("count", "8");
    url.searchParams.set("language", "ko");
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    return ((await res.json()) as { results?: GeoResult[] }).results ?? [];
  } catch {
    return api<GeoResult[]>(`/stylist/geocode?q=${encodeURIComponent(q)}`);
  }
}
