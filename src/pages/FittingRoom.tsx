import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL, type Category, type Item, type TryOn, type TryOnAvailability, type WishlistItemV2 } from "../../shared/types";
import { CollageBoard } from "../components/CollageBoard";
import { DownloadIcon, HangerIcon, HeartIcon, InfoIcon, PersonIcon, PlusIcon, ShirtIcon, SparkIcon, TrashIcon } from "../components/icons";
import { CategoryFilter, ItemImage, PhotoInput } from "../components/items";
import { Badge, Button, ButtonLink, Card, Empty, Img, Notice, Page, Section, Segmented, Sheet, Skeleton, buttonClass, confirmDialog, toast } from "../components/ui";
import { ApiError, api, imageUrl, uploadImage } from "../lib/api";
import { useItems } from "../lib/items";
import { patchProfile, useProfile } from "../lib/profile";
import { mutateQuery, useQuery } from "../lib/query";

type Tab = "tryon" | "collage";
const STATUS_PATH = "/tryon/status";
const HISTORY_PATH = "/tryon";
const POLL_MS = 2500;
/** Replicate(IDM-VTON)가 입힐 수 있는 종류 */
const REPLICATE_CATS: Category[] = ["top", "outer", "bottom", "dress"];
const STATUS_LABEL: Record<TryOn["status"], string> = { queued: "대기 중", processing: "합성 중", succeeded: "완료", failed: "실패" };
const running = (t: TryOn | null | undefined) => !!t && (t.status === "queued" || t.status === "processing");

/** "YYYY-MM-DD HH:MM:SS"(UTC) → ms */
const utcMs = (s: string) => Date.parse(`${s.replace(" ", "T")}Z`);

export default function FittingRoom() {
  const status = useQuery<TryOnAvailability>(STATUS_PATH, { staleTime: 10 * 60_000 });
  const profile = useProfile();
  const [tab, setTab] = useState<Tab | null>(null);
  const available = status.data?.available ?? false;
  const current: Tab = tab ?? (status.data ? (available ? "tryon" : "collage") : "collage");
  const mannequins = profile.data?.mannequin_images ?? [];

  return (
    <Page title="피팅룸" back="/profile" width="default">
      <Segmented
        label="피팅 방식"
        className="mb-6 md:max-w-sm"
        value={current}
        onChange={setTab}
        options={[
          { value: "tryon", label: "AI 가상 피팅" },
          { value: "collage", label: "콜라주 보드" },
        ]}
      />
      {current === "collage" ? (
        profile.loading ? (
          <Skeleton className="mx-auto aspect-[3/4] w-full max-w-md rounded-lg" />
        ) : (
          <CollageBoard mannequins={mannequins} />
        )
      ) : status.loading ? (
        <div role="status" aria-label="불러오는 중" className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : status.error && !status.data ? (
        <Notice
          title="가상 피팅 상태를 확인하지 못했어요"
          action={
            <Button size="sm" onClick={status.reload}>
              다시 시도
            </Button>
          }
        >
          {status.error}
        </Notice>
      ) : !available ? (
        <Unavailable info={status.data!} onCollage={() => setTab("collage")} />
      ) : (
        <TryOnPanel info={status.data!} mannequins={mannequins} profileLoading={profile.loading} />
      )}
    </Page>
  );
}

function Unavailable({ info, onCollage }: { info: TryOnAvailability; onCollage: () => void }) {
  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
            <InfoIcon size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="text-headline">AI 가상 피팅이 꺼져 있어요</h2>
            <p className="mt-1 text-callout text-ink-2">{info.reason ?? "가상 피팅을 쓸 수 없어요."}</p>
          </div>
        </div>
        {info.setup_hint && (
          <div className="mt-4 rounded-md bg-surface-2 px-4 py-3">
            <div className="text-footnote font-semibold text-muted">켜는 방법 (선택 · 유료)</div>
            <p className="mt-1 text-subhead text-ink-2">{info.setup_hint}</p>
          </div>
        )}
      </Card>
      <p className="text-callout text-muted">가상 피팅은 외부 이미지 생성 서비스를 써서 비용이 들어요. 켜지 않아도 콜라주 보드에서 내 전신 사진 위에 옷을 올려 볼 수 있어요.</p>
      <Button variant="primary" icon={<ShirtIcon size={18} />} onClick={onCollage}>
        콜라주 보드 열기
      </Button>
    </div>
  );
}

type Garment = { kind: "item"; id: string } | { kind: "wish"; id: string };

