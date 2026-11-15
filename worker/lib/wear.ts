/**
 * 착용 횟수 규칙 (docs/api-contract.md "착용 기록 규칙"과 같은 내용)
 *
 * 1. 옷 하나는 하루에 한 번만 센다. 같은 날짜의 기록 여러 개에 같은 옷이 들어 있어도 wear_count는 1만 오른다.
 * 2. 기록을 지우거나 고치면, 그 옷을 그 날짜에 입었다는 다른 기록이 남아 있지 않을 때만 wear_count를 1 줄인다 (0 아래로는 안 내려감).
 * 3. last_worn_date는 기록을 추가하면 더 늦은 날짜로 올라가고, 지운 기록의 날짜가 마지막 착용일이었다면
 *    남은 기록 중 가장 늦은 날짜(없으면 null)로 되돌린다. 그 밖의 경우(직접 입력한 날짜 등)는 건드리지 않는다.
 * 4. wear_count는 직접 고친 값(옷 수정 화면)을 존중하기 위해 기록에서 다시 세지 않고, 위 규칙대로 더하고 빼기만 한다.
 */

export interface LogRef {
  worn_date: string;
  item_ids: string[];
}

export interface ItemWear {
  id: string;
  wear_count: number;
  last_worn_date: string | null;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * 기록 하나가 before → after로 바뀔 때 (추가면 before=null, 삭제면 after=null) 각 옷의 새 wear_count / last_worn_date를 계산한다.
 * @param others 이 기록을 뺀 나머지 기록들 (관련된 옷이 들어 있는 것만 넘겨도 됨)
 * @returns 값이 실제로 바뀌는 옷만
 */
export function computeWearChanges(before: LogRef | null, after: LogRef | null, others: LogRef[], items: ItemWear[]): ItemWear[] {
  const beforeIds = new Set(before?.item_ids ?? []);
  const afterIds = new Set(after?.item_ids ?? []);
  const changes: ItemWear[] = [];

  for (const item of items) {
    const had = beforeIds.has(item.id);
    const has = afterIds.has(item.id);
    if (!had && !has) continue;

    const otherDates = new Set<string>();
    for (const o of others) if (o.item_ids.includes(item.id)) otherDates.add(o.worn_date);

    const sameDay = had && has && before!.worn_date === after!.worn_date;
    let delta = 0;
    if (had && !sameDay && !otherDates.has(before!.worn_date)) delta -= 1;
    if (has && !sameDay && !otherDates.has(after!.worn_date)) delta += 1;
    const wear_count = Math.max(0, item.wear_count + delta);

    // 마지막 착용일: 빠지는 기록이 그 날짜의 유일한 근거였다면 버리고, 남은 기록 기준으로 다시 잡는다
    let base = item.last_worn_date;
    if (had && !sameDay && base === before!.worn_date && !otherDates.has(before!.worn_date)) base = null;
    let latestRemaining: string | null = null;
    for (const d of otherDates) latestRemaining = maxDate(latestRemaining, d);
    if (has) latestRemaining = maxDate(latestRemaining, after!.worn_date);
    const last_worn_date = base === null ? latestRemaining : has ? maxDate(base, after!.worn_date) : base;

    if (wear_count !== item.wear_count || last_worn_date !== item.last_worn_date) {
      changes.push({ id: item.id, wear_count, last_worn_date });
    }
  }
  return changes;
}

/** 두 기록이 같은 옷 집합인지 (순서 무시) */
export function sameItemSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}
