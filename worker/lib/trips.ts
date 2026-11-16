import type { ChecklistEntry, Item, Trip, TripDayPlan, TripDayWeather, TripPlan, TripWeather } from "../../shared/types";
import { describeWeatherCode } from "../../shared/weather";
import { numOrNull, strOrNull, wardrobeForPrompt, type Row } from "./db";
import { arr, obj, S, type Schema } from "./gemini";
import { cleanUserText } from "./stylist";
import { addDays, daysBetween, isDateString, newId, parseJsonUnknown } from "./util";
import { asArray, asEnum, asNumber, asRecord, asString, asStringArray, isRecord } from "./validate";

export const MAX_TRIP_DAYS = 21;
/**
 * Open-Meteo 예보 범위. 문서(https://open-meteo.com/en/docs): forecast_days 최대 16 ("Up to 16 days of forecast are possible").
 * 실제 API도 오늘+15일을 넘는 end_date에는 400 {"error":true,"reason":"Parameter 'end_date' is out of allowed range ..."}를 돌려준다.
 * 시간대 경계에서 400이 나지 않도록 하루 여유를 두고 오늘(UTC)+14일까지만 요청한다.
 */
export const FORECAST_LAST_OFFSET_DAYS = 14;

/** start~end(포함) 날짜 목록 */
export function tripDates(start: string, end: string): string[] {
  const n = daysBetween(start, end);
  const out: string[] = [];
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** 여행 날짜 중 예보를 요청할 수 있는 구간. 없으면 null. */
export function forecastWindow(dates: string[], todayUtc: string): { start: string; end: string } | null {
  const last = addDays(todayUtc, FORECAST_LAST_OFFSET_DAYS);
  const ok = dates.filter((d) => d >= todayUtc && d <= last);
  return ok.length ? { start: ok[0], end: ok[ok.length - 1] } : null;
}

export function tripForecastUrl(lat: number, lon: number, start: string, end: string): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  return url.toString();
}

/** Open-Meteo daily 응답 → 날짜별 날씨. 숫자가 빠진 날은 버린다 (지어내지 않음). */
export function parseTripForecast(data: unknown): TripDayWeather[] {
  const d = asRecord(asRecord(data).daily);
  const time = asArray(d.time);
  const max = asArray(d.temperature_2m_max);
  const min = asArray(d.temperature_2m_min);
  const pop = asArray(d.precipitation_probability_max);
  const code = asArray(d.weather_code);
  const out: TripDayWeather[] = [];
  time.forEach((t, i) => {
    const hi = typeof max[i] === "number" ? (max[i] as number) : null;
    const lo = typeof min[i] === "number" ? (min[i] as number) : null;
    if (!isDateString(t) || hi === null || lo === null) return;
    const c = typeof code[i] === "number" ? (code[i] as number) : null;
    out.push({
      date: t,
      temp_min: lo,
      temp_max: hi,
      precip_probability: typeof pop[i] === "number" ? (pop[i] as number) : null,
      weather_code: c,
      description: describeWeatherCode(c),
    });
  });
  return out;
}

export function buildTripWeather(dates: string[], days: TripDayWeather[], locationName: string | null, failure: string | null): TripWeather {
  const wanted = new Set(dates);
  const got = days.filter((d) => wanted.has(d.date));
  if (!got.length) {
    return {
      status: "unavailable",
      message: failure ?? "여행 날짜가 일기예보 범위(오늘부터 약 2주) 밖이라 예보가 없어요. 계절과 메모를 기준으로 계획했어요.",
      location_name: locationName,
      days: [],
    };
  }
  if (got.length < dates.length) {
    return {
      status: "partial",
      message: `${dates.length}일 중 ${got.length}일만 예보가 있어요. 나머지 날은 계절과 메모를 기준으로 계획했어요.`,
      location_name: locationName,
      days: got,
    };
  }
  return { status: "forecast", message: "여행 기간의 일기예보를 반영했어요.", location_name: locationName, days: got };
}

export const TRIP_SCHEMA: Schema = obj({
  summary: S.str,
  capsule_item_ids: S.strArr,
  days: arr(obj({ day: { type: "INTEGER" }, item_ids: S.strArr, note: S.str })),
  extras: S.strArr,
  tips: S.strArr,
});

export interface TripPromptInput {
  destination: string;
  dates: string[];
  notes: string | null;
  weather: TripWeather;
  profile: string | null;
}

