import { useState } from "react";
import { useParams } from "react-router";
import { CATEGORIES, CATEGORY_LABEL, type WishlistItemV2 } from "../../shared/types";
import { ChevronRightIcon, ExternalIcon, HeartIcon, TrashIcon } from "../components/icons";
import { ITEM_RATIO } from "../components/items";
import { Button, Chip, ChipRow, CommitInput, Empty, Field, IconButton, Img, Notice, Page, Skeleton, SkeletonText, buttonClass, confirmDialog, promptDialog, toast } from "../components/ui";
import { api, imageUrl, won } from "../lib/api";
import { ITEMS_PATH, linkError } from "../lib/items";
import { mutateQuery, revalidate, useQuery } from "../lib/query";
import { AppLink, useGoBack, useNav } from "../lib/router";
import { ShoppingLinks, Validator } from "./wish/WishInsights";

type WishlistItem = WishlistItemV2;
const WISH_PATH = "/wishlist";
const STATUS_LABEL: Record<WishlistItem["status"], string> = { wanted: "사고 싶어요", bought: "샀어요", dropped: "관심 없음" };

export default function WishDetail() {
  const { id } = useParams();
  return <WishDetailView key={id} id={id!} />;
}

function WishDetailView({ id }: { id: string }) {
  const nav = useNav();
  const goBack = useGoBack();
  const list = useQuery<WishlistItem[]>(WISH_PATH);
  const w = list.data?.find((x) => x.id === id) ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!w)
    return (
      <Page title="위시리스트" back="/wishlist">
        {list.loading ? (
          <div className="grid gap-8 md:grid-cols-[minmax(0,300px)_1fr]">
            <Skeleton className="rounded-lg" style={{ aspectRatio: ITEM_RATIO }} />
            <SkeletonText lines={5} />
          </div>
        ) : list.error ? (
          <Notice title="위시리스트를 불러오지 못했어요">{list.error}</Notice>
        ) : (
          <Empty icon={<HeartIcon size={26} />} title="옷을 찾을 수 없어요" action={<Button onClick={() => goBack("/wishlist")}>위시리스트로</Button>}>
            삭제되었거나 주소가 잘못되었어요.
          </Empty>
        )}
      </Page>
    );

  const img = imageUrl(w.image_key) ?? w.image_url;
  const setLocal = (next: WishlistItem) => mutateQuery<WishlistItem[]>(WISH_PATH, (cur) => cur?.map((x) => (x.id === next.id ? next : x)));

  /** 화면을 먼저 바꾸고 저장한다. 실패하면 되돌린다. */
  const patch = async (body: Partial<WishlistItem>) => {
    const before = w;
    setErr(null);
    setLocal({ ...w, ...body });
    try {
      setLocal(await api<WishlistItem>(`/wishlist/${w.id}`, { method: "PATCH", json: body }));
    } catch (e) {
      setLocal(before);
      setErr((e as Error).message);
    }
  };

  const bought = async () => {
    const input = await promptDialog({
      title: "얼마에 샀나요?",
      message: "모르면 비워 둬도 돼요. 옷장에서 1회당 가격을 계산할 때 써요.",
      defaultValue: w.estimated_price ? String(w.estimated_price) : "",
      placeholder: "가격 (원)",
      inputMode: "numeric",
      allowEmpty: true,
      confirmLabel: "옷장으로",
    });
    if (input === null) return;
    const price = input.replace(/\D/g, "");
    setBusy("bought");
    try {
      const r = await api<{ item_id: string }>(`/wishlist/${w.id}/bought`, { method: "POST", json: { purchase_price: price ? Number(price) : null } });
      await Promise.all([revalidate(ITEMS_PATH), revalidate(WISH_PATH)]);
      toast("옷장으로 옮겼어요. 정보를 확인해 주세요");
      nav(`/closet/${r.item_id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "위시리스트에서 삭제할까요?", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/wishlist/${w.id}`, { method: "DELETE" });
      goBack("/wishlist");
      mutateQuery<WishlistItem[]>(WISH_PATH, (cur) => cur?.filter((x) => x.id !== w.id));
      toast("삭제했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Page
      title={w.name}
      eyebrow={`${STATUS_LABEL[w.status]} · ${w.estimated_price != null ? won(w.estimated_price) : "가격 미정"}`}
      back="/wishlist"
      large
      right={
        <IconButton label="위시리스트에서 삭제" className="text-danger" onClick={remove}>
          <TrashIcon size={20} />
        </IconButton>
      }
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-12">
        <div className="md:sticky md:top-[calc(var(--safe-top)+var(--bar-h)+8px)] md:self-start">
          <Img
            src={img}
            ratio={ITEM_RATIO}
            loading="eager"
            className="mx-auto w-full max-w-[280px] rounded-lg md:max-w-none"
            fallback={
              <div className="flex flex-col items-center gap-2 text-footnote text-muted">
                <HeartIcon size={32} strokeWidth={1.3} />
                사진이 없어요
              </div>
            }
          />
          <div className="mt-4 space-y-2">
            {w.shop_url && (
              <a href={w.shop_url} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", block: true })}>
                <ExternalIcon size={18} /> 쇼핑몰에서 보기
              </a>
            )}
            {w.reference_id && (
              <AppLink to={`/inspo/${w.reference_id}`} className="flex items-center justify-center gap-0.5 rounded-sm py-2 text-subhead font-medium text-muted hover:text-ink">
                스크랩한 원본 코디 보기 <ChevronRightIcon size={15} />
              </AppLink>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-8">
          <section className="space-y-5">
            <Field label="이름">
              <CommitInput key={w.name} defaultValue={w.name} enterKeyHint="done" onCommit={(v) => v.trim() && v.trim() !== w.name && patch({ name: v.trim() })} />
            </Field>
            <Field label="카테고리" group>
              <ChipRow wrap>
                {CATEGORIES.map((c) => (
                  <Chip key={c} active={w.category === c} onClick={() => patch({ category: c })}>
                    {CATEGORY_LABEL[c]}
                  </Chip>
                ))}
              </ChipRow>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
              <Field label="예상 가격 (원)">
                <CommitInput
                  key={w.estimated_price ?? "none"}
                  inputMode="numeric"
                  enterKeyHint="done"
                  className="tabular"
                  defaultValue={w.estimated_price != null ? w.estimated_price.toLocaleString("ko-KR") : ""}
                  placeholder="0"
                  onCommit={(raw) => {
                    const v = raw.replace(/\D/g, "");
                    const next = v ? Number(v) : null;
                    if (next !== w.estimated_price) void patch({ estimated_price: next });
                  }}
                />
              </Field>
              <Field label="쇼핑몰 링크">
                <CommitInput key={w.shop_url ?? ""} defaultValue={w.shop_url ?? ""} inputMode="url" enterKeyHint="done" autoCapitalize="none" autoCorrect="off" placeholder="https://" onCommit={(v) => {
                    if (v.trim() === (w.shop_url ?? "")) return;
                    const bad = linkError(v, "쇼핑몰 링크");
                    if (bad) setErr(bad);
                    else void patch({ shop_url: v.trim() || null });
                  }} />
              </Field>
            </div>
            <p className="text-footnote text-muted">고친 내용은 칸을 벗어나면 바로 저장돼요.</p>
            <Notice>{err}</Notice>
          </section>

          <Validator wish={w} image={img} onUpdate={setLocal} />
          <ShoppingLinks wish={w} onUpdate={setLocal} />

          <div className="flex flex-wrap gap-2 md:max-w-md">
            {w.status === "wanted" ? (
              <>
                <Button variant="primary" size="lg" className="flex-1" onClick={bought} loading={busy === "bought"} disabled={!!busy}>
                  샀어요
                </Button>
                <Button size="lg" onClick={() => patch({ status: "dropped" })} disabled={!!busy}>
                  관심 없어졌어요
                </Button>
              </>
            ) : w.status === "bought" && w.bought_item_id ? (
              <AppLink to={`/closet/${w.bought_item_id}`} className={buttonClass({ variant: "primary", size: "lg", className: "flex-1" })}>
                옷장에서 보기
              </AppLink>
            ) : (
              <Button size="lg" className="flex-1" onClick={() => patch({ status: "wanted" })}>
                다시 사고 싶어요
              </Button>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
