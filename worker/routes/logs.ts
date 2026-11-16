import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rowToLog, type Row } from "../lib/db";
import { createLog, deleteLog, getLog, updateLog, type LogInput, type LogPatch } from "../lib/logs";
import { addDays, HttpError, isDateString, todayKST } from "../lib/util";
import { optDate, optIdArray, optImageKey, optInt, optStr, optStrArray, paramId, readJson, type Body } from "../lib/validate";

const app = new Hono<AppEnv>();

/** 요청 본문에서 기록 필드를 읽는다 (없는 필드는 undefined로 남김) */
export function readLogFields(b: Body): LogPatch {
  const patch: LogPatch = {};
  const date = optDate(b, "date", "날짜");
  if (date !== undefined) {
    if (date === null) throw new HttpError(400, "날짜: 값이 필요해요");
    if (date > addDays(todayKST(), 1)) throw new HttpError(400, "날짜: 미래 날짜에는 기록할 수 없어요");
    patch.worn_date = date;
  }
  const ids = optIdArray(b, "item_ids", 30, "옷 목록");
  if (ids !== undefined) patch.item_ids = ids;
  const outfit = optStr(b, "outfit_id", 64);
  if (outfit !== undefined) patch.outfit_id = outfit;
  const weather = optStr(b, "weather_summary", 200, "날씨");
  if (weather !== undefined) patch.weather_summary = weather;
  const selfie = optImageKey(b, "selfie_key", "셀카");
  if (selfie !== undefined) patch.selfie_key = selfie;
  const rating = optInt(b, "rating", { min: 1, max: 5 }, "평점");
  if (rating !== undefined) patch.rating = rating;
  const tags = optStrArray(b, "occasion_tags", { maxItems: 10, maxLen: 30 }, "상황 태그");
  if (tags !== undefined) patch.occasion_tags = tags;
  const note = optStr(b, "note", 500, "메모");
  if (note !== undefined) patch.note = note;
  return patch;
}

export function toLogInput(patch: LogPatch): LogInput {
  if (!patch.item_ids?.length) throw new HttpError(400, "입은 옷을 골라 주세요");
  return { ...patch, item_ids: patch.item_ids, worn_date: patch.worn_date ?? todayKST() };
}

/**
 * 기록 목록.
 * - ?month=YYYY-MM : 그 달 (달력용)
 * - ?from=YYYY-MM-DD&to=YYYY-MM-DD : 기간 (최대 370일)
 * - 둘 다 없으면 최근 60개
 */
app.get("/", async (c) => {
  const month = c.req.query("month");
  let from = c.req.query("from");
  let to = c.req.query("to");
  if (month !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "month는 YYYY-MM 형식이어야 해요");
    from = `${month}-01`;
    to = `${month}-31`;
  } else if (from !== undefined || to !== undefined) {
    if (!isDateString(from) || !isDateString(to) || from > to) throw new HttpError(400, "from, to는 YYYY-MM-DD 형식이고 from이 to보다 앞서야 해요");
    if (to > addDays(from, 370)) throw new HttpError(400, "한 번에 조회할 수 있는 기간은 최대 370일이에요");
  }
  const stmt =
    from && to
      ? c.env.DB.prepare("SELECT * FROM outfit_logs WHERE worn_date BETWEEN ? AND ? ORDER BY worn_date DESC, created_at DESC").bind(from, to)
      : c.env.DB.prepare("SELECT * FROM outfit_logs ORDER BY worn_date DESC, created_at DESC LIMIT 60");
  const { results } = await stmt.all<Row>();
  return c.json(results.map(rowToLog));
});

app.get("/:id", async (c) => c.json(await getLog(c.env.DB, paramId(c))));

/** 착용 기록 추가 (OOTD 셀카 확인 화면의 "기록하기"도 이 엔드포인트) */
app.post("/", async (c) => {
  const { log, duplicate } = await createLog(c.env, toLogInput(readLogFields(await readJson(c))));
  return c.json({ ...log, duplicate }, duplicate ? 200 : 201);
});

app.patch("/:id", async (c) => c.json(await updateLog(c.env, paramId(c), readLogFields(await readJson(c)))));

app.delete("/:id", async (c) => {
  await deleteLog(c.env, paramId(c));
  return c.json({ ok: true });
});

export default app;