export function tripPrompt(items: Item[], t: TripPromptInput): string {
  const byDate = new Map(t.weather.days.map((d) => [d.date, d]));
  const dayLines = t.dates.map((date, i) => {
    const w = byDate.get(date);
    return `- ${i + 1}일차 (${date}): ${
      w
        ? `최저 ${w.temp_min}°C / 최고 ${w.temp_max}°C, ${w.description}${w.precip_probability != null ? `, 강수확률 ${w.precip_probability}%` : ""}`
        : "예보 없음"
    }`;
  });
  return `너는 여행 짐을 가볍게 싸 주는 스타일리스트야. 아래 "내 옷장"에 있는 옷만 사용해서 여행용 캡슐 워드로브를 짜 줘.

여행지: ${cleanUserText(t.destination, 100)}
일정: ${t.dates[0]} ~ ${t.dates[t.dates.length - 1]} (${t.dates.length}일)
활동/메모: ${cleanUserText(t.notes, 600) || "없음"}

날짜별 날씨:
${dayLines.join("\n")}
${
  t.weather.status === "forecast"
    ? ""
    : `\n주의: "예보 없음"인 날은 실제 예보가 없어. 기온 숫자를 지어내지 말고, 여행지의 그 시기 일반적인 계절감과 메모를 근거로 고르되 summary에 "예보가 없어 계절 기준으로 골랐다"고 밝혀.\n`
}
규칙:
- 부피를 줄이는 게 목표야. 상의·하의를 서로 돌려 입어 매일 다른 느낌이 나게 하고, 아우터와 신발은 꼭 필요한 만큼만 (신발은 보통 1~2켤레).
- capsule_item_ids: 가져갈 옷 전체의 id. days에서 쓰는 모든 id가 여기에 들어 있어야 해.
- days: 1일차부터 ${t.dates.length}일차까지 하루도 빠짐없이. day는 1부터 시작하는 번호, item_ids는 그날 입을 옷, note는 그날 날씨/활동에 맞춘 한 줄 설명.
- 모든 id는 반드시 아래 "내 옷장" 목록의 id만 사용해. 지어내지 마.
- 각 날의 코디는 최소 (상의+하의) 또는 (원피스)를 포함해.
- 많이 걷는 일정이면 편한 신발, 비 예보가 있으면 젖어도 괜찮은 신발/아우터를 골라.
- extras: 옷 말고 챙기면 좋은 준비물 (예: 충전기, 우산, 속옷 ${t.dates.length}벌, 잠옷). 짧은 한국어 명사구로 5~10개.
- tips: 이 캡슐을 돌려 입는 요령 1~3개.
- summary: 캡슐 구성의 핵심을 한국어 두세 문장으로.
${t.profile ? `- "내 프로필"의 퍼스널 컬러와 체형 조언도 가능하면 반영해.\n\n내 프로필:\n${t.profile}\n` : ""}
내 옷장:
${wardrobeForPrompt(items)}`;
}

export interface SanitizedTripPlan {
  plan: Omit<TripPlan, "weather" | "generated_at">;
  extras: string[];
}

/** Gemini 응답 정리: 없는 id 제거, 날짜 수에 맞춰 일차 채우기, 캡슐 = 캡슐 ∪ 일차별 옷 */
export function sanitizeTripPlan(raw: unknown, validIds: Set<string>, dates: string[]): SanitizedTripPlan {
  const r = asRecord(raw);
  const clean = (v: unknown) => asStringArray(v, 40, 64).filter((id) => validIds.has(id));
  const byDay = new Map<number, { item_ids: string[]; note: string }>();
  asArray(r.days).forEach((d, index) => {
    if (!isRecord(d)) return;
    const n = asNumber(d.day);
    const day = n !== null && Number.isInteger(n) && n >= 1 && n <= dates.length ? n : index + 1;
    if (day > dates.length || byDay.has(day)) return;
    byDay.set(day, { item_ids: clean(d.item_ids), note: asString(d.note, "", 300) });
  });
  const days: TripDayPlan[] = dates.map((date, i) => {
    const d = byDay.get(i + 1);
    return { day: i + 1, date, item_ids: d?.item_ids ?? [], note: d?.note ?? "" };
  });
  const capsule = new Set(clean(r.capsule_item_ids));
  for (const d of days) for (const id of d.item_ids) capsule.add(id);
  return {
    plan: { summary: asString(r.summary, "", 1000), capsule_item_ids: [...capsule], days, tips: asStringArray(r.tips, 5, 300) },
    extras: asStringArray(r.extras, 15, 60),
  };
}

