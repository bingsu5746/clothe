import { lazy, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import Layout from "./components/Layout";
import { HangerIcon } from "./components/icons";
import { DialogHost, ToastHost } from "./components/ui";
import { api, setUnauthorizedHandler } from "./lib/api";
import { clearQueries } from "./lib/query";
import Login from "./pages/Login";

/* 화면은 경로별로 따로 내려받는다 (첫 화면에 필요한 코드만 먼저) */
const loaders = {
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
  profile: () => import("./pages/Profile"),
  colorDiagnosis: () => import("./pages/ColorDiagnosis"),
  fittingRoom: () => import("./pages/FittingRoom"),
  ootdCalendar: () => import("./pages/OotdCalendar"),
  ootdNew: () => import("./pages/OotdNew"),
  travel: () => import("./pages/Travel"),
  tripDetail: () => import("./pages/TripDetail"),
  more: () => import("./pages/More"),
  notFound: () => import("./pages/NotFound"),
};
const Today = lazy(loaders.today);
const Closet = lazy(loaders.closet);
const ItemEdit = lazy(loaders.itemEdit);
const Outfits = lazy(loaders.outfits);
const OutfitDetail = lazy(loaders.outfitDetail);
const Inspirations = lazy(loaders.inspirations);
const InspirationDetail = lazy(loaders.inspirationDetail);
const Wishlist = lazy(loaders.wishlist);
const WishDetail = lazy(loaders.wishDetail);
const Settings = lazy(loaders.settings);
const More = lazy(loaders.more);
const Profile = lazy(loaders.profile);
const ColorDiagnosis = lazy(loaders.colorDiagnosis);
const FittingRoom = lazy(loaders.fittingRoom);
const OotdCalendar = lazy(loaders.ootdCalendar);
const OotdNew = lazy(loaders.ootdNew);
const Travel = lazy(loaders.travel);
const TripDetail = lazy(loaders.tripDetail);
const NotFound = lazy(loaders.notFound);

let preloaded = false;
/** 한가할 때 나머지 화면 코드를 미리 받아 둔다 (탭 전환이 바로 되고, 오프라인에서도 열림) */
function preloadPages() {
  if (preloaded) return;
  preloaded = true;
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  idle(() => Object.values(loaders).forEach((load) => void load().catch(() => {})));
}

/**
 * 경로 표. 새 화면은 여기에 경로를 추가하고 src/nav.ts 에서 enabled 를 켠다.
 * 옷장은 분할 보기: /closet 이 목록, 그 안의 자식 경로가 오른쪽(모바일은 전체 화면) 상세.
 */
function AppRoutes() {
  useEffect(preloadPages, []);
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="closet" element={<Closet />}>
          <Route index element={null} />
          <Route path="new" element={<ItemEdit />} />
          <Route path=":id" element={<ItemEdit />} />
        </Route>
        <Route path="outfits" element={<Outfits />} />
        <Route path="outfits/calendar" element={<OotdCalendar />} />
        <Route path="outfits/ootd" element={<OotdNew />} />
        <Route path="outfits/:id" element={<OutfitDetail />} />
        <Route path="inspo" element={<Inspirations />} />
        <Route path="inspo/:id" element={<InspirationDetail />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route path="wishlist/:id" element={<WishDetail />} />
        <Route path="travel" element={<Travel />} />
        <Route path="travel/:id" element={<TripDetail />} />
        <Route path="profile" element={<Profile />} />
        <Route path="profile/color" element={<ColorDiagnosis />} />
        <Route path="profile/fitting" element={<FittingRoom />} />
        <Route path="settings" element={<Settings />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
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
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
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
