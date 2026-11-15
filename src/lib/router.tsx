import { useCallback } from "react";
import { Link, NavLink, useNavigate, type LinkProps, type NavLinkProps, type NavigateOptions, type To } from "react-router";

/**
 * 화면 이동 도우미.
 * - AppLink / AppNavLink / useNav: 항상 View Transition을 켠 이동 (지원하지 않는 브라우저는 그냥 이동).
 * - 이동 방향(push/pop/tab)을 <html data-vt>에 적어 CSS가 알맞은 전환을 고르게 한다 (index.css).
 * - goBack: 바로 전 화면이 돌아갈 곳이면 history.back()으로 돌아가 스크롤 위치를 되살린다.
 */

interface RouterLike {
  state: { location: { pathname: string; key: string }; historyAction: string };
  subscribe(fn: (state: RouterLike["state"]) => void): () => void;
}

const depth = (pathname: string) => pathname.split("/").filter(Boolean).length;

let stack: { key: string; pathname: string }[] = [];
let index = -1;

export function trackNavigation(router: RouterLike) {
  const first = router.state.location;
  stack = [{ key: first.key, pathname: first.pathname }];
  index = 0;
  return router.subscribe((state) => {
    const loc = state.location;
    const current = stack[index];
    if (!current || current.key === loc.key) return;
    const from = current.pathname;
    if (state.historyAction === "PUSH") {
      stack = [...stack.slice(0, index + 1), { key: loc.key, pathname: loc.pathname }];
      index = stack.length - 1;
    } else if (state.historyAction === "REPLACE") {
      stack[index] = { key: loc.key, pathname: loc.pathname };
    } else {
      const found = stack.findIndex((s) => s.key === loc.key);
      if (found >= 0) index = found;
      else {
        stack = [{ key: loc.key, pathname: loc.pathname }];
        index = 0;
      }
    }
    const d = depth(loc.pathname) - depth(from);
    document.documentElement.dataset.vt = d > 0 ? "push" : d < 0 ? "pop" : "tab";
  });
}

/** 앱 안에서 바로 전에 보던 화면의 경로 (없으면 null) */
export function previousPath(): string | null {
  return index > 0 ? stack[index - 1].pathname : null;
}

export function AppLink(props: LinkProps) {
  return <Link viewTransition {...props} />;
}

export function AppNavLink(props: NavLinkProps) {
  return <NavLink viewTransition {...props} />;
}

export function useNav() {
  const navigate = useNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") return navigate(to);
      return navigate(to, { viewTransition: true, ...options });
    },
    [navigate],
  );
}

/** 뒤로: 전 화면이 fallback이면 history.back(), 아니면(새로고침·직접 진입) fallback으로 교체 이동 */
export function useGoBack() {
  const nav = useNav();
  return useCallback(
    (fallback: string) => {
      if (previousPath() === fallback) nav(-1);
      else nav(fallback, { replace: true });
    },
    [nav],
  );
}