/**
 * 새 계획으로 체크리스트를 다시 만든다.
 * - 캡슐 옷은 item 항목으로 (이전에 챙김 표시한 옷은 그대로 유지)
 * - 사용자가 직접 추가한 준비물(user)은 항상 유지
 * - AI 준비물(ai)은 새 제안으로 교체하되, 같은 이름이면 챙김 표시 유지
 */
export function buildChecklist(capsuleIds: string[], itemNames: Map<string, string>, extras: string[], previous: ChecklistEntry[]): ChecklistEntry[] {
  const prevItems = new Map(previous.filter((e) => e.kind === "item" && e.item_id).map((e) => [e.item_id as string, e]));
  const prevExtras = new Map(previous.filter((e) => e.kind === "extra").map((e) => [e.label, e]));
  const out: ChecklistEntry[] = capsuleIds.map((id) => {
    const prev = prevItems.get(id);
    return { id: prev?.id ?? newId(), kind: "item", item_id: id, label: itemNames.get(id) ?? "옷", packed: prev?.packed ?? false, source: "plan" };
  });
  const labels = new Set<string>();
  for (const e of previous) {
    if (e.kind === "extra" && e.source === "user" && !labels.has(e.label)) {
      labels.add(e.label);
      out.push(e);
    }
  }
  for (const label of extras) {
    if (labels.has(label)) continue;
    labels.add(label);
    const prev = prevExtras.get(label);
    out.push({ id: prev?.id ?? newId(), kind: "extra", item_id: null, label, packed: prev?.packed ?? false, source: "ai" });
  }
  return out;
}

export function coerceChecklist(v: unknown): ChecklistEntry[] {
  const out: ChecklistEntry[] = [];
  for (const x of asArray(v)) {
    if (!isRecord(x) || typeof x.id !== "string") continue;
    const kind = x.kind === "item" && typeof x.item_id === "string" ? "item" : "extra";
    out.push({
      id: x.id,
      kind,
      item_id: kind === "item" ? String(x.item_id) : null,
      label: asString(x.label, "", 100),
      packed: x.packed === true,
      source: asEnum(x.source, ["plan", "ai", "user"] as const) ?? (kind === "item" ? "plan" : "user"),
    });
    if (out.length >= 200) break;
  }
  return out;
}

function coerceDayWeather(v: unknown): TripDayWeather[] {
  const out: TripDayWeather[] = [];
  for (const x of asArray(v)) {
    if (!isRecord(x) || !isDateString(x.date) || typeof x.temp_min !== "number" || typeof x.temp_max !== "number") continue;
    out.push({
      date: x.date,
      temp_min: x.temp_min,
      temp_max: x.temp_max,
      precip_probability: numOrNull(x.precip_probability),
      weather_code: numOrNull(x.weather_code),
      description: asString(x.description),
    });
  }
  return out;
}

export function coerceTripPlan(v: unknown): TripPlan | null {
  if (!isRecord(v) || !Array.isArray(v.days)) return null;
  const w = asRecord(v.weather);
  return {
    summary: asString(v.summary),
    capsule_item_ids: asStringArray(v.capsule_item_ids, 60, 64),
    days: v.days.filter(isRecord).map((d, i) => ({
      day: asNumber(d.day) ?? i + 1,
      date: asString(d.date),
      item_ids: asStringArray(d.item_ids, 40, 64),
      note: asString(d.note),
    })),
    tips: asStringArray(v.tips, 5, 300),
    weather: {
      status: asEnum(w.status, ["forecast", "partial", "unavailable"] as const) ?? "unavailable",
      message: asString(w.message),
      location_name: strOrNull(w.location_name),
      days: coerceDayWeather(w.days),
    },
    generated_at: asString(v.generated_at),
  };
}

export function rowToTrip(r: Row): Trip {
  return {
    id: String(r.id),
    name: asString(r.name),
    destination: asString(r.destination),
    location_name: strOrNull(r.location_name),
    lat: numOrNull(r.lat),
    lon: numOrNull(r.lon),
    start_date: asString(r.start_date),
    end_date: asString(r.end_date),
    notes: strOrNull(r.notes),
    plan: coerceTripPlan(parseJsonUnknown(r.plan)),
    checklist: coerceChecklist(parseJsonUnknown(r.checklist)),
    created_at: asString(r.created_at),
    updated_at: asString(r.updated_at),
  };
}
