import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { ChecklistEntry, Trip, TripDayWeather, TripPlan } from "../../shared/types";
import { getAllItems, wardrobeSignature, type Row } from "../lib/db";
import { geminiJson } from "../lib/gemini";
import { getProfile, profileForPrompt } from "../lib/profile";
import {
  buildChecklist, buildTripWeather, forecastWindow, MAX_TRIP_DAYS, parseTripForecast, rowToTrip, sanitizeTripPlan, TRIP_SCHEMA, tripDates, tripForecastUrl, tripPrompt,
} from "../lib/trips";
import { daysBetween, HttpError, newId, sha256Hex } from "../lib/util";
import { optBool, optDate, optNum, optStr, paramId, readJson, type Body } from "../lib/validate";
import { geocode, geoLabel } from "../lib/weather";

const app = new Hono<AppEnv>();

async function getTrip(db: D1Database, id: string): Promise<Trip> {
  const row = await db.prepare("SELECT * FROM trips WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "여행을 찾을 수 없어요");
  return rowToTrip(row);
}

interface TripFields {
  name?: string | null;
  destination?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  lat?: number | null;
  lon?: number | null;
  location_name?: string | null;
}

function readTripFields(b: Body): TripFields {
  const f: TripFields = {};
  const put = <K extends keyof TripFields>(k: K, v: TripFields[K] | undefined) => {
    if (v !== undefined) f[k] = v;
  };
  put("name", optStr(b, "name", 80, "여행 이름"));
  put("destination", optStr(b, "destination", 100, "여행지"));
  put("start_date", optDate(b, "start_date", "출발일"));
  put("end_date", optDate(b, "end_date", "도착일"));
  put("notes", optStr(b, "notes", 1000, "메모"));
  put("lat", optNum(b, "lat", { min: -90, max: 90 }, "위도"));
  put("lon", optNum(b, "lon", { min: -180, max: 180 }, "경도"));
  put("location_name", optStr(b, "location_name", 100, "위치 이름"));
  return f;
}

function checkDates(start: string, end: string): void {
  if (end < start) throw new HttpError(400, "도착일이 출발일보다 빨라요");
  if (daysBetween(start, end) + 1 > MAX_TRIP_DAYS) throw new HttpError(400, `여행은 최대 ${MAX_TRIP_DAYS}일까지 계획할 수 있어요`);
}

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM trips ORDER BY start_date DESC, created_at DESC").all<Row>();
  return c.json(results.map(rowToTrip));
});

app.get("/:id", async (c) => c.json(await getTrip(c.env.DB, paramId(c))));

app.post("/", async (c) => {
  const f = readTripFields(await readJson(c));
  if (!f.destination) throw new HttpError(400, "여행지를 입력해 주세요");
  if (!f.start_date || !f.end_date) throw new HttpError(400, "출발일과 도착일을 입력해 주세요");
  checkDates(f.start_date, f.end_date);
  if ((f.lat == null) !== (f.lon == null)) throw new HttpError(400, "위도와 경도는 함께 보내 주세요");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO trips (id, name, destination, location_name, lat, lon, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, f.name ?? `${f.destination} 여행`, f.destination, f.location_name ?? null, f.lat ?? null, f.lon ?? null, f.start_date, f.end_date, f.notes ?? null)
    .run();
  return c.json(await getTrip(c.env.DB, id), 201);
});

app.patch("/:id", async (c) => {
  const id = paramId(c);
  const f = readTripFields(await readJson(c));
  const before = await getTrip(c.env.DB, id);
  if (f.destination === null) throw new HttpError(400, "여행지를 입력해 주세요");
  if (f.start_date === null || f.end_date === null) throw new HttpError(400, "출발일과 도착일을 입력해 주세요");
  checkDates(f.start_date ?? before.start_date, f.end_date ?? before.end_date);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null | undefined) => {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (f.name !== undefined) set("name", f.name ?? `${f.destination ?? before.destination} 여행`);
  set("destination", f.destination);
  set("start_date", f.start_date);
  set("end_date", f.end_date);
  set("notes", f.notes);
  set("lat", f.lat);
  set("lon", f.lon);
  set("location_name", f.location_name);
  // 여행지를 바꿨는데 좌표를 같이 보내지 않았으면 예전 좌표를 지운다 (다음 계획 때 다시 찾음)
  if (f.destination !== undefined && f.destination !== before.destination && f.lat === undefined && f.lon === undefined) {
    set("lat", null);
    set("lon", null);
    if (f.location_name === undefined) set("location_name", null);
  }
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE trips SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...vals, id)
      .run();
  }
  return c.json(await getTrip(c.env.DB, id));
});