function TryOnPanel({ info, mannequins, profileLoading }: { info: TryOnAvailability; mannequins: string[]; profileLoading: boolean }) {
  const history = useQuery<TryOn[]>(HISTORY_PATH);
  const { items, byId } = useItems();
  const wishes = useQuery<WishlistItemV2[]>("/wishlist");
  const [person, setPerson] = useState<string | null>(null);
  const [source, setSource] = useState<"item" | "wish">("item");
  const [cat, setCat] = useState<Category | "all">("all");
  const [garment, setGarment] = useState<Garment | null>(null);
  const [job, setJob] = useState<TryOn | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<TryOn | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [uploading, setUploading] = useState(false);

  const supported = (c: Category | null | undefined) => info.provider !== "replicate" || (!!c && REPLICATE_CATS.includes(c));
  const personKey = person && mannequins.includes(person) ? person : (mannequins[0] ?? null);

  // 진행 중인 작업이 기록에 있으면 이어서 지켜본다
  const resumable = history.data?.find(running) ?? null;
  const active = job ?? resumable;

  // 2.5초마다 상태를 묻는다
  const activeId = running(active) ? active!.id : null;
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const t = await api<TryOn>(`/tryon/${activeId}`);
        if (stop) return;
        setJob(t);
        mutateQuery<TryOn[]>(HISTORY_PATH, (cur) => (cur ? (cur.some((x) => x.id === t.id) ? cur.map((x) => (x.id === t.id ? t : x)) : [t, ...cur]) : cur));
        if (t.status === "succeeded") toast("가상 피팅이 끝났어요");
        if (!running(t)) return;
      } catch (e) {
        if (stop) return;
        if (e instanceof ApiError && e.status === 404) {
          setJob(null);
          return;
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [activeId]);

  const start = async () => {
    if (!garment || !personKey) return;
    setStarting(true);
    setErr(null);
    try {
      const body = { person_image_key: personKey, ...(garment.kind === "item" ? { item_id: garment.id } : { wish_id: garment.id }) };
      const t = await api<TryOn>("/tryon", { method: "POST", json: body });
      setJob(t);
      setNow(Date.now());
      mutateQuery<TryOn[]>(HISTORY_PATH, (cur) => (cur ? [t, ...cur] : cur));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const addPhoto = async (b: Blob) => {
    setUploading(true);
    try {
      const key = await uploadImage(b);
      await patchProfile({ mannequin_images: [...mannequins, key].slice(0, 6) });
      setPerson(key);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (t: TryOn) => {
    if (!(await confirmDialog({ title: "피팅 결과를 삭제할까요?", message: "전신 사진과 옷 사진은 그대로 남아요.", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/tryon/${t.id}`, { method: "DELETE" });
      mutateQuery<TryOn[]>(HISTORY_PATH, (cur) => cur?.filter((x) => x.id !== t.id));
      if (job?.id === t.id) setJob(null);
      setOpen(null);
      toast("삭제했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const itemCounts = useMemo(() => {
    const m: Partial<Record<Category, number>> = {};
    for (const i of items) if (i.image_key) m[i.category] = (m[i.category] ?? 0) + 1;
    return m;
  }, [items]);
  const shownItems = items.filter((i) => i.image_key && (cat === "all" || i.category === cat));
  const shownWishes = (wishes.data ?? []).filter((w) => w.status !== "dropped" && (w.image_key || w.image_url));

  const garmentLabel = garment ? (garment.kind === "item" ? byId.get(garment.id)?.name : wishes.data?.find((w) => w.id === garment.id)?.name) : null;
  const elapsed = active ? Math.max(0, Math.round((now - utcMs(active.created_at)) / 1000)) : 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-12">
      <div className="min-w-0 space-y-8">
        <Section title="① 전신 사진" description="얼굴과 몸이 다 나온 정면 사진일수록 자연스러워요.">
          {profileLoading ? (
            <Skeleton className="h-36 w-28 rounded-md" />
          ) : (
            <div role="radiogroup" aria-label="전신 사진" className="scroll-x bleed-gutter gap-2.5 md:mx-0 md:flex-wrap md:px-0">
              {mannequins.map((k, i) => {
                const on = k === personKey;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} aria-label={`전신 사진 ${i + 1}`} onClick={() => setPerson(k)} className="pressable-soft w-24 shrink-0 rounded-md">
                    <Img src={imageUrl(k)} ratio="3 / 4" className={`rounded-md transition-shadow duration-(--dur-fast) ${on ? "shadow-[0_0_0_2px_var(--ink)]" : ""}`} />
                  </button>
                );
              })}
              {mannequins.length < 6 && (
                <PhotoInput onPick={addPhoto} disabled={uploading} label="전신 사진 추가" className="pressable grid w-24 shrink-0 place-items-center rounded-md bg-surface-2 text-muted hover:bg-surface-3">
                  <span className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 text-caption">
                    {uploading ? <span className="size-5 animate-pulse rounded-full bg-surface-3" /> : <PlusIcon size={22} />}
                    {uploading ? "올리는 중" : "추가"}
                  </span>
                </PhotoInput>
              )}
            </div>
          )}
        </Section>

        <Section title="② 입혀 볼 옷" description={info.provider === "replicate" ? "상의·아우터·하의·원피스만 입혀 볼 수 있어요." : undefined}>
          <Segmented
            label="옷 출처"
            className="mb-3 md:max-w-xs"
            value={source}
            onChange={setSource}
            options={[
              { value: "item", label: "옷장" },
              { value: "wish", label: "위시리스트" },
            ]}
          />
          {source === "item" ? (
            <>
              <CategoryFilter value={cat} onChange={setCat} counts={itemCounts} />
              {shownItems.length === 0 ? (
                <Empty icon={<HangerIcon size={26} />} title="사진이 있는 옷이 없어요" action={<ButtonLink to="/closet/new">옷 등록하기</ButtonLink>}>
                  가상 피팅에는 옷 사진이 필요해요.
                </Empty>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5">
                  {shownItems.map((i) => (
                    <GarmentTile key={i.id} item={i} on={garment?.kind === "item" && garment.id === i.id} disabled={!supported(i.category)} onClick={() => setGarment({ kind: "item", id: i.id })} />
                  ))}
                </div>
              )}
            </>
          ) : wishes.loading ? (
            <Skeleton className="h-36 rounded-md" />
          ) : shownWishes.length === 0 ? (
            <Empty icon={<HeartIcon size={26} />} title="사진이 있는 위시리스트 옷이 없어요" action={<ButtonLink to="/wishlist">위시리스트로</ButtonLink>}>
              살까 고민 중인 옷을 사진과 함께 담아 두면 입혀 볼 수 있어요.
            </Empty>
          ) : (
            <div className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5">
              {shownWishes.map((w) => {
                const on = garment?.kind === "wish" && garment.id === w.id;
                const disabled = !supported(w.category);
                return (
                  <button key={w.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => setGarment({ kind: "wish", id: w.id })} className="pressable-soft text-left disabled:opacity-40">
                    <Img src={imageUrl(w.image_key) ?? w.image_url} ratio="3 / 4" className={`rounded-md ${on ? "shadow-[0_0_0_2px_var(--ink)]" : ""}`} fallback={<HeartIcon size={18} className="text-faint" />} />
                    <span className="mt-1.5 block truncate text-footnote">{w.name}</span>
                    {disabled && <span className="block text-caption text-muted">지원하지 않는 종류</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      <div className="min-w-0 space-y-8 lg:sticky lg:top-[calc(var(--safe-top)+var(--bar-h)+8px)] lg:self-start">
        <Card>
          <h2 className="text-headline">피팅</h2>
          <p className="mt-0.5 text-subhead text-muted">
            {info.provider === "replicate" ? "Replicate" : "Gemini"} · {info.model}
          </p>

          {active && running(active) ? (
            <div role="status" className="mt-4">
              <div className="flex gap-2">
                <Img src={imageUrl(active.person_image_key)} ratio="3 / 4" className="w-16 rounded-sm" />
                <span className="grid place-items-center text-muted">
                  <PlusIcon size={18} />
                </span>
                <Img src={imageUrl(active.garment_image_key)} ratio="3 / 4" className="w-16 rounded-sm" />
              </div>
              <div className="mt-4 flex items-baseline justify-between text-subhead">
                <span className="font-semibold">{STATUS_LABEL[active.status]}…</span>
                <span className="text-muted tabular">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="가상 피팅 진행 중">
                <div className="h-full w-1/3 animate-[indeterminate_1.6s_var(--ease-standard)_infinite] rounded-full bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
              </div>
              <p className="mt-3 text-footnote text-muted">보통 30초~2분 걸려요. 화면을 떠나도 계속 진행되고, 돌아오면 이어서 보여 드려요.</p>
            </div>
          ) : job && job.status === "succeeded" && job.result_image_key ? (
            <div className="mt-4">
              <Img src={imageUrl(job.result_image_key)} ratio="3 / 4" loading="eager" className="rounded-md" alt="가상 피팅 결과" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={imageUrl(job.result_image_key)!} download className={buttonClass({ variant: "secondary" })}>
                  <DownloadIcon size={18} /> 저장
                </a>
                <Button onClick={() => setJob(null)}>다른 옷 입히기</Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {job?.status === "failed" && (
                <Notice title="피팅하지 못했어요" action={<Button size="sm" onClick={start}>다시 시도</Button>}>
                  {job.error ?? "알 수 없는 이유로 실패했어요."}
                </Notice>
              )}
              <div className="flex items-center gap-2 text-subhead">
                <PersonIcon size={18} className="text-muted" />
                <span className={personKey ? "" : "text-muted"}>{personKey ? "전신 사진 골랐어요" : "전신 사진을 골라 주세요"}</span>
              </div>
              <div className="flex items-center gap-2 text-subhead">
                <ShirtIcon size={18} className="text-muted" />
                <span className={`min-w-0 truncate ${garmentLabel ? "" : "text-muted"}`}>{garmentLabel ?? "입혀 볼 옷을 골라 주세요"}</span>
              </div>
              <Notice>{err}</Notice>
              <Button variant="primary" size="lg" block icon={<SparkIcon size={18} />} loading={starting} disabled={!personKey || !garment} onClick={start}>
                피팅 시작
              </Button>
            </div>
          )}
        </Card>

        <Section title="피팅 기록">
          {history.loading ? (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="aspect-[3/4] rounded-md" />
              ))}
            </div>
          ) : history.error && !history.data ? (
            <Notice title="기록을 불러오지 못했어요" action={<Button size="sm" onClick={history.reload}>다시 시도</Button>}>
              {history.error}
            </Notice>
          ) : !history.data?.length ? (
            <p className="text-subhead text-muted">아직 입혀 본 옷이 없어요.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {history.data.map((t) => (
                <button key={t.id} type="button" onClick={() => setOpen(t)} className="pressable-soft relative rounded-md text-left" aria-label={`피팅 기록: ${STATUS_LABEL[t.status]}`}>
                  <Img src={imageUrl(t.result_image_key ?? t.person_image_key)} ratio="3 / 4" className={`rounded-md ${t.status === "succeeded" ? "" : "opacity-50"}`} />
                  {t.status !== "succeeded" && <Badge tone={t.status === "failed" ? "danger" : "neutral"} className="absolute top-1.5 left-1.5">{STATUS_LABEL[t.status]}</Badge>}
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title="피팅 기록">
        {open && (
          <div className="space-y-4">
            {open.result_image_key ? (
              <Img src={imageUrl(open.result_image_key)} ratio="3 / 4" loading="eager" className="mx-auto w-full max-w-[340px] rounded-lg" alt="가상 피팅 결과" />
            ) : (
              <Notice tone={open.status === "failed" ? "error" : "info"} title={STATUS_LABEL[open.status]}>
                {open.error ?? "아직 결과가 없어요."}
              </Notice>
            )}
            <div className="flex items-center gap-3">
              <Img src={imageUrl(open.person_image_key)} ratio="3 / 4" className="w-14 rounded-sm" />
              <Img src={imageUrl(open.garment_image_key)} ratio="3 / 4" className="w-14 rounded-sm" />
              <div className="min-w-0 text-footnote text-muted">
                {open.category && <div>{CATEGORY_LABEL[open.category]}</div>}
                <div>{open.garment_item_id ? (byId.get(open.garment_item_id)?.name ?? "옷장 옷") : "위시리스트 옷"}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {open.result_image_key ? (
                <a href={imageUrl(open.result_image_key)!} download className={buttonClass({ variant: "secondary" })}>
                  <DownloadIcon size={18} /> 저장
                </a>
              ) : (
                <span />
              )}
              <Button variant="danger" icon={<TrashIcon size={18} />} onClick={() => remove(open)}>
                삭제
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function GarmentTile({ item, on, disabled, onClick }: { item: Item; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} className="pressable-soft text-left disabled:opacity-40">
      <ItemImage item={item} showName={false} className={`transition-shadow duration-(--dur-fast) ${on ? "shadow-[0_0_0_2px_var(--ink)]" : ""}`} />
      <span className="mt-1.5 block truncate text-footnote">{item.name}</span>
      {disabled && <span className="block text-caption text-muted">지원하지 않는 종류</span>}
    </button>
  );
}
