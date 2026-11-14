import { NavLink, Outlet } from "react-router";
import { GearIcon, HangerIcon, HeartIcon, ImageIcon, LayersIcon, SunIcon } from "./icons";
import { ToastHost } from "./ui";

const TABS = [
  { to: "/", label: "오늘", icon: SunIcon, end: true },
  { to: "/closet", label: "옷장", icon: HangerIcon },
  { to: "/outfits", label: "코디", icon: LayersIcon },
  { to: "/inspo", label: "스크랩", icon: ImageIcon },
  { to: "/wishlist", label: "위시", icon: HeartIcon },
];

export default function Layout() {
  return (
    <div className="min-h-dvh md:flex">
      {/* 태블릿/데스크톱: 사이드바 */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line pt-safe pl-safe md:flex lg:w-64">
        <div className="px-6 pt-6 pb-8 text-lg font-extrabold tracking-tight">내 옷장</div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold ${isActive ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
            >
              <Icon /> {label}
            </NavLink>
          ))}
        </nav>
        <NavLink
          to="/settings"
          className={({ isActive }) => `m-3 mb-6 flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold ${isActive ? "bg-surface-2" : "text-muted hover:text-ink"}`}
        >
          <GearIcon /> 설정
        </NavLink>
      </aside>

      <main className="mx-auto w-full max-w-5xl flex-1 pb-[calc(env(safe-area-inset-bottom)+96px)] pl-safe pr-safe md:pb-12">
        <div className="px-4 md:px-8">
          <Outlet />
        </div>
      </main>

      {/* 모바일: 하단 탭 바 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-safe backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-lg">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-semibold ${isActive ? "text-ink" : "text-muted"}`}
            >
              <Icon width={24} height={24} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <ToastHost />
    </div>
  );
}
