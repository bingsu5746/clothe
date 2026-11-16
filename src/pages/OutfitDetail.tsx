import { useState } from "react";
import { useParams } from "react-router";
import { CATEGORY_LABEL, type Item, type Outfit } from "../../shared/types";
import { LayersIcon, PencilIcon, TrashIcon } from "../components/icons";
import { ItemImage, ItemPicker } from "../components/items";
import { Button, Empty, Eyebrow, IconButton, Notice, Page, SkeletonGrid, confirmDialog, promptDialog, toast } from "../components/ui";
import { api } from "../lib/api";
import { OUTFITS_PATH, useItems, useOutfits, wearItems } from "../lib/items";
import { mutateQuery, optimistic } from "../lib/query";
import { AppLink, useGoBack } from "../lib/router";

const SOURCE_LABEL: Record<Outfit["source"], string> = { ai: "AI 추천", manual: "직접 만듦", reference: "스크랩에서" };
const GRID = "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-4 xl:grid-cols-5";

export default function OutfitDetail() {
  const { id } = useParams();
  const goBack = useGoBack();
  const { byId } = useItems();
  const { data: list, loading, error, reload } = useOutfits();
  const [editing, setEditing] = useState(false);
  const outfit = list?.find((o) => o.id === id);

  if (!outfit)
    return (
      <Page title="코디" back="/outfits">
        {loading ? (
          <SkeletonGrid className={GRID} count={4} />
        ) : error ? (
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
        ) : (
          <Empty icon={<LayersIcon size={26} />} title="코디를 찾을 수 없어요" action={<Button onClick={() => goBack("/outfits")}>코디 목록으로</Button>}>
            삭제되었거나 주소가 잘못되었어요.
          </Empty>
        )}
      </Page>
    );

  const items = outfit.item_ids.map((x) => byId.get(x)).filter((x): x is Item => !!x);
  const missing = outfit.item_ids.length - items.length;

  /** 화면을 먼저 바꾸고 서버에 보낸다. 실패하면 되돌린다. */
  const patch = async (body: Partial<Pick<Outfit, "name" | "item_ids">>) => {
    try {
      await optimistic<Outfit[], unknown>(
        OUTFITS_PATH,
        (cur) => cur?.map((o) => (o.id === outfit.id ? { ...o, ...body } : o)),
        () => api(`/outfits/${outfit.id}`, { method: "PATCH", json: body }),
        false,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const rename = async () => {
    const name = await promptDialog({ title: "코디 이름", defaultValue: outfit.name, confirmLabel: "변경" });
    if (name && name !== outfit.name) await patch({ name });
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "이 코디를 삭제할까요?", message: "옷장의 옷은 그대로 남아요.", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/outfits/${outfit.id}`, { method: "DELETE" });
      goBack("/outfits");
      mutateQuery<Outfit[]>(OUTFITS_PATH, (cur) => cur?.filter((o) => o.id !== outfit.id));
      toast("삭제했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const wear = async () => {
    try {
      await wearItems(outfit.item_ids, { outfit_id: outfit.id });
      toast("오늘 입은 걸로 기록했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Page
      title={outfit.name}
      eyebrow={`${SOURCE_LABEL[outfit.source]} · ${outfit.item_ids.length}벌`}
      back="/outfits"
      large
      right={
        <>
          <IconButton label="이름 변경" onClick={rename}>
            <PencilIcon size={20} />
          </IconButton>
          <IconButton label="코디 삭제" className="text-danger" onClick={remove}>
            <TrashIcon size={20} />
          </IconButton>
        </>
      }
    >
      {outfit.reason && <p className="mb-6 max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2 md:mb-8">{outfit.reason}</p>}

      {items.length === 0 ? (
        <Empty title="이 코디의 옷이 모두 삭제되었어요" action={<Button onClick={() => setEditing(true)}>옷 다시 고르기</Button>} />
      ) : (
        <div className={GRID}>
          {items.map((i) => (
            <AppLink key={i.id} to={`/closet/${i.id}`} className="pressable-soft block min-w-0 rounded-md">
              <ItemImage item={i} showName={false} />
              <div className="px-0.5 pt-2.5">
                <Eyebrow>{CATEGORY_LABEL[i.category]}</Eyebrow>
                <div className="truncate text-subhead font-medium">{i.name}</div>
              </div>
            </AppLink>
          ))}
        </div>
      )}
      {missing > 0 && items.length > 0 && <p className="mt-4 text-footnote text-muted">삭제된 옷 {missing}벌은 표시하지 않았어요.</p>}

      <div className="mt-8 flex flex-wrap gap-2 md:max-w-md">
        <Button variant="primary" size="lg" className="flex-1" onClick={wear} disabled={items.length === 0}>
          오늘 입을래요
        </Button>
        <Button size="lg" onClick={() => setEditing(true)}>
          옷 바꾸기
        </Button>
      </div>

      {editing && (
        <ItemPicker
          open
          onClose={() => setEditing(false)}
          initial={items.map((i) => i.id)}
          doneLabel="으로 바꾸기"
          onDone={(ids) => {
            setEditing(false);
            void patch({ item_ids: ids });
          }}
        />
      )}
    </Page>
  );
}
