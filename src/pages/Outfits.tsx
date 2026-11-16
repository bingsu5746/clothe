import { useState } from "react";
import type { Outfit } from "../../shared/types";
import { LayersIcon, PlusIcon } from "../components/icons";
import { OutfitsTabs } from "../components/OutfitsTabs";
import { ItemPicker, OutfitCollage } from "../components/items";
import { Button, ButtonLink, Card, Empty, IconButton, Notice, Page, Skeleton, promptDialog, toast } from "../components/ui";
import { createOutfit, useItems, useOutfits } from "../lib/items";
import { AppLink, useNav } from "../lib/router";

const SOURCE_LABEL: Record<Outfit["source"], string> = { ai: "AI 추천", manual: "직접 만듦", reference: "스크랩에서" };
const GRID = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

export default function Outfits() {
  const { data, loading, error, reload } = useOutfits();
  const { items } = useItems();
  const [picking, setPicking] = useState(false);
  const nav = useNav();

  const create = async (ids: string[]) => {
    setPicking(false);
    if (!ids.length) return;
    const name = await promptDialog({ title: "코디 이름", defaultValue: "내 코디", confirmLabel: "저장" });
    if (name === null) return;
    try {
      const o = await createOutfit({ name: name || "내 코디", item_ids: ids });
      toast("코디를 저장했어요");
      nav(`/outfits/${o.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Page
      title="코디"
      eyebrow={data?.length ? `${data.length}개` : undefined}
      right={
        <IconButton label="코디 만들기" variant="primary" onClick={() => setPicking(true)}>
          <PlusIcon size={20} />
        </IconButton>
      }
    >
      <OutfitsTabs value="saved" />
      {loading ? (
        <div className={GRID} role="status" aria-label="불러오는 중">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="mt-2 h-3.5 w-1/4" />
              <div className="mt-4 grid grid-cols-4 gap-1.5">
                {[0, 1, 2, 3].map((j) => (
                  <Skeleton key={j} className="aspect-[3/4]" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : error && !data ? (
        <Notice
          title="코디를 불러오지 못했어요"
          action={
            <Button size="sm" onClick={reload}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      ) : !data?.length ? (
        <Empty
          icon={<LayersIcon size={26} />}
          title="저장한 코디가 없어요"
          action={
            items.length > 0 ? (
              <Button variant="primary" icon={<PlusIcon size={18} />} onClick={() => setPicking(true)}>
                코디 만들기
              </Button>
            ) : (
              <ButtonLink to="/closet/new" variant="primary" icon={<PlusIcon size={18} />}>
                먼저 옷 등록하기
              </ButtonLink>
            )
          }
        >
          옷장에서 옷을 골라 직접 조합하거나, 오늘 탭에서 추천받은 코디를 저장해 보세요.
        </Empty>
      ) : (
        <div className={GRID}>
          {data.map((o) => {
            const pending = o.id.startsWith("temp-");
            return (
              <AppLink key={o.id} to={`/outfits/${o.id}`} aria-disabled={pending} className={`pressable-soft block rounded-lg ${pending ? "pointer-events-none opacity-60" : ""}`}>
                <Card className="h-full transition-shadow duration-(--dur-base) hover:shadow-[0_0_0_1px_var(--line-strong)]">
                  <h3 className="truncate text-headline">{o.name}</h3>
                  <p className="mb-4 text-footnote text-muted">
                    {SOURCE_LABEL[o.source]} · {o.item_ids.length}벌
                  </p>
                  <OutfitCollage ids={o.item_ids} />
                </Card>
              </AppLink>
            );
          })}
        </div>
      )}
      {picking && <ItemPicker open onClose={() => setPicking(false)} initial={[]} onDone={create} title="코디에 넣을 옷" doneLabel="로 코디 만들기" />}
    </Page>
  );
}
