import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { CATEGORY_LABEL, type Inspiration } from "../../shared/types";
import { BookmarkIcon, ChevronRightIcon, ExternalIcon, RefreshIcon, SparkIcon, TrashIcon } from "../components/icons";
import { ItemImage } from "../components/items";
import { Badge, Button, Card, Empty, Eyebrow, IconButton, Img, Notice, Page, Skeleton, SkeletonText, confirmDialog, toast } from "../components/ui";
import { api, imageUrl } from "../lib/api";
import { createOutfit, useItems } from "../lib/items";
import { mutateQuery, useQuery } from "../lib/query";
import { AppLink, useGoBack, useNav } from "../lib/router";

const LIST_PATH = "/inspirations";

export default function InspirationDetail() {
  const { id } = useParams();
  const nav = useNav();
  const goBack = useGoBack();
  const { byId } = useItems();
  const list = useQuery<Inspiration[]>(LIST_PATH);
  const insp = list.data?.find((i) => i.id === id) ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ratio, setRatio] = useState("4 / 5");
  const autoTried = useRef<string | null>(null);

  const update = useCallback((next: Inspiration) => mutateQuery<Inspiration[]>(LIST_PATH, (cur) => cur?.map((i) => (i.id === next.id ? next : i))), []);

  const analyze = useCallback(
    async (force = false) => {
      setBusy("analyze");
      setErr(null);
      try {
        update(await api<Inspiration>(`/inspirations/${id}/analyze${force ? "?force=true" : ""}`, { method: "POST" }));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [id, update],
  );

  const needsAnalysis = !!insp && !insp.analysis;
  useEffect(() => {
    // 처음 열었을 때 분석 결과가 없으면 한 번만 자동으로 분석 (결과는 서버에 저장되어 다시 호출하지 않음)
    if (!needsAnalysis || !id || autoTried.current === id) return;
    autoTried.current = id;
    void analyze();
  }, [needsAnalysis, id, analyze]);

  if (!insp)
    return (
      <Page title="스크랩한 코디" back="/inspo">
        {list.loading ? (
          <div className="grid gap-8 md:grid-cols-[minmax(0,360px)_1fr]">
            <Skeleton className="rounded-lg" style={{ aspectRatio: "4 / 5" }} />
            <SkeletonText lines={5} />
          </div>
        ) : list.error ? (
          <Notice title="스크랩을 불러오지 못했어요">{list.error}</Notice>
        ) : (
          <Empty icon={<BookmarkIcon size={26} />} title="사진을 찾을 수 없어요" action={<Button onClick={() => goBack("/inspo")}>스크랩으로</Button>}>
            삭제되었거나 주소가 잘못되었어요.
          </Empty>
        )}
      </Page>
    );

  const pieces = insp.analysis?.pieces ?? [];

  const addWish = async (index: number) => {
    setBusy(`wish-${index}`);
    try {
      const { wishlist_id } = await api<{ wishlist_id: string }>(`/inspirations/${insp.id}/pieces/${index}/wishlist`, { method: "POST" });
      const next = structuredClone(insp);
      if (next.analysis) next.analysis.pieces[index].wishlist_id = wishlist_id;
      update(next);
      mutateQuery("/wishlist", () => undefined);
      toast("위시리스트에 추가했어요", { action: { label: "보기", onClick: () => nav(`/wishlist/${wishlist_id}`) } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyLook = async () => {
    const ids = pieces.map((p) => p.matched_item_ids[0]).filter((x): x is string => !!x && byId.has(x));
    if (ids.length < 2) {
      toast("내 옷장에서 비슷한 옷을 2벌 이상 찾지 못했어요");
      return;
    }
    setBusy("copy");
    try {
      const o = await createOutfit({ name: "스크랩 따라 입기", item_ids: [...new Set(ids)], source: "reference", reason: insp.analysis?.summary });
      nav(`/outfits/${o.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "이 사진을 삭제할까요?", message: "분석 결과도 함께 사라져요.", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/inspirations/${insp.id}`, { method: "DELETE" });
      goBack("/inspo");
      mutateQuery<Inspiration[]>(LIST_PATH, (cur) => cur?.filter((i) => i.id !== insp.id));
      toast("삭제했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Page
      title="스크랩한 코디"
      back="/inspo"
      right={
        <IconButton label="사진 삭제" className="text-danger" onClick={remove}>
          <TrashIcon size={20} />
        </IconButton>
      }
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-12">
        <div className="md:sticky md:top-[calc(var(--safe-top)+var(--bar-h)+8px)] md:self-start">
          <Img src={imageUrl(insp.image_key)} ratio={ratio} loading="eager" className="rounded-lg" onNaturalSize={(w, h) => setRatio(`${w} / ${h}`)} />
          {insp.source_url && (
            <a href={insp.source_url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1.5 text-footnote text-muted hover:text-ink">
              <ExternalIcon size={15} className="shrink-0" />
              <span className="truncate">{insp.source_url.replace(/^https?:\/\/(www\.)?/, "")}</span>
            </a>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {busy === "analyze" ? (
            <div role="status" className="space-y-4">
              <p className="flex items-center gap-2 text-subhead font-medium text-muted">
                <SparkIcon size={18} /> AI가 사진 속 옷을 하나씩 나눠 보는 중이에요
              </p>
              <SkeletonText lines={2} />
              {[0, 1, 2].map((i) => (
                <Card key={i}>
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="mt-2 h-5 w-2/3" />
                  <Skeleton className="mt-4 h-11 rounded-full" />
                </Card>
              ))}
            </div>
          ) : !insp.analysis ? (
            err ? (
              <Notice
                title="AI 분석을 하지 못했어요"
                action={
                  <Button size="sm" icon={<RefreshIcon size={16} />} onClick={() => analyze()}>
                    다시 시도
                  </Button>
                }
              >
                {err}
              </Notice>
            ) : (
              <Empty
                icon={<SparkIcon size={26} />}
                title="아직 분석하지 않았어요"
                className="py-10 md:py-14"
                action={
                  <Button variant="primary" icon={<SparkIcon size={18} />} onClick={() => analyze()}>
                    AI로 분석하기
                  </Button>
                }
              >
                사진 속 옷을 하나씩 나눠서 내 옷장의 비슷한 옷을 찾아 드려요.
              </Empty>
            )
          ) : (
            <>
              {err && <Notice title="다시 분석하지 못했어요">{err}</Notice>}
              <p className="max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">{insp.analysis.summary}</p>
              {pieces.map((p, i) => {
                const matched = p.matched_item_ids.filter((mid) => byId.has(mid));
                return (
                  <Card key={i}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Eyebrow>{CATEGORY_LABEL[p.category]}</Eyebrow>
                        <div className="mt-0.5 text-headline">{p.description}</div>
                        {p.colors.length > 0 && <div className="mt-0.5 text-subhead text-muted">{p.colors.join(", ")}</div>}
                      </div>
                      <Badge tone={matched.length > 0 ? "solid" : "neutral"}>{matched.length > 0 ? "비슷한 옷 있음" : "옷장에 없음"}</Badge>
                    </div>
                    {matched.length > 0 && (
                      <div className="scroll-x mt-4 gap-2.5">
                        {matched.map((mid) => (
                          <AppLink key={mid} to={`/closet/${mid}`} className="pressable-soft w-[72px] shrink-0 rounded-sm">
                            <ItemImage item={byId.get(mid)} showName={false} className="rounded-sm" />
                            <div className="mt-1 truncate text-caption text-muted">{byId.get(mid)?.name}</div>
                          </AppLink>
                        ))}
                      </div>
                    )}
                    <div className="mt-4">
                      {p.wishlist_id ? (
                        <AppLink to={`/wishlist/${p.wishlist_id}`} className="inline-flex items-center gap-0.5 rounded-sm text-subhead font-semibold hover:underline">
                          위시리스트에 있어요 <ChevronRightIcon size={15} />
                        </AppLink>
                      ) : (
                        <Button block onClick={() => addWish(i)} loading={busy === `wish-${i}`} disabled={!!busy}>
                          위시리스트에 추가
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
              <div className="flex gap-2 pt-2">
                <Button variant="primary" size="lg" className="flex-1" onClick={copyLook} loading={busy === "copy"} disabled={!!busy}>
                  내 옷으로 따라 입기
                </Button>
                <Button size="lg" icon={<RefreshIcon size={18} />} onClick={() => analyze(true)} disabled={!!busy}>
                  다시 분석
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
