import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Category } from "../../shared/types";
import { PlusIcon } from "../components/icons";
import { CategoryFilter, ItemImage, cpw } from "../components/items";
import { Chip, Empty, PageHeader, Spinner } from "../components/ui";
import { won } from "../lib/api";
import { useItems } from "../lib/items";

type Sort = "new" | "most" | "least" | "cpw";

export default function Closet() {
  const { items, loading } = useItems();
  const [cat, setCat] = useState<Category | "all">("all");
  const [sort, setSort] = useState<Sort>("new");
  const counts = useMemo(() => {
    const m: Partial<Record<Category, number>> = {};
    items.forEach((i) => (m[i.category] = (m[i.category] ?? 0) + 1));
    return m;
  }, [items]);
  const shown = useMemo(() => {
    const list = items.filter((i) => cat === "all" || i.category === cat);
    if (sort === "most") return [...list].sort((a, b) => b.wear_count - a.wear_count);
    if (sort === "least") return [...list].sort((a, b) => a.wear_count - b.wear_count || (a.last_worn_date ?? "").localeCompare(b.last_worn_date ?? ""));
    if (sort === "cpw") return [...list].sort((a, b) => (cpw(b) ?? -1) - (cpw(a) ?? -1));
    return list;
  }, [items, cat, sort]);

  return (
    <>
      <PageHeader
        title={`옷장 ${items.length ? items.length : ""}`}
        right={
          <Link to="/closet/new" className="flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            <PlusIcon width={18} height={18} /> 추가
          </Link>
        }
      />
      <CategoryFilter value={cat} onChange={setCat} counts={counts} />
      <div className="mt-2 mb-4 flex gap-2 overflow-x-auto text-sm">
        {(
          [
            ["new", "최근 등록"],
            ["most", "많이 입은"],
            ["least", "안 입은 (장롱템)"],
            ["cpw", "1회당 가격 높은"],
          ] as [Sort, string][]
        ).map(([k, l]) => (
          <Chip key={k} active={sort === k} onClick={() => setSort(k)}>
            {l}
          </Chip>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Empty title="옷장이 비어 있어요">
          <Link to="/closet/new" className="font-semibold text-accent underline">사진이나 쇼핑몰 링크로 첫 옷을 등록해 보세요</Link>
        </Empty>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {shown.map((i) => {
            const c = cpw(i);
            return (
              <Link key={i.id} to={`/closet/${i.id}`} className="min-w-0">
                <ItemImage item={i} className="aspect-[3/4]" />
                <div className="mt-1.5 truncate text-sm font-medium">{i.name}</div>
                <div className="truncate text-xs text-muted">
                  {i.wear_count}회 착용{c != null && ` · 회당 ${won(c)}`}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
