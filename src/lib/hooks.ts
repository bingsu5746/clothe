import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** CSS 미디어 쿼리 구독 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** 태블릿/데스크톱 레이아웃(사이드바, 분할 보기)인지 */
export const WIDE_QUERY = "(min-width: 768px)";
export function useIsWide() {
  return useMediaQuery(WIDE_QUERY);
}

/**
 * 닫힐 때 나가는 애니메이션이 끝날 때까지 DOM에 남겨 두기.
 * mounted가 true인 동안 렌더하고, closing이면 나가는 애니메이션 클래스를 붙인다.
 */
export function usePresence(open: boolean, exitMs = 280) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, mounted, exitMs]);
  return { mounted, closing: mounted && !open };
}

/** localStorage에 저장되는 켜고 끄기 값 */
export function useStoredFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // 저장 실패는 무시 (이번 화면에서는 적용됨)
      }
    },
    [key],
  );
  return [value, set];
}
