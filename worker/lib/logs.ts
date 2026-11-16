import type { Env } from "../env";
import type { OutfitLog } from "../../shared/types";
import { jsonStrings, numOrNull, rowToLog, strOrNull, type Row } from "./db";
import { deleteUnreferencedImages } from "./images";
import { HttpError, newId } from "./util";
import { computeWearChanges, sameItemSet, type ItemWear, type LogRef, type WearChange } from "./wear";

export interface LogInput {
  worn_date: string;
  item_ids: string[];
  outfit_id?: string | null;
  weather_summary?: string | null;
  selfie_key?: string | null;
  rating?: number | null;
  occasion_tags?: string[];
  note?: string | null;
}

export type LogPatch = Partial<LogInput>;

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** 주어진 옷이 들어 있는 다른 기록들 (excludeId 제외). item_ids JSON이 깨진 행은 무시한다. */
async function logsWithItems(db: D1Database, itemIds: string[], excludeId: string | null): Promise<LogRef[]> {
  if (!itemIds.length) return [];
  const { results } = await db
    .prepare(
      `SELECT l.worn_date, l.item_ids FROM outfit_logs l
       WHERE l.id != ? AND EXISTS (
         SELECT 1 FROM json_each(CASE WHEN json_valid(l.item_ids) THEN l.item_ids ELSE '[]' END) j WHERE j.value IN (${placeholders(itemIds.length)})
       )`,
    )
    .bind(excludeId ?? "", ...itemIds)
    .all<Row>();
  return results.map((r) => ({ worn_date: String(r.worn_date), item_ids: jsonStrings(r.item_ids) }));
}

async function itemWear(db: D1Database, itemIds: string[]): Promise<ItemWear[]> {
  if (!itemIds.length) return [];
  const { results } = await db
    .prepare(`SELECT id, wear_count, last_worn_date, base_last_worn_date FROM items WHERE id IN (${placeholders(itemIds.length)})`)
    .bind(...itemIds)
    .all<Row>();
  return results.map((r) => ({
    id: String(r.id),
    wear_count: numOrNull(r.wear_count) ?? 0,
    last_worn_date: strOrNull(r.last_worn_date),
    base_last_worn_date: strOrNull(r.base_last_worn_date),
  }));
}

function wearStatements(db: D1Database, changes: WearChange[]): D1PreparedStatement[] {
  return changes.map((ch) => db.prepare("UPDATE items SET wear_count = ?, last_worn_date = ? WHERE id = ?").bind(ch.wear_count, ch.last_worn_date, ch.id));
}

