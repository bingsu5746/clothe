import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, useLocation, useNavigate, useNavigationType, type LinkProps, type NavLinkProps, type NavigateOptions, type To } from "react-router";

/**
 * 화면 이동 도우미 (선언형 BrowserRouter 위에서 동작 — 데이터 라우터보다 번들이 약 20kB(gzip) 작다).
 *
 * - AppLink / AppNavLink / useNav: View Transition 을 켠 이동. 지원하지 않는 브라우저나 "동작 줄이기"면 그냥 이동.
 * - 이동 방향(push/pop/tab)을 <html data-vt>에 적어 CSS가 알맞은 전환을 고르게 한다 (index.css).
 * - useGoBack: 바로 전 화면이 돌아갈 곳이면 history.back()으로 돌아가 스크롤 위치를 되살린다.
 * - preventScrollReset: 이동해도 스크롤을 맨 위로 올리지 않는다 (분할 보기에서 목록 위치 유지).
 * - <NavigationEffects />: 방문 기록 추적과 스크롤 복원. Layout 에 한 번 둔다.
 */

const depth = (pathname: string) => pathname.split("/").filter(Boolean).length;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 화면 바꾸기를 View Transition 으로 감싼다. update 가 끝나면 새 화면을 찍는다. */
function withTransition(update: () => void | Promise<void>) {
  const from = window.location.pathname;
  const setDirection = () => {
    const d = depth(window.location.pathname) - depth(from);
    document.documentElement.dataset.vt = d > 0 ? "push" : d < 0 ? "pop" : "tab";
  };
  if (!document.startViewTransition || reducedMotion()) {
    void update();
    return;
  }
  document.startViewTransition(async () => {
    await update();
    setDirection();
  });
}

/** 뒤로 가기는 popstate 가 비동기라서, 새 화면이 그려질 때까지 기다린다 */
function waitForPop(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("popstate", onPop);
      resolve();
    };
    const onPop = () => requestAnimationFrame(() => requestAnimationFrame(finish));
    window.addEventListener("popstate", onPop);
    setTimeout(finish, 400);
  });
}

export type AppNavigateOptions = NavigateOptions & { preventScrollReset?: boolean };

function withScrollFlag(options: AppNavigateOptions | undefined): NavigateOptions | undefined {
  if (!options?.preventScrollReset) return options;
  const { preventScrollReset: _ignored, ...rest } = options;
  void _ignored;
  const state = typeof rest.state === "object" && rest.state ? rest.state : {};
  return { ...rest, state: { ...state, keepScroll: true } };
}

export function useNav() {
  const navigate = useNavigate();
  return useCallback(
    (to: To | number, options?: AppNavigateOptions) => {
      if (typeof to === "number") {
        withTransition(() => {
          navigate(to);
          return waitForPop();
        });
        return;
      }
      withTransition(() => flushSync(() => navigate(to, withScrollFlag(options))));
    },
    [navigate],
  );
}

const isPlainClick = (e: MouseEvent<HTMLAnchorElement>) => e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.defaultPrevented;

type AppLinkProps = LinkProps & { preventScrollReset?: boolean };

export function AppLink({ preventScrollReset, onClick, to, replace, state, target, ...rest }: AppLinkProps) {
  const nav = useNav();
  return (
    <Link
      {...rest}
      to={to}
      replace={replace}
      state={state}
      target={target}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainClick(e) || (target && target !== "_self")) return;
        e.preventDefault();
        nav(to, { replace, state, preventScrollReset });
      }}
    />
  );
}

export function AppNavLink({ onClick, to, replace, state, target, ...rest }: NavLinkProps) {
  const nav = useNav();
  return (
    <NavLink
      {...rest}
      to={to}
      replace={replace}
      state={state}
      target={target}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainClick(e) || (target && target !== "_self")) return;
        e.preventDefault();
        nav(to, { replace, state });
      }}
    />
  );
}

/* ───────── 방문 기록 (앱 안에서 바로 전 화면) ───────── */

let stack: { key: string; pathname: string }[] = [];
let index = -1;

/** 앱 안에서 바로 전에 보던 화면의 경로 (없으면 null) */
export function previousPath(): string | null {
  return index > 0 ? stack[index - 1].pathname : null;
}

/** 뒤로: 전 화면이 fallback 이면 history.back(), 아니면(새로고침·직접 진입) fallback 으로 교체 이동 */
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

/** 방문 기록 추적 + 스크롤 위치 저장/복원. Layout 에 한 번만 둔다. */
export function NavigationEffects() {
  const location = useLocation();
  const type = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const currentKey = useRef(location.key);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    // 스크롤할 때마다 지금 화면의 위치를 기억해 둔다
    const onScroll = () => positions.current.set(currentKey.current, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const loc = { key: location.key, pathname: location.pathname };
    currentKey.current = location.key;

    // 방문 기록
    if (index < 0) {
      stack = [loc];
      index = 0;
    } else if (stack[index]?.key !== loc.key) {
      if (type === "PUSH") {
        stack = [...stack.slice(0, index + 1), loc];
        index = stack.length - 1;
      } else if (type === "REPLACE") {
        stack[index] = loc;
      } else {
        const found = stack.findIndex((s) => s.key === loc.key);
        if (found >= 0) index = found;
        else {
          stack = [loc];
          index = 0;
        }
      }
    }

    // 스크롤: 뒤로/앞으로면 기억한 위치로, 새로 들어가면 맨 위로 (keepScroll 이면 그대로)
    const keep = (location.state as { keepScroll?: boolean } | null)?.keepScroll;
    if (type === "POP") {
      const y = positions.current.get(location.key) ?? 0;
      window.scrollTo(0, y);
      // 화면 조각이 늦게 그려져 높이가 모자랐으면 한 프레임 뒤에 한 번 더
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
      });
    } else if (!keep) {
      window.scrollTo(0, 0);
    }
  }, [location.key, location.pathname, location.state, type]);

  return null;
}
