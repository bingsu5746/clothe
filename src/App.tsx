import { useEffect, useState } from "react";
import { RouterProvider, createBrowserRouter, useRouteError, type RouteObject } from "react-router";
import Layout from "./components/Layout";
import { HangerIcon, RefreshIcon } from "./components/icons";
import { Button, DialogHost, Empty, Skeleton, ToastHost } from "./components/ui";
import { api, setUnauthorizedHandler } from "./lib/api";
import { reloadOnceForStaleChunk } from "./lib/pwa";
import { clearQueries } from "./lib/query";
import { trackNavigation } from "./lib/router";
import Login from "./pages/Login";

/* 화면은 경로별로 따로 내려받는다 (첫 화면에 필요한 코드만 먼저) */
const pages = {
  today: () => import("./pages/Today"),
  closet: () => import("./pages/Closet"),
  itemEdit: () => import("./pages/ItemEdit"),
  outfits: () => import("./pages/Outfits"),
  outfitDetail: () => import("./pages/OutfitDetail"),
  inspirations: () => import("./pages/Inspirations"),
  inspirationDetail: () => import("./pages/InspirationDetail"),
  wishlist: () => import("./pages/Wishlist"),
  wishDetail: () => import("./pages/WishDetail"),
  settings: () => import("./pages/Settings"),
  more: () => import("./pages/More"),
};
const lazy = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

/**
 * 경로 표. 새 화면은 여기에 경로를 추가하고 src/nav.ts 에서 enabled 를 켠다.
 * 옷장은 분할 보기: /closet 이 목록, 그 안의 자식 경로가 오른쪽(모바일은 전체 화면) 상세.
 */
const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <RouteError />,
    HydrateFallback: ShellFallback,
    children: [
      { index: true, lazy: lazy(pages.today) },
      {
        path: "closet",
        lazy: lazy(pages.closet),
        children: [
          { index: true, element: null },
          { path: "new", lazy: lazy(pages.itemEdit) },
          { path: ":id", lazy: lazy(pages.itemEdit) },
        ],
      },
      { path: "outfits", lazy: lazy(pages.outfits) },
      { path: "outfits/:id", lazy: lazy(pages.outfitDetail) },
      { path: "inspo", lazy: lazy(pages.inspirations) },
      { path: "inspo/:id", lazy: lazy(pages.inspirationDetail) },
      { path: "wishlist", lazy: lazy(pages.wishlist) },
      { path: "wishlist/:id", lazy: lazy(pages.wishDetail) },
      { path: "settings", lazy: lazy(pages.settings) },
      { path: "more", lazy: lazy(pages.more) },
      { path: "*", lazy: lazy(pages.today) },
    ],
  },
];

let router: ReturnType<typeof createBrowserRouter> | null = null;
function getRouter() {
  if (!router) {
    router = createBrowserRouter(routes);
    trackNavigation(router);
    // 한가할 때 나머지 화면 코드를 미리 받아 둔다 (탭 전환이 바로 되고, 오프라인에서도 열림)
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
    idle(() => Object.values(pages).forEach((load) => void load().catch(() => {})));
  }
  return router;
}

/** 첫 화면 코드를 받는 동안: 빈 뼈대 */
function ShellFallback() {
  return (
    <div className="px-gutter pt-[calc(var(--safe-top)+var(--bar-h))] md:pl-[calc(var(--nav-w)+var(--gutter))]" role="status" aria-label="불러오는 중">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="mt-8 h-40 w-full max-w-xl rounded-lg" />
    </div>
  );
}

function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "";
  const staleChunk = /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(message);
  // 새로 배포되어 예전 화면 조각이 없어진 경우: 조용히 한 번 새로고침
  const [reloading] = useState(() => staleChunk && reloadOnceForStaleChunk());
  if (reloading) return null;
  return (
    <div className="grid min-h-dvh place-items-center">
      <Empty
        icon={<RefreshIcon size={26} />}
        title="화면을 불러오지 못했어요"
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            다시 시도
          </Button>
        }
      >
        {staleChunk ? "앱이 업데이트되었을 수 있어요. 다시 불러와 주세요." : "잠시 후 다시 시도해 주세요."}
      </Empty>
    </div>
  );
}

const AUTH_HINT = "clothe:authed";
const readHint = () => {
  try {
    return localStorage.getItem(AUTH_HINT) === "1";
  } catch {
    return false;
  }
};
const writeHint = (v: boolean) => {
  try {
    if (v) localStorage.setItem(AUTH_HINT, "1");
    else localStorage.removeItem(AUTH_HINT);
  } catch {
    // 힌트일 뿐이라 저장 실패는 무시
  }
};

export default function App() {
  // 지난번에 로그인되어 있었으면 확인을 기다리지 않고 바로 앱을 보여 준다 (세션이 만료됐으면 401 → 로그인 화면)
  const [authed, setAuthed] = useState<boolean | null>(() => (readHint() ? true : null));

  useEffect(() => {
    setUnauthorizedHandler(() => {
      writeHint(false);
      clearQueries();
      setAuthed(false);
    });
    api("/auth/me")
      .then(() => {
        writeHint(true);
        setAuthed(true);
      })
      .catch(() => setAuthed((cur) => (cur === true && navigator.onLine === false ? cur : false)));
  }, []);

  return (
    <>
      {authed === null ? (
        <div className="grid min-h-dvh place-items-center" role="status" aria-label="불러오는 중">
          <span className="grid size-14 animate-fade-in place-items-center rounded-[18px] bg-accent text-accent-ink">
            <HangerIcon size={30} strokeWidth={1.7} />
          </span>
        </div>
      ) : authed ? (
        <RouterProvider router={getRouter()} />
      ) : (
        <Login
          onLogin={() => {
            writeHint(true);
            setAuthed(true);
          }}
        />
      )}
      <ToastHost />
      <DialogHost />
    </>
  );
}
