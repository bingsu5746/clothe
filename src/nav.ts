import { BookmarkIcon, GearIcon, HangerIcon, HeartIcon, LayersIcon, PersonIcon, SuitcaseIcon, SunIcon, type IconComponent } from "./components/icons";

/**
 * 앱의 모든 목적지를 한곳에서 정한다. 사이드바(태블릿·데스크톱), 하단 탭 바(모바일), "더보기" 화면이 모두 이 목록으로 그려진다.
 *
 * 새 화면을 붙일 때:
 *   1) src/pages/ 에 화면을 만들고 src/App.tsx 의 routes 에 경로를 추가한다.
 *   2) 아래에서 해당 항목의 enabled 를 true 로 바꾼다.
 * enabled 가 false 인 항목은 어디에도 나타나지 않는다 (죽은 링크 없음).
 */
export interface NavItem {
  id: string;
  /** 경로 */
  to: string;
  /** 사이드바·더보기에 쓰는 이름 */
  label: string;
  /** 탭 바용 짧은 이름 (없으면 label) */
  tabLabel?: string;
  /** 더보기 화면의 한 줄 설명 */
  description: string;
  icon: IconComponent;
  /** 경로가 정확히 일치할 때만 활성 (홈) */
  end?: boolean;
  /** 모바일 탭 바에 직접 놓을지(tab), "더보기" 안에 넣을지(more). 탭은 최대 4개 + 더보기. */
  mobile: "tab" | "more";
  /** 사이드바에서의 위치: 위쪽 주 메뉴(main) 또는 아래쪽(footer) */
  group: "main" | "footer";
  /** 화면이 실제로 있는지. false 면 숨김 */
  enabled: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "today", to: "/", label: "오늘", description: "날씨와 오늘의 코디 추천", icon: SunIcon, end: true, mobile: "tab", group: "main", enabled: true },
  { id: "closet", to: "/closet", label: "옷장", description: "내 옷과 착용 기록", icon: HangerIcon, mobile: "tab", group: "main", enabled: true },
  // 화면 위쪽 "저장한 코디 | OOTD 캘린더" 세그먼트로 /outfits ↔ /outfits/calendar
  { id: "outfits", to: "/outfits", label: "코디", description: "저장한 코디와 OOTD 캘린더", icon: LayersIcon, mobile: "tab", group: "main", enabled: true },
  { id: "inspo", to: "/inspo", label: "스크랩", description: "마음에 든 코디 사진", icon: BookmarkIcon, mobile: "tab", group: "main", enabled: true },
  { id: "wishlist", to: "/wishlist", label: "위시리스트", tabLabel: "위시", description: "사고 싶은 옷과 살까 말까", icon: HeartIcon, mobile: "more", group: "main", enabled: true },
  { id: "travel", to: "/travel", label: "여행", description: "날씨 맞춤 캡슐 옷장과 짐 체크리스트", icon: SuitcaseIcon, mobile: "more", group: "main", enabled: true },
  { id: "profile", to: "/profile", label: "프로필", description: "퍼스널 컬러 · 체형 · 마네킹 · 가상 피팅", icon: PersonIcon, mobile: "more", group: "footer", enabled: true },
  { id: "settings", to: "/settings", label: "설정", description: "화면, 날씨 위치, 단축어, 연결 상태", icon: GearIcon, mobile: "more", group: "footer", enabled: true },
];

/** 모바일 "더보기" 화면 경로 */
export const MORE_PATH = "/more";

export const enabledNav = () => NAV_ITEMS.filter((n) => n.enabled);
export const tabNav = () => enabledNav().filter((n) => n.mobile === "tab");
export const moreNav = () => enabledNav().filter((n) => n.mobile === "more");

export function isNavActive(item: Pick<NavItem, "to" | "end">, pathname: string): boolean {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
}
