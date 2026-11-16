import type { Env } from "../env";
import type { OutfitLog } from "../../shared/types";
import { rowToLog, type Row } from "./db";
import { deleteUnreferencedImages } from "./images";
import { HttpError, newId } from "./util";
import { sameItemSet, type LogRef } from "./wear";

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

/** item_ids JSON이 깨진 행은 빈 배열로 본다 */
const LOG_ITEMS = "json_each(CASE WHEN json_valid(l.item_ids) THEN l.item_ids ELSE '[]' END)";

/** 옷장에 실제로 있는 id만 */
async function existingItemIds(db: D1Database, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const { results } = await db
    .prepare(`SELECT id FROM items WHERE id IN (${placeholders(itemIds.length)})`)
    .bind(...itemIds)
    .all<{ id: string }>();
  return new Set(results.map((r) => String(r.id)));
}

/**
 * 기록 하나가 before → after로 바뀐 "뒤에" 실행할 착용 횟수/마지막 착용일 갱신 문장 (규칙: worker/lib/wear.ts).
 *
 * 예전에는 Worker가 옷의 wear_count와 다른 기록을 먼저 읽고 새 값을 계산해서 절대값으로 덮어썼다.
 * 그러면 서로 다른 기록 두 개를 동시에 저장할 때(더블 탭, 단축어 + 앱) 둘 다 같은 옛 값을 읽어서 +1이 한 번만 남는
 * lost update가 생겼다. 이제는 판단과 갱신을 모두 SQL 안에서 하고, 기록 변경과 같은 batch(트랜잭션)로 실행한다.
 * D1은 batch를 직렬로 실행하므로 동시에 와도 순서대로 정확히 반영된다.
 * - 빠진 (옷, 날짜): 그 날짜에 그 옷이 든 기록이 더 이상 없을 때만 -1 (0 아래로 안 내려감)
 * - 들어온 (옷, 날짜): 이 기록 말고는 그 날짜에 그 옷이 든 기록이 없을 때만 +1
 * - last_worn_date = max(base_last_worn_date, 그 옷이 든 모든 기록의 날짜)
 */
function wearStatements(db: D1Database, logId: string, before: LogRef | null, after: LogRef | null): D1PreparedStatement[] {
  const beforeIds = new Set(before?.item_ids ?? []);
  const afterIds = new Set(after?.item_ids ?? []);
  const stmts: D1PreparedStatement[] = [];
  for (const id of new Set([...beforeIds, ...afterIds])) {
    const had = beforeIds.has(id);
    const has = afterIds.has(id);
    const sameDay = had && has && before!.worn_date === after!.worn_date;
    if (had && !sameDay) {
      stmts.push(
        db
          .prepare(
            `UPDATE items SET wear_count = MAX(0, wear_count - 1) WHERE id = ?1 AND NOT EXISTS (
               SELECT 1 FROM outfit_logs l, ${LOG_ITEMS} j WHERE l.worn_date = ?2 AND j.value = ?1)`,
          )
          .bind(id, before!.worn_date),
      );
    }
    if (has && !sameDay) {
      stmts.push(
        db
          .prepare(
            `UPDATE items SET wear_count = wear_count + 1 WHERE id = ?1 AND NOT EXISTS (
               SELECT 1 FROM outfit_logs l, ${LOG_ITEMS} j WHERE l.worn_date = ?2 AND j.value = ?1 AND l.id != ?3)`,
          )
          .bind(id, after!.worn_date, logId),
      );
    }
    if (!sameDay) {
      stmts.push(
        db
          .prepare(
            // compound SELECT(UNION)은 D1 항 수 제한에 걸릴 수 있어 쓰지 않는다 → 스칼라 max() 두 값 비교 ('' = 없음)
            `UPDATE items SET last_worn_date = NULLIF(MAX(
               COALESCE(base_last_worn_date, ''),
               COALESCE((SELECT MAX(l.worn_date) FROM outfit_logs l, ${LOG_ITEMS} j WHERE j.value = ?1), '')
             ), '') WHERE id = ?1`,
          )
          .bind(id),
      );
    }
  }
  return stmts;
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

  const [sameDay, known] = await Promise.all([db.prepare("SELECT * FROM outfit_logs WHERE worn_date = ?").bind(input.worn_date).all<Row>(), existingItemIds(db, ids)]);
  if (known.size !== ids.length) throw new HttpError(400, "옷장에 없는 옷이 들어 있어요. 화면을 새로 고친 뒤 다시 시도해 주세요.");

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
    ...wearStatements(db, id, null, { worn_date: input.worn_date, item_ids: ids }),
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

  const added = afterIds.filter((x) => !before.item_ids.includes(x));
  if (added.length) {
    const known = await existingItemIds(db, added);
    if (added.some((x) => !known.has(x))) throw new HttpError(400, "옷장에 없는 옷이 들어 있어요. 화면을 새로 고친 뒤 다시 시도해 주세요.");
  }
  const wearChanged = afterDate !== before.worn_date || !sameItemSet(afterIds, before.item_ids);
  const stmts: D1PreparedStatement[] = wearChanged
    ? wearStatements(db, id, before, { worn_date: afterDate, item_ids: afterIds })
    : [];

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
  await db.batch([db.prepare("DELETE FROM outfit_logs WHERE id = ?").bind(id), ...wearStatements(db, id, before, null)]);
  await deleteUnreferencedImages(env, [before.selfie_key]);
}
