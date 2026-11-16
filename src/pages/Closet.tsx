import { useDeferredValue, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router";
import type { Category, Item } from "../../shared/types";
import { ChevronDownIcon, HangerIcon, PlusIcon } from "../components/icons";
import { CategoryFilter, ItemCard, countByCategory } from "../components/items";
import { Button, ButtonLink, Empty, Notice, Page, SearchInput, SkeletonGrid } from "../components/ui";
import { useIsWide } from "../lib/hooks";
import { cpw, useItems } from "../lib/items";
import { AppLink } from "../lib/router";
import { iconButtonClass } from "../components/Button";

type Sort = "new" | "most" | "least" | "cpw";
const SORTS: [Sort, string][] = [
  ["new", "최근 등록순"],
  ["most", "많이 입은 순"],
  ["least", "안 입은 순 (장롱템)"],
  ["cpw", "회당 가격 높은 순"],
];

const GRID = "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(156px,1fr))] md:gap-x-4 md:gap-y-8";

function sortItems(list: Item[], sort: Sort): Item[] {
  if (sort === "most") return [...list].sort((a, b) => b.wear_count - a.wear_count);
  if (sort === "least") return [...list].sort((a, b) => a.wear_count - b.wear_count || (a.last_worn_date ?? "").localeCompare(b.last_worn_date ?? ""));
  if (sort === "cpw") return [...list].sort((a, b) => (cpw(b) ?? -1) - (cpw(a) ?? -1));
  return list;
}

/**
 * 옷장. 분할 보기의 본보기 화면:
 * - 모바일: 목록 ↔ 상세가 화면 전체로 바뀐다.
 * - 태블릿·데스크톱: 왼쪽 목록은 그대로 두고 오른쪽 패널에 상세(자식 경로)가 열린다.
 */
export default function Closet() {
  const { items, loading, error, reload } = useItems();
  const { pathname } = useLocation();
  const wide = useIsWide();
  const [cat, setCat] = useState<Category | "all">("all");
  const [sort, setSort] = useState<Sort>("new");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query).trim().toLowerCase();

  const detailOpen = pathname.replace(/\/+$/, "") !== "/closet";
  const selectedId = detailOpen ? pathname.split("/")[2] : null;

  const counts = useMemo(() => countByCategory(items), [items]);
  const shown = useMemo(() => {
    const list = items.filter(
      (i) => (cat === "all" || i.category === cat) && (!q || [i.name, i.brand, i.sub_category, ...i.colors, ...i.style_tags].some((t) => t?.toLowerCase().includes(q))),
    );
    return sortItems(list, sort);
  }, [items, cat, sort, q]);

  const filtering = cat !== "all" || q !== "";

  return (
    <div className="md:flex">
      <div className={`min-w-0 flex-1 ${detailOpen ? "hidden md:block" : ""}`}>
        <Page
          title="옷장"
          eyebrow={items.length > 0 ? `${items.length}벌` : undefined}
          width="wide"
          right={
            <AppLink to="/closet/new" preventScrollReset={wide} aria-label="옷 등록" title="옷 등록" className={iconButtonClass("primary")}>
              <PlusIcon size={20} />
            </AppLink>
          }
        >
          {loading ? (
            <SkeletonGrid className={`${GRID} mt-2`} count={10} />
          ) : error && items.length === 0 ? (
            <Notice
              title="옷장을 불러오지 못했어요"
              action={
                <Button size="sm" onClick={reload}>
                  다시 시도
                </Button>
              }
            >
              {error}
            </Notice>
          ) : items.length === 0 ? (
            <Empty
              icon={<HangerIcon size={26} />}
              title="옷장이 비어 있어요"
              action={
                <ButtonLink to="/closet/new" variant="primary" icon={<PlusIcon size={18} />}>
                  첫 옷 등록하기
                </ButtonLink>
              }
            >
              사진을 올리거나 쇼핑몰 링크를 붙여 넣으면 정보를 채워 드려요.
            </Empty>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <SearchInput className="min-w-0 flex-1 md:max-w-xs" placeholder="이름, 브랜드, 색으로 찾기" aria-label="옷 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
                <label className="relative ml-auto flex h-11 shrink-0 items-center gap-1 rounded-full bg-surface-2 pr-3 pl-4 text-subhead font-medium text-ink-2 hover:bg-surface-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--focus)">
                  <span>{SORTS.find(([k]) => k === sort)?.[1].replace(/ \(.*\)/, "")}</span>
                  <ChevronDownIcon size={15} />
                  <select aria-label="정렬" className="absolute inset-0 cursor-pointer opacity-0" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    {SORTS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 mb-5">
                <CategoryFilter value={cat} onChange={setCat} counts={counts} />
              </div>
              {shown.length === 0 ? (
                <Empty
                  title="조건에 맞는 옷이 없어요"
                  action={
                    filtering && (
                      <Button
                        onClick={() => {
                          setCat("all");
                          setQuery("");
                        }}
                      >
                        필터 지우기
                      </Button>
                    )
                  }
                >
                  검색어나 카테고리를 바꿔 보세요.
                </Empty>
              ) : (
                <div className={GRID}>
                  {shown.map((i) => (
                    <ItemCard key={i.id} item={i} to={`/closet/${i.id}`} selected={i.id === selectedId} preventScrollReset={wide} />
                  ))}
                </div>
              )}
            </>
          )}
        </Page>
      </div>
      {detailOpen && (
        <aside
          aria-label="옷 정보"
          className="thin-scrollbar min-w-0 md:sticky md:top-0 md:h-dvh md:w-[clamp(340px,40vw,460px)] md:shrink-0 md:overflow-y-auto md:overscroll-contain md:bg-bg md:shadow-[-0.5px_0_0_0_var(--line-strong)] md:[--gutter:24px]"
        >
          <Outlet />
        </aside>
      )}
    </div>
  );
}
