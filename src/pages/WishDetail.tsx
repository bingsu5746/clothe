import { useState } from "react";
import { useParams } from "react-router";
import { CATEGORIES, CATEGORY_LABEL, type SuggestedOutfit, type WishlistItem } from "../../shared/types";
import { ChevronRightIcon, ExternalIcon, HeartIcon, RefreshIcon, SparkIcon, TrashIcon } from "../components/icons";
import { ItemImage, ITEM_RATIO, OutfitCollage } from "../components/items";
import { Badge, Button, Card, Chip, ChipRow, Empty, Field, IconButton, Img, Input, Notice, Page, Section, Skeleton, SkeletonText, buttonClass, confirmDialog, promptDialog, toast } from "../components/ui";
import { api, imageUrl, won } from "../lib/api";
import { ITEMS_PATH, useItems } from "../lib/items";
import { mutateQuery, revalidate, useQuery } from "../lib/query";
import { AppLink, useGoBack, useNav } from "../lib/router";

interface Combos {
  verdict: string;
  similar_item_ids: string[];
  outfits: SuggestedOutfit[];
}

const WISH_PATH = "/wishlist";
const STATUS_LABEL: Record<WishlistItem["status"], string> = { wanted: "사고 싶어요", bought: "샀어요", dropped: "관심 없음" };

export default function WishDetail() {
  const { id } = useParams();
  return <WishDetailView key={id} id={id!} />;
}

function WishDetailView({ id }: { id: string }) {
  const nav = useNav();
  const goBack = useGoBack();
  const { byId } = useItems();
  const list = useQuery<WishlistItem[]>(WISH_PATH);
  const w = list.data?.find((x) => x.id === id) ?? null;
  const [combos, setCombos] = useState<Combos | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

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

  const loadCombos = async (force = false) => {
    setBusy("combos");
    setAiErr(null);
    try {
      setCombos(await api<Combos>(`/wishlist/${w.id}/combos${force ? "?force=true" : ""}`, { method: "POST" }));
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setBusy(null);
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

  const newTile = (
    <div className="relative">
      <Img src={img} ratio={ITEM_RATIO} className="rounded-sm shadow-[0_0_0_1.5px_var(--ink)]" fallback={<HeartIcon size={18} className="text-faint" />} />
      <span className="absolute top-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none font-bold text-accent-ink">새 옷</span>
    </div>
  );

  return (
    <Page
      title={w.name}
      back="/wishlist"
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
              <div className="flex flex-col items-center gap-2 text-footnote text-faint">
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
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={w.status === "wanted" ? "solid" : "neutral"}>{STATUS_LABEL[w.status]}</Badge>
            </div>
            <h2 className="mt-3 text-title-1">{w.name}</h2>
            <div className="mt-1 text-title-2 text-ink-2 tabular">{w.estimated_price != null ? won(w.estimated_price) : "가격 미정"}</div>
          </div>

          <section className="space-y-5">
            <Field label="이름">
              <Input key={w.name} defaultValue={w.name} onBlur={(e) => e.target.value.trim() && e.target.value !== w.name && patch({ name: e.target.value.trim() })} />
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
              <Field label="예상 가격" hint="원">
                <Input
                  key={w.estimated_price ?? "none"}
                  inputMode="numeric"
                  className="tabular"
                  defaultValue={w.estimated_price != null ? w.estimated_price.toLocaleString("ko-KR") : ""}
                  placeholder="0"
                  onBlur={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    const next = v ? Number(v) : null;
                    if (next !== w.estimated_price) void patch({ estimated_price: next });
                  }}
                />
              </Field>
              <Field label="쇼핑몰 링크">
                <Input key={w.shop_url ?? ""} defaultValue={w.shop_url ?? ""} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://" onBlur={(e) => e.target.value !== (w.shop_url ?? "") && patch({ shop_url: e.target.value })} />
              </Field>
            </div>
            <p className="text-footnote text-faint">고친 내용은 칸을 벗어나면 바로 저장돼요.</p>
            <Notice>{err}</Notice>
          </section>

          <Section title="이걸 사면 만들 수 있는 코디" description="지금 내 옷장의 옷과 어떻게 어울리는지 AI가 확인해 줘요.">
            {busy === "combos" ? (
              <div role="status" aria-label="조합을 확인하는 중" className="space-y-4">
                <SkeletonText lines={2} />
                <div className="grid gap-3 sm:grid-cols-2">
                  {[0, 1].map((i) => (
                    <Card key={i}>
                      <Skeleton className="h-5 w-1/2" />
                      <div className="mt-3 grid grid-cols-4 gap-1.5">
                        {[0, 1, 2, 3].map((j) => (
                          <Skeleton key={j} className="aspect-[3/4]" />
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ) : !combos ? (
              <>
                {aiErr && (
                  <Notice className="mb-3" title="조합을 확인하지 못했어요">
                    {aiErr}
                  </Notice>
                )}
                <Button variant={aiErr ? "secondary" : "primary"} icon={<SparkIcon size={18} />} onClick={() => loadCombos()}>
                  {aiErr ? "다시 시도" : "조합 확인하기"}
                </Button>
              </>
            ) : (
              <div className="space-y-5">
                {aiErr && <Notice title="다시 확인하지 못했어요">{aiErr}</Notice>}
                <p className="max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">{combos.verdict}</p>
                {combos.similar_item_ids.some((sid) => byId.has(sid)) && (
                  <div>
                    <h3 className="mb-2 text-subhead font-semibold">옷장에 이미 비슷한 옷이 있어요</h3>
                    <div className="scroll-x gap-2.5">
                      {combos.similar_item_ids
                        .filter((sid) => byId.has(sid))
                        .map((sid) => (
                          <AppLink key={sid} to={`/closet/${sid}`} className="pressable-soft w-[72px] shrink-0 rounded-sm">
                            <ItemImage item={byId.get(sid)} showName={false} className="rounded-sm" />
                            <div className="mt-1 truncate text-caption text-muted">{byId.get(sid)?.name}</div>
                          </AppLink>
                        ))}
                    </div>
                  </div>
                )}
                <div>
                  <h3 className="mb-2 text-subhead font-semibold">새로 만들 수 있는 코디 {combos.outfits.length}개</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {combos.outfits.map((o, i) => (
                      <Card key={i}>
                        <div className="text-headline">{o.title}</div>
                        <p className="mt-1 mb-3 text-subhead text-muted">{o.reason}</p>
                        <OutfitCollage ids={o.item_ids.filter((x) => x !== "NEW")} extra={newTile} />
                      </Card>
                    ))}
                  </div>
                </div>
                <Button icon={<RefreshIcon size={18} />} onClick={() => loadCombos(true)}>
                  다시 확인
                </Button>
              </div>
            )}
          </Section>

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
