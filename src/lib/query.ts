import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * 아주 작은 SWR식 데이터 캐시.
 * - 같은 경로(GET /api{path})는 화면을 오가도 다시 기다리지 않고 캐시를 바로 보여 준다.
 * - 오래된 캐시(staleTime 지남)는 보여 주면서 뒤에서 조용히 새로 받는다.
 * - 동시에 같은 요청이 여러 번 나가지 않는다.
 * - mutateQuery / optimistic 으로 서버 응답을 기다리지 않고 화면을 먼저 바꿀 수 있다.
 */

export interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  /** 보여 줄 데이터가 아직 없고 받는 중 (스켈레톤을 보여 줄 때) */
  loading: boolean;
  /** 데이터는 있고 뒤에서 새로 받는 중 */
  validating: boolean;
}

interface Entry<T> {
  state: QueryState<T>;
  fetchedAt: number;
  promise: Promise<T> | null;
  /** 낙관적 업데이트 뒤에 도착한 예전 응답을 버리기 위한 번호 */
  version: number;
  listeners: Set<() => void>;
}

const DEFAULT_STALE_MS = 30_000;
const cache = new Map<string, Entry<unknown>>();
const IDLE: QueryState<never> = { data: undefined, error: null, loading: false, validating: false };

function entry<T>(path: string): Entry<T> {
  let e = cache.get(path) as Entry<T> | undefined;
  if (!e) {
    e = { state: { data: undefined, error: null, loading: false, validating: false }, fetchedAt: 0, promise: null, version: 0, listeners: new Set() };
    cache.set(path, e as Entry<unknown>);
  }
  return e;
}

function setState<T>(e: Entry<T>, patch: Partial<QueryState<T>>) {
  e.state = { ...e.state, ...patch };
  e.listeners.forEach((fn) => fn());
}

/** 서버에서 새로 받는다 (이미 받는 중이면 그 요청을 같이 기다림) */
export function revalidate<T>(path: string): Promise<T | undefined> {
  const e = entry<T>(path);
  if (e.promise) return e.promise.catch(() => undefined);
  const version = e.version;
  setState(e, { loading: e.state.data === undefined, validating: true });
  const p = api<T>(path);
  e.promise = p;
  return p
    .then((data) => {
      if (e.promise === p) e.promise = null;
      if (e.version !== version) return e.state.data;
      e.fetchedAt = Date.now();
      setState(e, { data, error: null, loading: false, validating: false });
      return data;
    })
    .catch((err: Error) => {
      if (e.promise === p) e.promise = null;
      if (e.version !== version) return undefined;
      setState(e, { error: err.message, loading: false, validating: false });
      return undefined;
    });
}

/** 지금 화면에 쓰이고 있는 모든 데이터를 새로 받는다 (당겨서 새로고침, 앱으로 돌아왔을 때) */
export function revalidateAll(): Promise<unknown> {
  const jobs: Promise<unknown>[] = [];
  cache.forEach((e, path) => {
    if (e.listeners.size > 0) jobs.push(revalidate(path));
    else e.fetchedAt = 0;
  });
  return Promise.all(jobs);
}

export function peekQuery<T>(path: string): T | undefined {
  return (cache.get(path) as Entry<T> | undefined)?.state.data;
}

/** 캐시를 직접 바꾼다. 진행 중이던 요청의 응답은 버려진다. */
export function mutateQuery<T>(path: string, updater: T | ((cur: T | undefined) => T | undefined)) {
  const e = entry<T>(path);
  const next = typeof updater === "function" ? (updater as (cur: T | undefined) => T | undefined)(e.state.data) : updater;
  e.version++;
  e.promise = null;
  setState(e, { data: next, loading: false, validating: false });
}

/**
 * 낙관적 업데이트: 화면을 먼저 바꾸고 요청을 보낸다. 실패하면 원래대로 되돌리고 오류를 다시 던진다.
 * 성공하면 서버 값으로 한 번 맞춘다(revalidateAfter=false 면 생략).
 */
export async function optimistic<T, R>(path: string, updater: (cur: T | undefined) => T | undefined, action: () => Promise<R>, revalidateAfter = true): Promise<R> {
  const before = peekQuery<T>(path);
  mutateQuery<T>(path, updater);
  try {
    const result = await action();
    if (revalidateAfter) void revalidate(path);
    return result;
  } catch (err) {
    mutateQuery<T>(path, () => before);
    throw err;
  }
}

/** 로그아웃 등: 캐시를 모두 비운다 */
export function clearQueries() {
  cache.forEach((e) => {
    e.version++;
    e.promise = null;
    e.fetchedAt = 0;
    setState(e, { data: undefined, error: null, loading: false, validating: false });
  });
}

export interface UseQueryResult<T> extends QueryState<T> {
  reload: () => Promise<T | undefined>;
  mutate: (updater: T | ((cur: T | undefined) => T | undefined)) => void;
}

export function useQuery<T>(path: string | null, opts: { staleTime?: number } = {}): UseQueryResult<T> {
  const staleTime = opts.staleTime ?? DEFAULT_STALE_MS;

  const subscribe = useCallback(
    (fn: () => void) => {
      if (!path) return () => {};
      const e = entry<T>(path);
      e.listeners.add(fn);
      return () => {
        e.listeners.delete(fn);
      };
    },
    [path],
  );
  const getSnapshot = useCallback(() => (path ? entry<T>(path).state : (IDLE as QueryState<T>)), [path]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!path) return;
    const e = entry<T>(path);
    if (e.state.data === undefined || Date.now() - e.fetchedAt > staleTime) void revalidate(path);
  }, [path, staleTime]);

  const reload = useCallback(() => (path ? revalidate<T>(path) : Promise.resolve(undefined)), [path]);
  const mutate = useCallback(
    (updater: T | ((cur: T | undefined) => T | undefined)) => {
      if (path) mutateQuery<T>(path, updater);
    },
    [path],
  );

  // 첫 렌더(아직 요청 전)에도 스켈레톤이 보이도록: 데이터도 오류도 없으면 loading
  const loading = !!path && state.data === undefined && !state.error;
  return useMemo(() => ({ ...state, loading, reload, mutate }), [state, loading, reload, mutate]);
}