app.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM trips WHERE id = ?").bind(paramId(c)).run();
  return c.json({ ok: true });
});

interface Located {
  lat: number | null;
  lon: number | null;
  location_name: string | null;
  failure: string | null;
}

async function locate(trip: Trip): Promise<Located> {
  if (trip.lat !== null && trip.lon !== null) return { lat: trip.lat, lon: trip.lon, location_name: trip.location_name ?? trip.destination, failure: null };
  try {
    const [first] = await geocode(trip.destination);
    if (first) return { lat: first.latitude, lon: first.longitude, location_name: geoLabel(first), failure: null };
    return { lat: null, lon: null, location_name: null, failure: `"${trip.destination}"의 위치를 찾지 못해서 일기예보 없이 계절과 메모를 기준으로 계획했어요. 여행지를 도시 이름으로 적으면 예보를 반영할 수 있어요.` };
  } catch {
    return { lat: null, lon: null, location_name: null, failure: "위치 검색 서버에 연결하지 못해서 일기예보 없이 계절과 메모를 기준으로 계획했어요." };
  }
}

/** 여행 날짜의 예보를 가져온다. 범위 밖이거나 실패하면 빈 배열 + 이유 (숫자를 지어내지 않는다). */
async function tripForecast(loc: Located, dates: string[]): Promise<{ days: TripDayWeather[]; failure: string | null }> {
  if (loc.lat === null || loc.lon === null) return { days: [], failure: loc.failure };
  const window = forecastWindow(dates, new Date().toISOString().slice(0, 10));
  if (!window) return { days: [], failure: null };
  try {
    const res = await fetch(tripForecastUrl(loc.lat, loc.lon, window.start, window.end), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { days: [], failure: `일기예보를 가져오지 못해서(${res.status}) 계절과 메모를 기준으로 계획했어요.` };
    return { days: parseTripForecast(await res.json().catch(() => null)), failure: null };
  } catch {
    return { days: [], failure: "날씨 서버에 연결하지 못해서 계절과 메모를 기준으로 계획했어요." };
  }
}

async function planKey(trip: Trip, sig: string, profileVersion: number): Promise<string> {
  return sha256Hex(`trip:v1|${trip.destination}|${trip.start_date}|${trip.end_date}|${trip.notes ?? ""}|${sig}|${profileVersion}`);
}

/**
 * 캡슐 워드로브 + 일차별 코디 + 체크리스트 생성.
 * 여행 정보/옷장/프로필이 그대로면 저장된 계획을 돌려준다 (force=true면 다시 생성 — 예보를 새로 반영하고 싶을 때).
 */
app.post("/:id/plan", async (c) => {
  const id = paramId(c);
  const b = await readJson(c, { allowEmpty: true });
  const force = (optBool(b, "force") ?? false) || c.req.query("force") === "true";
  const row = await c.env.DB.prepare("SELECT * FROM trips WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "여행을 찾을 수 없어요");
  const trip = rowToTrip(row);
  const [items, profile, sig] = await Promise.all([getAllItems(c.env.DB), getProfile(c.env.DB), wardrobeSignature(c.env.DB)]);
  const key = await planKey(trip, sig, profile.version);
  if (trip.plan && row.plan_key === key && !force) return c.json({ ...trip, cached: true });
  if (items.length < 2) throw new HttpError(400, "짐을 싸려면 옷장에 옷을 2벌 이상 등록해 주세요");

  const dates = tripDates(trip.start_date, trip.end_date);
  if (!dates.length || dates.length > MAX_TRIP_DAYS) throw new HttpError(400, `여행은 최대 ${MAX_TRIP_DAYS}일까지 계획할 수 있어요`);
  const loc = await locate(trip);
  const forecast = await tripForecast(loc, dates);
  const weather = buildTripWeather(dates, forecast.days, loc.location_name, forecast.failure);

  const raw = await geminiJson(c.env, tripPrompt(items, { destination: trip.destination, dates, notes: trip.notes, weather, profile: profileForPrompt(profile) }), TRIP_SCHEMA, [], 0.5);
  const { plan: core, extras } = sanitizeTripPlan(raw, new Set(items.map((i) => i.id)), dates);
  if (!core.capsule_item_ids.length) throw new HttpError(502, "짐 싸기 계획이 비어 있어요. 다시 시도해 주세요.");
  const plan: TripPlan = { ...core, weather, generated_at: new Date().toISOString() };
  const names = new Map(items.map((i) => [i.id, i.name]));
  // AI 를 기다리는 동안(10초 넘게 걸리기도 함) 체크리스트에서 챙김 표시를 바꿨을 수 있으므로, 쓰기 직전의 체크리스트를 기준으로 합친다
  const saved = await updateChecklist(c.env.DB, id, (current) => buildChecklist(plan.capsule_item_ids, names, extras, current), {
    sql: "plan = ?, plan_key = ?, lat = ?, lon = ?, location_name = ?",
    values: [JSON.stringify(plan), key, loc.lat, loc.lon, loc.location_name ?? trip.location_name],
  });
  return c.json({ ...saved, cached: false });
});

/**
 * 체크리스트 읽고-고치고-쓰기를 원자적으로 (비교 후 교체, 실패하면 다시 읽어서 재시도).
 * 짐을 쌀 때 여러 항목을 빠르게 연달아 체크하면 요청이 동시에 처리되는데, 예전에는 각 요청이 같은 옛 목록을 읽고
 * 통째로 덮어써서 먼저 누른 체크가 사라졌다(마지막 요청의 체크만 남음).
 */
export async function updateChecklist(
  db: D1Database,
  id: string,
  mutate: (current: ChecklistEntry[], trip: Trip) => ChecklistEntry[],
  extra?: { sql: string; values: (string | number | null)[] },
): Promise<Trip> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.prepare("SELECT * FROM trips WHERE id = ?").bind(id).first<Row>();
    if (!row) throw new HttpError(404, "여행을 찾을 수 없어요");
    const trip = rowToTrip(row);
    const next = mutate(structuredClone(trip.checklist), trip);
    const res = await db
      .prepare(`UPDATE trips SET checklist = ?, ${extra ? `${extra.sql}, ` : ""}updated_at = datetime('now') WHERE id = ? AND checklist IS ?`)
      .bind(JSON.stringify(next), ...(extra?.values ?? []), id, row.checklist ?? null)
      .run();
    if ((res.meta?.changes ?? 0) > 0) return getTrip(db, id);
  }
  throw new HttpError(409, "체크리스트가 동시에 바뀌고 있어요. 잠시 후 다시 시도해 주세요.");
}

