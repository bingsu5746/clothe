import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Outfit } from "../../shared/types";
import { PlusIcon } from "../components/icons";
import { ItemPicker, OutfitCollage } from "../components/items";
import { Card, Empty, PageHeader, Spinner, toast } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/items";

const SOURCE_LABEL: Record<Outfit["source"], string> = { ai: "AI 추천", manual: "직접 만듦", reference: "스크랩에서" };

export default function Outfits() {
  const { data, loading } = useFetch<Outfit[]>("/outfits");
  const [picking, setPicking] = useState(false);
  const nav = useNavigate();

  const create = async (ids: string[]) => {
    setPicking(false);
    if (!ids.length) return;
    const name = prompt("코디 이름", "내 코디") ?? "내 코디";
    const o = await api<Outfit>("/outfits", { method: "POST", json: { name, item_ids: ids } });
    toast("코디를 저장했어요");
    nav(`/outfits/${o.id}`);
  };

  return (
    <>
      <PageHeader
        title="저장한 코디"
        right={
          <button onClick={() => setPicking(true)} className="flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            <PlusIcon width={18} height={18} /> 만들기
          </button>
        }
      />
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty title="저장한 코디가 없어요">오늘 탭에서 AI 추천을 저장하거나, 위의 만들기로 직접 조합해 보세요.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((o) => (
            <Link key={o.id} to={`/outfits/${o.id}`}>
              <Card>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="truncate font-bold">{o.name}</h3>
                  <span className="shrink-0 text-xs text-muted">{SOURCE_LABEL[o.source]}</span>
                </div>
                <OutfitCollage ids={o.item_ids} />
              </Card>
            </Link>
          ))}
        </div>
      )}
      {picking && <ItemPicker open onClose={() => setPicking(false)} initial={[]} onDone={create} title="코디에 넣을 옷 고르기" />}
    </>
  );
}
