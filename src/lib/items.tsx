import { useMemo } from "react";
import type { Item, Outfit, WearResult } from "../../shared/types";
import { api } from "./api";
import { invalidateQueries, mutateQuery, optimistic, peekQuery, revalidate, useQuery } from "./query";

export const ITEMS_PATH = "/items";
export const OUTFITS_PATH = "/outfits";

// 같은 목록이면 같은 Map을 돌려줘서 화면마다 다시 만들지 않는다
const EMPTY: Item[] = [];
const mapCache = new WeakMap<Item[], Map<string, Item>>();
function indexById(items: Item[]): Map<string, Item> {
  let m = mapCache.get(items);
  if (!m) {
    m = new Map(items.map((i) => [i.id, i]));
    mapCache.set(items, m);
  }
  return m;
}

export interface ItemsState {
  items: Item[];
  byId: Map<string, Item>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** 옷장 전체. 앱 전체가 하나의 캐시를 같이 쓴다. */
export function useItems(): ItemsState {
  const q = useQuery<Item[]>(ITEMS_PATH);
  const items = q.data ?? EMPTY;
  const { loading, error, reload: reloadQuery } = q;
  return useMemo(
    () => ({
      items,
      byId: indexById(items),
      loading,
      error,
      reload: async () => {
        await reloadQuery();
      },
    }),
    [items, loading, error, reloadQuery],
  );
}

/** 저장한 코디 전체 */
export function useOutfits() {
  return useQuery<Outfit[]>(OUTFITS_PATH);
}

/** 예전 이름 호환: useQuery와 같다 */
export function useFetch<T>(path: string | null) {
  const q = useQuery<T>(path);
  return { data: q.data ?? null, setData: q.mutate, error: q.error, loading: q.loading, reload: q.reload };
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 캐시에 있는 옷 한 벌을 바로 고친다 */
export function patchItemInCache(item: Item) {
  mutateQuery<Item[]>(ITEMS_PATH, (cur) => {
    if (!cur) return cur;
    return cur.some((i) => i.id === item.id) ? cur.map((i) => (i.id === item.id ? item : i)) : [item, ...cur];
  });
}

export function removeItemFromCache(id: string) {
  mutateQuery<Item[]>(ITEMS_PATH, (cur) => cur?.filter((i) => i.id !== id));
}

/** 서버가 돌려준 갱신된 옷들로 캐시를 고친다 (착용 기록 뒤 등) */
export function patchItemsInCache(updated: Item[]) {
  if (!updated.length) return;
  const m = new Map(updated.map((i) => [i.id, i]));
  mutateQuery<Item[]>(ITEMS_PATH, (cur) => cur?.map((i) => m.get(i.id) ?? i));
}

/** 착용 기록이 바뀌었을 때: 달력·장롱템 캐시를 다시 받게 한다 */
export function invalidateWearCaches() {
  invalidateQueries((path) => path.startsWith("/logs") || path === "/items/dormant");
}

/**
 * 착용 기록 (+1). 화면의 착용 횟수는 바로 올라가고, 실패하면 되돌린다.
 * 성공하면 서버가 돌려준 실제 값(wear_count, last_worn_date)으로 맞춘다.
 * duplicate 면 같은 날 같은 조합이 이미 기록돼 있어서 횟수는 그대로다.
 */
export async function wearItems(itemIds: string[], extra: { outfit_id?: string; weather_summary?: string } = {}): Promise<WearResult> {
  const ids = new Set(itemIds);
  const result = await optimistic<Item[], WearResult>(
    ITEMS_PATH,
    (cur) => cur?.map((i) => (ids.has(i.id) ? { ...i, wear_count: i.wear_count + 1 } : i)),
    () => api<WearResult>("/items/wear", { method: "POST", json: { item_ids: [...ids], ...extra } }),
    false,
  );
  patchItemsInCache(result.items ?? []);
  invalidateWearCaches();
  return result;
}

/** 착용 기록 결과를 짧게 알린다 */
export function wearToast(r: WearResult) {
  return r.duplicate ? "그날 같은 조합이 이미 기록돼 있어요" : "오늘 입은 걸로 기록했어요";
}

/**
 * 코디 저장. 목록에는 바로 나타나고, 서버가 준 진짜 값으로 바꿔 끼운다.
 */
export async function createOutfit(body: { name: string; item_ids: string[]; source?: Outfit["source"]; reason?: string | null; tags?: string[] }): Promise<Outfit> {
  const temp: Outfit = {
    id: `temp-${Date.now()}`,
    name: body.name,
    item_ids: body.item_ids,
    source: body.source ?? "manual",
    reason: body.reason ?? null,
    tags: body.tags ?? [],
    created_at: new Date().toISOString(),
  };
  const hadList = peekQuery<Outfit[]>(OUTFITS_PATH) !== undefined;
  if (hadList) mutateQuery<Outfit[]>(OUTFITS_PATH, (cur) => [temp, ...(cur ?? [])]);
  try {
    const saved = await api<Outfit>("/outfits", { method: "POST", json: body });
    if (hadList) mutateQuery<Outfit[]>(OUTFITS_PATH, (cur) => cur?.map((o) => (o.id === temp.id ? saved : o)));
    else void revalidate(OUTFITS_PATH);
    return saved;
  } catch (err) {
    if (hadList) mutateQuery<Outfit[]>(OUTFITS_PATH, (cur) => cur?.filter((o) => o.id !== temp.id));
    throw err;
  }
}

export function cpw(item: Pick<Item, "purchase_price" | "wear_count">): number | null {
  if (!item.purchase_price) return null;
  return item.purchase_price / Math.max(1, item.wear_count);
}

/** 링크 칸 검사: 비어 있거나 http(s) 주소면 null, 아니면 한국어 오류 */
export function linkError(v: string, label = "링크"): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\/[^\s]+$/i.test(t)) return null;
  return `${label}: http(s)로 시작하는 주소만 넣을 수 있어요`;
}
