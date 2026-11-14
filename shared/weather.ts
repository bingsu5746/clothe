import type { Weather } from "./types";

// WMO weather interpretation codes (Open-Meteo 문서 기준)
const WMO: Record<number, string> = {
  0: "맑음",
  1: "대체로 맑음",
  2: "구름 조금",
  3: "흐림",
  45: "안개",
  48: "안개",
  51: "약한 이슬비",
  53: "이슬비",
  55: "강한 이슬비",
  56: "어는 이슬비",
  57: "어는 이슬비",
  61: "약한 비",
  63: "비",
  65: "강한 비",
  66: "어는 비",
  67: "어는 비",
  71: "약한 눈",
  73: "눈",
  75: "많은 눈",
  77: "싸락눈",
  80: "소나기",
  81: "소나기",
  82: "강한 소나기",
  85: "눈 소나기",
  86: "강한 눈 소나기",
  95: "뇌우",
  96: "우박 동반 뇌우",
  99: "우박 동반 뇌우",
};

export function describeWeatherCode(code: number | null | undefined): string {
  if (code == null) return "알 수 없음";
  return WMO[code] ?? "알 수 없음";
}

export interface OpenMeteoForecast {
  current?: { temperature_2m?: number };
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

export function parseForecast(data: OpenMeteoForecast, locationName: string | null): Weather {
  const d = data.daily;
  if (!d || !d.time?.length) throw new Error("날씨 데이터가 비어 있어요");
  const temp_max = d.temperature_2m_max[0];
  const temp_min = d.temperature_2m_min[0];
  const code = d.weather_code?.[0] ?? null;
  return {
    date: d.time[0],
    location_name: locationName,
    temp_min,
    temp_max,
    temp_now: data.current?.temperature_2m ?? null,
    diurnal_range: Math.round((temp_max - temp_min) * 10) / 10,
    precip_probability: d.precipitation_probability_max?.[0] ?? null,
    weather_code: code,
    description: describeWeatherCode(code),
  };
}

export function forecastUrl(lat: number, lon: number): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
  url.searchParams.set("current", "temperature_2m");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  return url.toString();
}

/** 클라이언트가 보낸 날씨 값 검증 */
export function isWeather(v: unknown): v is Weather {
  const w = v as Weather;
  return !!w && typeof w === "object" && Number.isFinite(w.temp_min) && Number.isFinite(w.temp_max) && typeof w.description === "string";
}