async function getLogRow(db: D1Database, id: string): Promise<OutfitLog> {
  const row = await db.prepare("SELECT * FROM outfit_logs WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "착용 기록을 찾을 수 없어요");
  return rowToLog(row);
}

export const getLog = getLogRow;

/**
 * 착용 기록 추가. 규칙은 worker/lib/wear.ts 참고.
 * 같은 날짜에 똑같은 옷 조합의 기록이 이미 있으면 새로 만들지 않고 그 기록에 (셀카/평점/태그/메모/날씨) 를 채워 넣는다 → duplicate: true.
 */
export async function createLog(env: Env, input: LogInput): Promise<{ log: OutfitLog; duplicate: boolean }> {
  const db = env.DB;
  const ids = [...new Set(input.item_ids)];
  if (!ids.length) throw new HttpError(400, "입은 옷을 골라 주세요");

  const [sameDay, items, others] = await Promise.all([
    db.prepare("SELECT * FROM outfit_logs WHERE worn_date = ?").bind(input.worn_date).all<Row>(),
    itemWear(db, ids),
    logsWithItems(db, ids, null),
  ]);
  if (items.length !== ids.length) throw new HttpError(400, "옷장에 없는 옷이 들어 있어요. 화면을 새로 고친 뒤 다시 시도해 주세요.");

  const existing = sameDay.results.map(rowToLog).find((l) => sameItemSet(l.item_ids, ids));
  if (existing) {
    const tags = input.occasion_tags?.length ? JSON.stringify(input.occasion_tags) : null;
    await db
      .prepare(
        `UPDATE outfit_logs SET outfit_id = COALESCE(?, outfit_id), weather_summary = COALESCE(?, weather_summary), selfie_key = COALESCE(?, selfie_key),
         rating = COALESCE(?, rating), occasion_tags = COALESCE(?, occasion_tags), note = COALESCE(?, note) WHERE id = ?`,
      )
      .bind(input.outfit_id ?? null, input.weather_summary ?? null, input.selfie_key ?? null, input.rating ?? null, tags, input.note ?? null, existing.id)
      .run();
    if (input.selfie_key && existing.selfie_key && existing.selfie_key !== input.selfie_key) await deleteUnreferencedImages(env, [existing.selfie_key]);
    return { log: await getLogRow(db, existing.id), duplicate: true };
  }

  const id = newId();
  const changes = computeWearChanges(null, { worn_date: input.worn_date, item_ids: ids }, others, items);
  await db.batch([
    db
      .prepare(
        "INSERT INTO outfit_logs (id, worn_date, outfit_id, item_ids, weather_summary, selfie_key, rating, occasion_tags, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        input.worn_date,
        input.outfit_id ?? null,
        JSON.stringify(ids),
        input.weather_summary ?? null,
        input.selfie_key ?? null,
        input.rating ?? null,
        JSON.stringify(input.occasion_tags ?? []),
        input.note ?? null,
      ),
    ...wearStatements(db, changes),
  ]);
  return { log: await getLogRow(db, id), duplicate: false };
}

/** 기록 수정. 옷이나 날짜가 바뀌면 착용 횟수/마지막 착용일을 규칙대로 조정한다. */
export async function updateLog(env: Env, id: string, patch: LogPatch): Promise<OutfitLog> {
  const db = env.DB;
  const before = await getLogRow(db, id);
  const afterIds = patch.item_ids ? [...new Set(patch.item_ids)] : before.item_ids;
  if (!afterIds.length) throw new HttpError(400, "입은 옷을 골라 주세요");
  const afterDate = patch.worn_date ?? before.worn_date;

  const stmts: D1PreparedStatement[] = [];
  const wearChanged = afterDate !== before.worn_date || !sameItemSet(afterIds, before.item_ids);
  if (wearChanged) {
    const union = [...new Set([...before.item_ids, ...afterIds])];
    const [items, others] = await Promise.all([itemWear(db, union), logsWithItems(db, union, id)]);
    const known = new Set(items.map((i) => i.id));
    const added = afterIds.filter((x) => !before.item_ids.includes(x));
    if (added.some((x) => !known.has(x))) throw new HttpError(400, "옷장에 없는 옷이 들어 있어요. 화면을 새로 고친 뒤 다시 시도해 주세요.");
    stmts.push(...wearStatements(db, computeWearChanges(before, { worn_date: afterDate, item_ids: afterIds }, others, items)));
  }

  const next = {
    outfit_id: patch.outfit_id !== undefined ? patch.outfit_id : before.outfit_id,
    weather_summary: patch.weather_summary !== undefined ? patch.weather_summary : before.weather_summary,
    selfie_key: patch.selfie_key !== undefined ? patch.selfie_key : before.selfie_key,
    rating: patch.rating !== undefined ? patch.rating : before.rating,
    occasion_tags: patch.occasion_tags ?? before.occasion_tags,
    note: patch.note !== undefined ? patch.note : before.note,
  };
  stmts.unshift(
    db
      .prepare("UPDATE outfit_logs SET worn_date = ?, item_ids = ?, outfit_id = ?, weather_summary = ?, selfie_key = ?, rating = ?, occasion_tags = ?, note = ? WHERE id = ?")
      .bind(afterDate, JSON.stringify(afterIds), next.outfit_id, next.weather_summary, next.selfie_key, next.rating, JSON.stringify(next.occasion_tags), next.note, id),
  );
  await db.batch(stmts);
  if (before.selfie_key && before.selfie_key !== next.selfie_key) await deleteUnreferencedImages(env, [before.selfie_key]);
  return getLogRow(db, id);
}

/** 기록 삭제. 착용 횟수/마지막 착용일을 되돌리고, 셀카가 다른 곳에서 안 쓰이면 R2에서도 지운다. */
export async function deleteLog(env: Env, id: string): Promise<void> {
  const db = env.DB;
  const before = await getLogRow(db, id);
  const [items, others] = await Promise.all([itemWear(db, before.item_ids), logsWithItems(db, before.item_ids, id)]);
  await db.batch([db.prepare("DELETE FROM outfit_logs WHERE id = ?").bind(id), ...wearStatements(db, computeWearChanges(before, null, others, items))]);
  await deleteUnreferencedImages(env, [before.selfie_key]);
}
