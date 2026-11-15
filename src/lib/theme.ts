import { useSyncExternalStore } from "react";

/**
 * 테마: 기본은 시스템 설정을 따르고, 설정 화면에서 라이트/다크로 고정할 수 있다.
 * 고른 값은 localStorage("clothe:theme")에 저장되고, index.html의 인라인 스크립트가
 * 첫 화면이 그려지기 전에 <html data-theme>에 적용한다. 여기는 그 이후의 변경을 맡는다.
 */
export type ThemeMode = "system" | "light" | "dark";

const KEY = "clothe:theme";
export const THEME_COLOR = { light: "#faf9f7", dark: "#0f0f0e" } as const;

const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemeMode(): ThemeMode {
  const m = document.documentElement.dataset.themeMode;
  return m === "light" || m === "dark" ? m : "system";
}

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && media.matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themeMode = mode;
  // 상태 표시줄/주소창 색: 수동 테마면 두 메타 모두 같은 색, 시스템이면 각자 원래 색
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const forDark = meta.media.includes("dark");
    meta.content = mode === "system" ? THEME_COLOR[forDark ? "dark" : "light"] : THEME_COLOR[dark ? "dark" : "light"];
  });
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    // 저장소를 못 써도 이번 실행 동안은 적용된다
  }
  apply(mode);
  listeners.forEach((fn) => fn());
}

media.addEventListener("change", () => {
  if (getThemeMode() === "system") apply("system");
});

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  return [useSyncExternalStore(subscribe, getThemeMode), setThemeMode];
}
