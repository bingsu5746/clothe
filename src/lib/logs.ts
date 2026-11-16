import type { OutfitLog } from "../../shared/types";
import { ITEMS_PATH, invalidateWearCaches } from "./items";
import { mutateQuery, peekQuery, revalidate } from "./query";

/** 달력 한 달치 기록 */
export const monthPath = (month: string) => `/logs?month=${month}`;

const byDateDesc = (a: OutfitLog, b: OutfitLog) => b.worn_date.localeCompare(a.worn_date) || b.created_at.localeCompare(a.created_at);

/** 기록을 넣거나 고친 뒤: 달력 캐시를 바로 고치고, 착용 횟수가 바뀐 옷장을 새로 받는다 */
export function applyLog(log: OutfitLog, previous?: OutfitLog | null) {
  if (previous && previous.worn_date.slice(0, 7) !== log.worn_date.slice(0, 7)) {
    mutateQuery<OutfitLog[]>(monthPath(previous.worn_date.slice(0, 7)), (cur) => cur?.filter((l) => l.id !== log.id));
  }
  const path = monthPath(log.worn_date.slice(0, 7));
  if (peekQuery<OutfitLog[]>(path)) mutateQuery<OutfitLog[]>(path, (cur) => [...(cur ?? []).filter((l) => l.id !== log.id), log].sort(byDateDesc));
  afterWearChange();
}

export function removeLog(log: OutfitLog) {
  mutateQuery<OutfitLog[]>(monthPath(log.worn_date.slice(0, 7)), (cur) => cur?.filter((l) => l.id !== log.id));
  afterWearChange();
}

/** 착용 횟수·마지막 착용일은 서버가 다시 계산하므로 옷장을 새로 받는다 */
function afterWearChange() {
  void revalidate(ITEMS_PATH);
  invalidateWearCaches();
}

/** 한국 시간 기준 날짜 계산 */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export function weekday(date: string) {
  return WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
/** "11월 16일 (일)" */
export function dayLabel(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 (${weekday(date)})`;
}

/** 자주 쓰는 상황 태그 */
export const OCCASIONS = ["출근", "데이트", "약속", "여행", "운동", "집콕", "행사"];
