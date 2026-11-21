import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { CATEGORY_LABEL, type Item, type OotdAnalysis, type OutfitLog } from "../../shared/types";
import { CameraIcon, CheckIcon, ImageIcon, PlusIcon, RefreshIcon, SelfieIcon, SparkIcon } from "../components/icons";
import { ItemImage, ItemPicker, PhotoInput } from "../components/items";
import { Badge, Button, ButtonLink, Card, Eyebrow, Field, Img, Input, Notice, Page, Section, Skeleton, SkeletonText, Textarea, buttonClass, toast } from "../components/ui";
import { AiOffNotice } from "../components/AiStatus";
import { api, uploadImage } from "../lib/api";
import { todayKST, useItems } from "../lib/items";
import { Rating, TagEditor } from "../components/Rating";
import { OCCASIONS, addDays, applyLog } from "../lib/logs";
import { useNav } from "../lib/router";

type Phase = "pick" | "upload" | "analyze" | "review";

/**
 * OOTD 거울 셀카 기록: 사진 → AI가 옷장 옷과 맞춰 봄 → 확인·수정 → 착용 기록 (착용 횟수 +1)
 */
export default function OotdNew() {
  const nav = useNav();
  const [params] = useSearchParams();
  const { items, byId, loading: itemsLoading } = useItems();
  const today = todayKST();
  const [phase, setPhase] = useState<Phase>("pick");
  const [photo, setPhoto] = useState<{ url: string; blob: Blob } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<OotdAnalysis | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(() => {
    const d = params.get("date");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= addDays(today, 1) ? d : today;
  });
  const [rating, setRating] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const analyze = async (imageKey: string, force = false) => {
    setPhase("analyze");
    setAiErr(null);
    try {
      const a = await api<OotdAnalysis>("/ootd/analyze", { method: "POST", json: { image_key: imageKey, force } });
      setAnalysis(a);
      setSelected(a.suggested_item_ids.filter((id) => byId.has(id)));
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setPhase("review");
    }
  };

  const onPick = async (blob: Blob) => {
    setPhoto({ url: URL.createObjectURL(blob), blob });
    setAnalysis(null);
    setSelected([]);
    setKey(null);
    setErr(null);
    setAiErr(null);
    setPhase("upload");
    try {
      const k = await uploadImage(blob);
      setKey(k);
      await analyze(k);
    } catch (e) {
      setErr((e as Error).message);
      setPhase("pick");
      setPhoto(null);
    }
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const candidateIds = useMemo(() => new Set(analysis?.pieces.flatMap((p) => p.candidates.map((c) => c.item_id)) ?? []), [analysis]);
  const extras = selected.filter((id) => !candidateIds.has(id));

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const log = await api<OutfitLog & { duplicate: boolean }>("/logs", {
        method: "POST",
        json: { item_ids: selected, date, selfie_key: key, rating, occasion_tags: tags, note: note.trim() || null },
      });
      applyLog(log);
      toast(log.duplicate ? "그날 같은 조합 기록이 있어서 사진과 메모를 합쳤어요" : `${selected.length}벌 착용을 기록했어요`);
      nav(`/outfits/calendar?month=${log.worn_date.slice(0, 7)}&day=${log.worn_date}`, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!itemsLoading && items.length === 0)
    return (
      <Page title="OOTD 기록" back="/outfits/calendar">
        <Notice
          tone="info"
          action={
            <ButtonLink to="/closet/new" size="sm" variant="primary" icon={<PlusIcon size={16} />}>
              옷 등록하기
            </ButtonLink>
          }
        >
          셀카 속 옷을 내 옷장과 맞춰 보려면 먼저 옷장에 옷을 등록해 주세요.
        </Notice>
      </Page>
    );

  if (phase === "pick" || !photo)
    return (
      <Page title="OOTD 기록" back="/outfits/calendar" width="narrow">
        <AiOffNotice className="mx-auto mb-4 max-w-md" />
        <div className="mx-auto max-w-md pt-4 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-surface-2 text-ink-2">
            <SelfieIcon size={30} />
          </div>
          <h2 className="mt-5 text-title-2">거울 셀카 한 장이면 끝</h2>
          <p className="mt-2 text-callout text-muted">AI가 사진 속 옷을 내 옷장에서 찾아 주고, 확인하면 착용 횟수와 1회당 가격이 바로 바뀌어요.</p>
          <div className="mt-8 grid grid-cols-2 gap-2">
            <PhotoInput onPick={onPick} capture className={buttonClass({ variant: "primary", size: "lg" })}>
              <CameraIcon size={20} /> 찍기
            </PhotoInput>
            <PhotoInput onPick={onPick} className={buttonClass({ variant: "secondary", size: "lg" })}>
              <ImageIcon size={20} /> 사진 고르기
            </PhotoInput>
          </div>
          <Notice className="mt-4 text-left">{err}</Notice>
        </div>
      </Page>
    );

  const busy = phase === "upload" || phase === "analyze";

  return (
    <Page title="OOTD 기록" back="/outfits/calendar">
      <div className="grid gap-8 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-12">
        <div className="md:sticky md:top-[calc(var(--safe-top)+var(--bar-h)+8px)] md:self-start">
          <Img src={photo.url} ratio="3 / 4" loading="eager" className="mx-auto w-full max-w-[260px] rounded-lg md:max-w-none" alt="OOTD 셀카" />
          <PhotoInput onPick={onPick} disabled={busy || saving} className={buttonClass({ variant: "ghost", block: true, className: "mt-3" })}>
            <ImageIcon size={18} /> 다른 사진
          </PhotoInput>
        </div>

        <div className="min-w-0 space-y-8">
          {busy ? (
            <div role="status" className="space-y-4">
              <p className="flex items-center gap-2 text-subhead font-medium text-muted">
                <SparkIcon size={18} /> {phase === "upload" ? "사진을 올리는 중이에요" : "AI가 사진 속 옷을 내 옷장에서 찾는 중이에요"}
              </p>
              <SkeletonText lines={2} />
              {[0, 1, 2].map((i) => (
                <Card key={i}>
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="mt-2 h-5 w-1/2" />
                  <div className="mt-3 flex gap-2">
                    {[0, 1, 2].map((j) => (
                      <Skeleton key={j} className="aspect-[3/4] w-20 rounded-sm" />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <>
              {aiErr ? (
                <Notice
                  title="AI가 옷을 찾지 못했어요"
                  action={
                    <>
                      <Button size="sm" icon={<RefreshIcon size={16} />} onClick={() => key && analyze(key)}>
                        다시 시도
                      </Button>
                      <Button size="sm" onClick={() => setPicking(true)}>
                        직접 고르기
                      </Button>
                    </>
                  }
                >
                  {aiErr} 입은 옷을 직접 골라서 기록할 수도 있어요.
                </Notice>
              ) : analysis ? (
                <section className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">{analysis.summary}</p>
                    {analysis.verified && <Badge className="shrink-0">사진 대조 확인</Badge>}
                  </div>
                  <p className="text-footnote text-muted">확신이 높은 옷을 미리 골라 뒀어요. 맞지 않으면 눌러서 바꿔 주세요.</p>
                  {analysis.pieces.map((p, i) => {
                    const cands = p.candidates.filter((c) => byId.has(c.item_id));
                    return (
                      <Card key={i}>
                        <Eyebrow>{CATEGORY_LABEL[p.category]}</Eyebrow>
                        <div className="mt-0.5 text-headline">{p.description}</div>
                        {cands.length === 0 ? (
                          <p className="mt-2 text-subhead text-muted">옷장에서 비슷한 옷을 찾지 못했어요.</p>
                        ) : (
                          <div className="scroll-x mt-3 gap-2.5" role="group" aria-label={`${p.description} 후보`}>
                            {cands.map((c) => (
                              <CandidateTile key={c.item_id} item={byId.get(c.item_id)!} confidence={c.confidence} on={selected.includes(c.item_id)} onClick={() => toggle(c.item_id)} />
                            ))}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </section>
              ) : null}

              <Section
                title={`입은 옷 ${selected.length}벌`}
                action={
                  <Button size="sm" icon={<PlusIcon size={16} />} onClick={() => setPicking(true)}>
                    {selected.length ? "옷 추가·빼기" : "옷 고르기"}
                  </Button>
                }
              >
                {selected.length === 0 ? (
                  <p className="text-subhead text-muted">기록할 옷을 하나 이상 골라 주세요.</p>
                ) : (
                  <div className="scroll-x bleed-gutter gap-2.5 md:mx-0 md:flex-wrap md:px-0">
                    {selected.map((id) => {
                      const it = byId.get(id);
                      return (
                        <button key={id} type="button" onClick={() => toggle(id)} aria-label={`${it?.name ?? "옷"} 빼기`} className="pressable-soft w-[72px] shrink-0 text-left">
                          <ItemImage item={it} showName={false} className="rounded-sm" />
                          <span className="mt-1 block truncate text-caption text-muted">{it?.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {extras.length > 0 && analysis && <p className="mt-2 text-footnote text-muted">AI 후보에 없던 {extras.length}벌을 직접 넣었어요.</p>}
              </Section>

              <Section title="기록 정보">
                <div className="space-y-5">
                  <Field label="날짜">
                    <Input type="date" value={date} max={addDays(today, 1)} onChange={(e) => e.target.value && setDate(e.target.value)} className="tabular" />
                  </Field>
                  <Field label="오늘 코디 만족도" group>
                    <Rating value={rating} onChange={setRating} label="만족도" />
                  </Field>
                  <Field label="상황" group>
                    <TagEditor value={tags} onChange={setTags} suggestions={OCCASIONS} label="상황" />
                  </Field>
                  <Field label="메모">
                    <Textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 생각보다 추웠어요" />
                  </Field>
                </div>
              </Section>

              <div className="space-y-2">
                <Notice>{err}</Notice>
                <Button variant="primary" size="lg" block icon={<CheckIcon size={18} />} loading={saving} disabled={selected.length === 0} onClick={save}>
                  {selected.length ? `${selected.length}벌 착용 기록하기` : "옷을 골라 주세요"}
                </Button>
                <p className="text-center text-footnote text-muted">같은 날 같은 옷은 한 번만 세요.</p>
              </div>
            </>
          )}
        </div>
      </div>
      {picking && (
        <ItemPicker
          open
          title="입은 옷"
          initial={selected}
          doneLabel=" 입었어요"
          onClose={() => setPicking(false)}
          onDone={(ids) => {
            setSelected(ids);
            setPicking(false);
          }}
        />
      )}
    </Page>
  );
}

function CandidateTile({ item, confidence, on, onClick }: { item: Item; confidence: number; on: boolean; onClick: () => void }) {
  const pct = Math.round(confidence * 100);
  return (
    <button type="button" aria-pressed={on} aria-label={`${item.name}, 확신 ${pct}%`} onClick={onClick} className="pressable-soft relative w-[84px] shrink-0 text-left">
      <ItemImage item={item} showName={false} className={`rounded-sm transition-shadow duration-(--dur-fast) ${on ? "shadow-[0_0_0_2px_var(--ink)]" : ""}`} />
      <span aria-hidden className={`absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full ${on ? "bg-accent text-accent-ink" : "scale-90 bg-black/15 text-transparent shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.9)]"}`}>
        <CheckIcon size={14} strokeWidth={2.4} />
      </span>
      <span className="mt-1 block truncate text-caption">{item.name}</span>
      <span className="mt-0.5 flex items-center gap-1.5">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-caption text-muted tabular">{pct}%</span>
      </span>
    </button>
  );
}

