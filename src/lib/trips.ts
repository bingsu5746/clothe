import type { Trip } from "../../shared/types";
import { mutateQuery } from "./query";
import { weekday } from "./logs";

export const TRIPS_PATH = "/trips";
export const tripPath = (id: string) => `/trips/${id}`;

/** 서버가 돌려준 여행으로 목록·상세 캐시를 함께 고친다 */
export function setTrip(t: Trip & { cached?: boolean }) {
  const { cached: _c, ...trip } = t;
  void _c;
  mutateQuery<Trip>(tripPath(trip.id), trip);
  mutateQuery<Trip[]>(TRIPS_PATH, (cur) => (cur ? (cur.some((x) => x.id === trip.id) ? cur.map((x) => (x.id === trip.id ? trip : x)) : [trip, ...cur]) : cur));
}

export function removeTrip(id: string) {
  mutateQuery<Trip[]>(TRIPS_PATH, (cur) => cur?.filter((x) => x.id !== id));
  mutateQuery<Trip | undefined>(tripPath(id), undefined);
}

const dayMs = 86_400_000;
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/** "3박 4일" */
export function nightsLabel(t: Pick<Trip, "start_date" | "end_date">) {
  const n = diffDays(t.start_date, t.end_date);
  return n <= 0 ? "당일치기" : `${n}박 ${n + 1}일`;
}

/** "11.20 (목)" */
export const shortDate = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))} (${weekday(d)})`;

/** 여행까지 남은 날: "D-3", "여행 중", "다녀옴" */
export function dday(t: Pick<Trip, "start_date" | "end_date">, today: string): { label: string; tone: "solid" | "neutral" } {
  if (today < t.start_date) {
    const n = diffDays(today, t.start_date);
    return { label: n === 0 ? "D-day" : `D-${n}`, tone: n <= 7 ? "solid" : "neutral" };
  }
  if (today <= t.end_date) return { label: "여행 중", tone: "solid" };
  return { label: "다녀옴", tone: "neutral" };
}
