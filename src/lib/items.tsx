import { useMemo } from "react";
import type { Item, Outfit } from "../../shared/types";
import { api } from "./api";
import { mutateQuery, optimistic, peekQuery, revalidate, useQuery } from "./query";

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

/**
 * 착용 기록 (+1). 화면의 착용 횟수는 바로 올라가고, 실패하면 되돌린다.
 */
export async function wearItems(itemIds: string[], extra: { outfit_id?: string; weather_summary?: string } = {}): Promise<void> {
  const ids = new Set(itemIds);
  const today = todayKST();
  await optimistic<Item[], unknown>(
    ITEMS_PATH,
    (cur) => cur?.map((i) => (ids.has(i.id) ? { ...i, wear_count: i.wear_count + 1, last_worn_date: !i.last_worn_date || i.last_worn_date < today ? today : i.last_worn_date } : i)),
    () => api("/items/wear", { method: "POST", json: { item_ids: [...ids], ...extra } }),
    false,
  );
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
