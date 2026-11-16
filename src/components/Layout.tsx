import { useEffect, useRef } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { revalidateAll } from "../lib/query";
import { AppLink } from "../lib/router";
import { MORE_PATH, enabledNav, isNavActive, moreNav, tabNav, type NavItem } from "../nav";
import { HangerIcon, MoreIcon, RefreshIcon } from "./icons";

/**
 * 앱 뼈대.
 * - 모바일(<768px): 아래 탭 바 (탭 4개 + 더보기)
 * - 태블릿 세로(768~1099px): 왼쪽 아이콘 레일
 * - 태블릿 가로·데스크톱(≥1100px): 왼쪽 사이드바
 * 스크롤은 문서 전체가 맡는다 (iOS 상태 표시줄 탭으로 맨 위로 가기, 관성 스크롤 유지).
 */
export default function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh">
      <Sidebar pathname={pathname} />
      <main className="pr-safe pl-safe md:pl-[calc(var(--nav-w)+var(--safe-left))]">
        <Outlet />
      </main>
      <TabBar pathname={pathname} />
      <PullToRefresh />
      <ScrollRestoration />
    </div>
  );
}

function scrollTopIfCurrent(active: boolean, to: string, pathname: string) {
  // 이미 보고 있는 탭을 다시 누르면 맨 위로 (iOS 탭 바 관례)
  if (active && pathname === to) window.scrollTo({ top: 0, behavior: "smooth" });
}

function Sidebar({ pathname }: { pathname: string }) {
  const items = enabledNav();
  const link = (n: NavItem) => {
    const active = isNavActive(n, pathname);
    const Icon = n.icon;
    return (
      <AppLink
        key={n.id}
        to={n.to}
        aria-current={active ? "page" : undefined}
        title={n.label}
        onClick={() => scrollTopIfCurrent(active, n.to, pathname)}
        className={`pressable flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] leading-tight font-medium nav:h-10 nav:flex-row nav:gap-3 nav:px-3 nav:py-0 nav:text-callout ${
          active ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink"
        }`}
      >
        <Icon size={22} strokeWidth={active ? 1.9 : 1.6} className="shrink-0" />
        <span className="max-w-full truncate nav:hidden">{n.tabLabel ?? n.label}</span>
        <span className="hidden truncate nav:inline">{n.label}</span>
      </AppLink>
    );
  };
  return (
    <aside className="vt-fixed-sidebar fixed inset-y-0 left-0 z-30 hidden w-[calc(var(--nav-w)+var(--safe-left))] flex-col bg-bg pt-safe pb-safe pl-safe shadow-[0.5px_0_0_0_var(--line-strong)] md:flex">
      <div className="flex h-(--bar-h) items-center justify-center gap-2.5 nav:justify-start nav:px-6">
        <span className="grid size-8 place-items-center rounded-[10px] bg-accent text-accent-ink">
          <HangerIcon size={18} strokeWidth={1.8} />
        </span>
        <span className="hidden text-headline tracking-tight nav:inline">내 옷장</span>
      </div>
      <nav aria-label="주 메뉴" className="scroll-y flex flex-1 flex-col gap-1 px-2 pt-3 nav:px-3">
        {items.filter((n) => n.group === "main").map(link)}
        <div className="mt-auto flex flex-col gap-1 pt-4 pb-3">{items.filter((n) => n.group === "footer").map(link)}</div>
      </nav>
    </aside>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  const tabs = tabNav();
  const more = moreNav();
  const moreActive = pathname === MORE_PATH || more.some((n) => isNavActive(n, pathname));
  const cell = (key: string, to: string, label: string, Icon: NavItem["icon"], active: boolean) => (
    <AppLink
      key={key}
      to={to}
      aria-current={active ? "page" : undefined}
      onClick={() => scrollTopIfCurrent(active, to, pathname)}
      className={`flex h-(--tabbar-h) min-w-0 flex-1 flex-col items-center justify-center gap-[3px] text-[10.5px] leading-none font-medium transition-[color,transform] duration-(--dur-fast) active:scale-95 ${active ? "text-ink" : "text-muted"}`}
    >
      <Icon size={25} strokeWidth={active ? 2 : 1.55} />
      <span className={active ? "font-semibold" : ""}>{label}</span>
    </AppLink>
  );
  return (
    <nav aria-label="탭" className="vt-fixed-tabbar bar-material hairline-t fixed inset-x-0 bottom-0 z-30 pr-safe pb-safe pl-safe md:hidden">
      <div className="mx-auto flex max-w-xl px-1">
        {tabs.map((n) => cell(n.id, n.to, n.tabLabel ?? n.label, n.icon, isNavActive(n, pathname)))}
        {more.length > 0 && cell("more", MORE_PATH, "더보기", MoreIcon, moreActive)}
      </div>
    </nav>
  );
}

const PULL_TRIGGER = 64;
const PULL_MAX = 96;

/**
 * 당겨서 새로고침 (터치 전용). 홈 화면 앱에는 브라우저 새로고침 버튼이 없어서 직접 구현한다.
 * 맨 위에서 아래로 당기면 표시가 내려오고, 충분히 당겼다 놓으면 화면의 데이터를 새로 받는다.
 */
function PullToRefresh() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY: number | null = null;
    let pull = 0;
    let busy = false;
    const render = (animate: boolean) => {
      el.style.transition = animate ? "transform 260ms cubic-bezier(0.2, 0, 0, 1), opacity 260ms" : "none";
      el.style.transform = `translateY(${pull}px)`;
      el.style.opacity = String(Math.min(1, pull / (PULL_TRIGGER * 0.7)));
      const icon = el.firstElementChild as HTMLElement | null;
      if (icon && !busy) icon.style.transform = `rotate(${pull * 3.2}deg)`;
    };
    const onStart = (e: TouchEvent) => {
      const modalOpen = document.getElementById("root")?.hasAttribute("inert");
      startY = !busy && !modalOpen && window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pull) {
          pull = 0;
          render(true);
        }
        if (window.scrollY > 0) startY = null;
        return;
      }
      pull = Math.min(PULL_MAX, dy * 0.45);
      render(false);
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (pull >= PULL_TRIGGER) {
        busy = true;
        pull = PULL_TRIGGER;
        render(true);
        el.dataset.busy = "true";
        await Promise.all([revalidateAll(), new Promise((r) => setTimeout(r, 500))]);
        delete el.dataset.busy;
        busy = false;
      }
      pull = 0;
      render(true);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className="group pointer-events-none fixed top-[calc(var(--safe-top)-44px)] left-1/2 z-40 -ml-[18px] grid size-9 place-items-center rounded-full bg-surface text-ink opacity-0 shadow-2 md:left-[calc(50%+var(--nav-w)/2)]"
    >
      <RefreshIcon size={18} className="group-data-busy:animate-spin" />
    </div>
  );
}