/** 준비물 직접 추가 (예: 충전기) */
app.post("/:id/checklist", async (c) => {
  const id = paramId(c);
  const b = await readJson(c);
  const label = optStr(b, "label", 60, "준비물");
  if (!label) throw new HttpError(400, "준비물 이름을 입력해 주세요");
  const entry: ChecklistEntry = { id: newId(), kind: "extra", item_id: null, label, packed: false, source: "user" };
  const saved = await updateChecklist(c.env.DB, id, (list) => {
    if (list.length >= 150) throw new HttpError(400, "체크리스트 항목이 너무 많아요");
    if (list.some((e) => e.kind === "extra" && e.label === label)) throw new HttpError(409, "이미 있는 준비물이에요");
    return [...list, entry];
  });
  return c.json(saved, 201);
});

/** 체크리스트 항목 고치기: 챙김 표시(packed) / 준비물 이름(label, extra만) */
app.patch("/:id/checklist/:entryId", async (c) => {
  const id = paramId(c);
  const entryId = paramId(c, "entryId");
  const b = await readJson(c);
  const packed = optBool(b, "packed");
  const label = optStr(b, "label", 60, "준비물");
  return c.json(
    await updateChecklist(c.env.DB, id, (list) => {
      const entry = list.find((e) => e.id === entryId);
      if (!entry) throw new HttpError(404, "체크리스트 항목을 찾을 수 없어요");
      if (packed !== undefined) entry.packed = packed;
      if (label != null) {
        if (entry.kind !== "extra") throw new HttpError(400, "옷 항목의 이름은 바꿀 수 없어요");
        entry.label = label;
        entry.source = "user";
      }
      return list;
    }),
  );
});

/** 전체 챙김 표시 한 번에 바꾸기 { packed: boolean } */
app.put("/:id/checklist", async (c) => {
  const id = paramId(c);
  const packed = optBool(await readJson(c), "packed");
  if (packed === undefined) throw new HttpError(400, "packed: 값이 필요해요");
  return c.json(await updateChecklist(c.env.DB, id, (list) => list.map((e) => ({ ...e, packed }))));
});

/** 준비물 지우기 (캡슐 옷 항목은 계획을 다시 만들 때만 바뀜) */
app.delete("/:id/checklist/:entryId", async (c) => {
  const id = paramId(c);
  const entryId = paramId(c, "entryId");
  return c.json(
    await updateChecklist(c.env.DB, id, (list) => {
      if (!list.some((e) => e.id === entryId)) throw new HttpError(404, "체크리스트 항목을 찾을 수 없어요");
      return list.filter((e) => e.id !== entryId);
    }),
  );
});

export default app;
