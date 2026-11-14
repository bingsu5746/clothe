import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item } from "../../shared/types";
import { api } from "./api";

interface ItemsCtx {
  items: Item[];
  byId: Map<string, Item>;
  loading: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<ItemsCtx | null>(null);

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setItems(await api<Item[]>("/items"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return <Ctx.Provider value={{ items, byId, loading, reload }}>{children}</Ctx.Provider>;
}

export function useItems() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ItemsProvider 밖에서 useItems 사용");
  return v;
}

/** 간단한 데이터 로딩 훅 */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, setData, error, loading, reload: load };
}
