import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { CATEGORIES, CATEGORY_LABEL, SEASONS, SEASON_LABEL, type DormantItem, type Item, type ItemTagging, type Season, type UrlImport } from "../../shared/types";
import { CameraIcon, ExternalIcon, HangerIcon, ImageIcon, LinkIcon, SparkIcon, TrashIcon, WandIcon } from "../components/icons";
import { PhotoInput, ITEM_RATIO } from "../components/items";
import { Button, Chip, ChipRow, Empty, Field, Img, Input, Notice, Page, Segmented, Skeleton, SkeletonText, Spinner, Stat, Switch, Textarea, buttonClass, confirmDialog, toast } from "../components/ui";
import { api, imageUrl, uploadImage, won } from "../lib/api";
import { useIsWide, useStoredFlag } from "../lib/hooks";
import { composeCutout } from "../lib/image";
import { cpw, patchItemInCache, removeItemFromCache, linkError, useItems, wearItems, wearToast } from "../lib/items";
import { useQuery } from "../lib/query";
import { useGoBack, useNav } from "../lib/router";

/** 화면에서 고치는 값 (색·태그는 쉼표로 구분한 글자로 다룬다) */
interface Form {
  name: string;
  category: Item["category"];
  sub_category: string;
  brand: string;
  colors: string;
  material: string;
  fit: string;
  season: Season[];
  warmth: number | null;
  style_tags: string;
  purchase_price: number | null;
  original_shop_url: string;
  notes: string;
  image_key: string | null;
}

const EMPTY: Form = { name: "", category: "top", sub_category: "", brand: "", colors: "", material: "", fit: "", season: [], warmth: null, style_tags: "", purchase_price: null, original_shop_url: "", notes: "", image_key: null };

const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const fromItem = (it: Item): Form => ({
  name: it.name,
  category: it.category,
  sub_category: it.sub_category ?? "",
  brand: it.brand ?? "",
  colors: it.colors.join(", "),
  material: it.material ?? "",
  fit: it.fit ?? "",
  season: it.season,
  warmth: it.warmth,
  style_tags: it.style_tags.join(", "),
  purchase_price: it.purchase_price,
  original_shop_url: it.original_shop_url ?? "",
  notes: it.notes ?? "",
  image_key: it.image_key,
});
const toBody = (f: Form) => ({ ...f, colors: toList(f.colors), style_tags: toList(f.style_tags) });

type Busy = { kind: "bg" | "upload" | "analyze" | "url"; label: string; ratio?: number | null } | null;

const WARMTH = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));
const BG_KEY = "clothe:bg-removal";

export default function ItemEdit() {
  const { id } = useParams();
  // 분할 보기에서 다른 옷을 고르면 입력 상태가 새로 시작되도록 key를 준다
  return <ItemEditor key={id ?? "new"} id={id} />;
}

function ItemEditor({ id }: { id: string | undefined }) {
  const isNew = !id;
  const nav = useNav();
  const goBack = useGoBack();
  const wide = useIsWide();
  const { byId, loading: itemsLoading } = useItems();
  const source = id ? byId.get(id) : undefined;

  const [form, setForm] = useState<Form | null>(isNew ? EMPTY : source ? fromItem(source) : null);
  if (!form && source) setForm(fromItem(source));

  const [busy, setBusy] = useState<Busy>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [bgNotice, setBgNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [bgOn, setBgOn] = useStoredFlag(BG_KEY);
  /** 이번 화면에서 고른 원본 사진 (배경 제거를 켜고 끌 때 다시 처리하려고 보관) */
  const original = useRef<Blob | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const dirty = useMemo(() => {
    if (!form) return false;
    if (isNew) return form.name.trim().length > 0;
    return !!source && JSON.stringify(toBody(form)) !== JSON.stringify(toBody(fromItem(source)));
  }, [form, source, isNew]);

  if (!form) {
    if (itemsLoading)
      return (
        <Page title="옷 정보" back="/closet" backStyle={wide ? "close" : "back"} width="narrow">
          <Skeleton className="mx-auto w-full max-w-[280px] rounded-lg" style={{ aspectRatio: ITEM_RATIO }} />
          <SkeletonText lines={4} className="mt-8" />
        </Page>
      );
    return (
      <Page title="옷 정보" back="/closet" backStyle={wide ? "close" : "back"} width="narrow">
        <Empty icon={<HangerIcon size={26} />} title="옷을 찾을 수 없어요" action={<Button onClick={() => goBack("/closet")}>옷장으로</Button>}>
          삭제되었거나 주소가 잘못되었어요.
        </Empty>
      </Page>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const applyTagging = (t: ItemTagging, keepName?: string | null) =>
    setForm((f) =>
      f
        ? {
            ...f,
            name: keepName || f.name || t.name,
            category: t.category,
            sub_category: t.sub_category ?? f.sub_category,
            colors: (t.colors ?? []).join(", "),
            material: t.material ?? f.material,
            fit: t.fit ?? f.fit,
            season: t.season ?? f.season,
            warmth: t.warmth ?? f.warmth,
            style_tags: (t.style_tags ?? []).join(", "),
          }
        : f,
    );

  const analyze = async (key: string, keepName?: string | null) => {
    setBusy({ kind: "analyze", label: "AI가 옷을 살펴보는 중" });
    setAiErr(null);
    try {
      applyTagging(await api<ItemTagging>("/items/analyze", { method: "POST", json: { image_key: key } }), keepName);
    } catch (e) {
      setAiErr((e as Error).message);
    }
  };

  /** 사진 처리: (배경 제거) → 업로드 → AI 분석 */
  const processPhoto = async (blob: Blob, removeBg: boolean) => {
    setErr(null);
    setBgNotice(null);
    let final = blob;
    try {
      if (removeBg) {
        setBusy({ kind: "bg", label: "배경 제거 준비 중", ratio: null });
        try {
          // 큰 라이브러리라서 이때 처음 불러온다
          const { removeBackground } = await import("../lib/background");
          const cut = await removeBackground(blob, (p) =>
            setBusy({ kind: "bg", label: p.phase === "download" ? "배경 제거 모델 내려받는 중" : "배경을 지우는 중", ratio: p.ratio }),
          );
          final = await composeCutout(cut);
        } catch (e) {
          console.warn("배경 제거 실패", e);
          setBgNotice("배경을 지우지 못해서 원본 사진을 그대로 썼어요.");
        }
      }
      setPreview(URL.createObjectURL(final));
      setBusy({ kind: "upload", label: "사진 올리는 중" });
      const key = await uploadImage(final);
      set("image_key", key);
      await analyze(key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onPhoto = (blob: Blob) => {
    original.current = blob;
    void processPhoto(blob, bgOn);
  };

  const toggleBg = (on: boolean) => {
    setBgOn(on);
    // 방금 고른 사진이 있으면 바뀐 설정으로 다시 처리한다
    if (original.current && !busy) void processPhoto(original.current, on);
  };

  const importUrl = async () => {
    setBusy({ kind: "url", label: "상품 정보를 가져오는 중" });
    setErr(null);
    try {
      const p = await api<UrlImport & { image_key: string | null }>("/items/import-url", { method: "POST", json: { url } });
      original.current = null;
      setPreview(null);
      setForm((f) => (f ? { ...f, name: p.name ?? f.name, brand: p.brand ?? f.brand, purchase_price: p.price ?? f.purchase_price, image_key: p.image_key ?? f.image_key, original_shop_url: url } : f));
      if (p.image_key) await analyze(p.image_key, p.name);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const bad = linkError(form.original_shop_url, "쇼핑몰 링크");
    if (bad) {
      setErr(bad);
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      if (isNew) {
        const saved = await api<Item>("/items", { method: "POST", json: toBody(form) });
        patchItemInCache(saved);
        toast("옷장에 넣었어요");
        if (wide) nav(`/closet/${saved.id}`, { replace: true, preventScrollReset: true });
        else goBack("/closet");
      } else {
        const saved = await api<Item>(`/items/${id}`, { method: "PATCH", json: toBody(form) });
        patchItemInCache(saved);
        setForm(fromItem(saved));
        toast("저장했어요");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "이 옷을 삭제할까요?", message: "착용 기록도 함께 사라지고 되돌릴 수 없어요.", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/items/${id}`, { method: "DELETE" });
      removeItemFromCache(id!);
      toast("삭제했어요");
      goBack("/closet");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const wearToday = async () => {
    try {
      toast(wearToast(await wearItems([id!])));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const c = source ? cpw(source) : null;
  const src = preview ?? imageUrl(form.image_key);
  const photoBusy = busy && busy.kind !== "url";

  return (
    <Page
      title={isNew ? "옷 등록" : form.name || "옷 정보"}
      back="/closet"
      backStyle={wide ? "close" : "back"}
      width="narrow"
      right={
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty || !form.name.trim() || !!busy}>
          {isNew ? "등록" : "저장"}
        </Button>
      }
    >
      <div className="space-y-8">
        {/* 사진 */}
        <section aria-label="사진">
          <div className="relative mx-auto w-full max-w-[248px]">
            <Img
              src={src}
              alt={form.name}
              ratio={ITEM_RATIO}
              loading="eager"
              className="rounded-lg"
              fallback={
                <div className="flex flex-col items-center gap-2 text-footnote text-faint">
                  <HangerIcon size={36} strokeWidth={1.3} />
                  사진이 아직 없어요
                </div>
              }
            />
            {photoBusy && (
              <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-scrim px-6 text-center text-subhead font-medium text-white backdrop-blur-[2px]">
                {busy.kind === "bg" && busy.ratio != null ? (
                  <div className="h-1 w-32 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.ratio * 100)}>
                    <div className="h-full rounded-full bg-white transition-[width] duration-(--dur-base)" style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
                  </div>
                ) : (
                  <Spinner size={22} />
                )}
                <span>
                  {busy.label}
                  {busy.kind === "bg" && busy.ratio != null && <span className="tabular"> {Math.round(busy.ratio * 100)}%</span>}
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <PhotoInput onPick={onPhoto} disabled={!!busy} className={buttonClass({ variant: "secondary", size: "sm" })}>
              <ImageIcon size={16} /> {form.image_key ? "사진 바꾸기" : "사진 고르기"}
            </PhotoInput>
            <PhotoInput onPick={onPhoto} capture disabled={!!busy} className={buttonClass({ variant: "secondary", size: "sm" })}>
              <CameraIcon size={16} /> 찍기
            </PhotoInput>
            {form.image_key && (
              <Button variant="secondary" size="sm" icon={<SparkIcon size={16} />} onClick={() => analyze(form.image_key!).finally(() => setBusy(null))} disabled={!!busy}>
                AI 분석
              </Button>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-md bg-surface-2 px-3.5 py-3">
            <WandIcon size={20} className="shrink-0 text-ink-2" />
            <div className="min-w-0 flex-1">
              <div className="text-callout font-medium">배경 제거</div>
              <div className="text-footnote text-muted">사진은 기기 안에서만 처리해요. 처음 한 번 모델(약 55MB)을 내려받아요.</div>
            </div>
            <Switch checked={bgOn} onChange={toggleBg} label="배경 제거" disabled={!!busy} />
          </div>

          <div className="mt-3 space-y-2">
            <Notice tone="info">{bgNotice}</Notice>
            {aiErr && (
              <Notice
                title="AI 분석을 하지 못했어요"
                action={
                  form.image_key && (
                    <Button size="sm" onClick={() => analyze(form.image_key!).finally(() => setBusy(null))} disabled={!!busy}>
                      다시 시도
                    </Button>
                  )
                }
              >
                {aiErr} 아래 정보는 직접 입력해도 돼요.
              </Notice>
            )}
          </div>
        </section>

        {isNew && (
          <section aria-label="쇼핑몰 링크로 가져오기">
            <Field label="쇼핑몰 링크로 가져오기">
              <div className="flex gap-2">
                <Input placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" enterKeyHint="go" onKeyDown={(e) => e.key === "Enter" && url && !busy && importUrl()} />
                <Button className="h-12" icon={busy?.kind === "url" ? undefined : <LinkIcon size={18} />} onClick={importUrl} loading={busy?.kind === "url"} disabled={!url || !!busy}>
                  가져오기
                </Button>
              </div>
            </Field>
          </section>
        )}

        {source && (
          <section aria-label="착용 기록">
            <div className="grid grid-cols-3 divide-x divide-line rounded-lg bg-surface py-3.5 shadow-[0_0_0_1px_var(--line)]">
              <Stat className="px-3.5" label="착용" value={`${source.wear_count}회`} />
              <Stat className="px-3.5" label="1회당" value={c != null ? won(c) : "–"} />
              <Stat className="px-3.5" label="마지막" value={source.last_worn_date ? source.last_worn_date.slice(5).replace("-", ".") : "–"} />
            </div>
            <CpwGauge item={source} />
            <Button variant="primary" block className="mt-3" onClick={wearToday}>
              오늘 입었어요
            </Button>
          </section>
        )}

        {/* 기본 정보 */}
        <section className="space-y-5">
          <h2 className="text-title-2">기본 정보</h2>
          <Field label="이름">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="예: 네이비 오버핏 셔츠" />
          </Field>
          <Field label="카테고리" group>
            <ChipRow wrap>
              {CATEGORIES.map((cat) => (
                <Chip key={cat} active={form.category === cat} onClick={() => set("category", cat)}>
                  {CATEGORY_LABEL[cat]}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="세부 종류">
              <Input value={form.sub_category} onChange={(e) => set("sub_category", e.target.value)} placeholder="셔츠, 슬랙스" />
            </Field>
            <Field label="브랜드">
              <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="space-y-5">
          <h2 className="text-title-2">디테일</h2>
          <Field label="색" hint="쉼표로 구분">
            <Input value={form.colors} onChange={(e) => set("colors", e.target.value)} placeholder="네이비, 화이트" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="소재">
              <Input value={form.material} onChange={(e) => set("material", e.target.value)} />
            </Field>
            <Field label="핏">
              <Input value={form.fit} onChange={(e) => set("fit", e.target.value)} />
            </Field>
          </div>
          <Field label="계절" group>
            <ChipRow wrap>
              {SEASONS.map((s) => {
                const on = form.season.includes(s);
                return (
                  <Chip key={s} active={on} onClick={() => set("season", on ? form.season.filter((x) => x !== s) : [...form.season, s])}>
                    {SEASON_LABEL[s]}
                  </Chip>
                );
              })}
            </ChipRow>
          </Field>
          <Field label="보온성" hint="1 아주 얇음 – 5 아주 따뜻함" group>
            <Segmented label="보온성" value={form.warmth} onChange={(v) => set("warmth", v)} options={WARMTH} />
          </Field>
          <Field label="스타일 태그" hint="쉼표로 구분">
            <Input value={form.style_tags} onChange={(e) => set("style_tags", e.target.value)} placeholder="미니멀, 캐주얼" />
          </Field>
        </section>

        <section className="space-y-5">
          <h2 className="text-title-2">구매 정보</h2>
          <Field label="구매 가격 (원)">
            <Input
              inputMode="numeric"
              className="tabular"
              value={form.purchase_price != null ? form.purchase_price.toLocaleString("ko-KR") : ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                set("purchase_price", digits ? Number(digits) : null);
              }}
              placeholder="0"
            />
          </Field>
          <Field label="쇼핑몰 링크">
            <div className="flex gap-2">
              <Input value={form.original_shop_url} onChange={(e) => set("original_shop_url", e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://" />
              {/^https?:\/\//.test(form.original_shop_url) && (
                <a href={form.original_shop_url} target="_blank" rel="noreferrer" aria-label="쇼핑몰 열기" title="쇼핑몰 열기" className={buttonClass({ variant: "secondary", className: "h-12 px-4" })}>
                  <ExternalIcon size={18} />
                </a>
              )}
            </div>
          </Field>
          <Field label="메모">
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </section>

        <Notice>{err}</Notice>

        <div className="space-y-2">
          <Button variant="primary" size="lg" block onClick={save} loading={saving} disabled={!dirty || !form.name.trim() || !!busy}>
            {isNew ? "옷장에 넣기" : "변경 내용 저장"}
          </Button>
          {!isNew && (
            <Button variant="ghost" block className="text-danger" icon={<TrashIcon size={18} />} onClick={remove}>
              옷 삭제
            </Button>
          )}
        </div>
      </div>
    </Page>
  );
}

/** 1회 착용당 가격 목표: 30번 입기 (#30wears) */
const GOAL_WEARS = 30;
const MILESTONES = [10, 20, 30];

/** 뽕 뽑기 게이지: 구매 가격을 몇 번 입어서 "뽑았는지" */
function CpwGauge({ item }: { item: Item }) {
  const dormant = useQuery<DormantItem[]>("/items/dormant", { staleTime: 5 * 60_000 });
  const d = dormant.data?.find((x) => x.item_id === item.id);
  const price = item.purchase_price;
  if (!price)
    return <p className="mt-3 rounded-md bg-surface-2 px-3.5 py-3 text-subhead text-muted">구매 가격을 넣으면 1회당 가격과 뽕 뽑기 게이지를 보여 드려요.</p>;
  const worn = item.wear_count;
  const ratio = Math.min(1, worn / GOAL_WEARS);
  const done = worn >= GOAL_WEARS;
  return (
    <div className="mt-3 rounded-lg bg-surface px-4 py-4 shadow-[0_0_0_1px_var(--line)]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-headline">뽕 뽑기 게이지</h3>
        <span className="text-subhead font-semibold tabular">
          {Math.min(worn, GOAL_WEARS)}/{GOAL_WEARS}회
        </span>
      </div>
      <div
        className="relative mt-3 h-2.5 rounded-full bg-surface-2"
        role="meter"
        aria-label="뽕 뽑기 게이지"
        aria-valuemin={0}
        aria-valuemax={GOAL_WEARS}
        aria-valuenow={Math.min(worn, GOAL_WEARS)}
        aria-valuetext={`${worn}번 입음, 목표 ${GOAL_WEARS}번`}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-(--dur-slow) ease-emphasized" style={{ width: `${ratio * 100}%` }} />
        {MILESTONES.slice(0, -1).map((m) => (
          <span key={m} aria-hidden className="absolute top-0 h-full w-0.5 bg-bg" style={{ left: `${(m / GOAL_WEARS) * 100}%` }} />
        ))}
      </div>
      <ol className="mt-2 grid grid-cols-3 text-caption text-muted tabular">
        {MILESTONES.map((m) => (
          <li key={m} className={`text-right ${worn >= m ? "font-semibold text-ink" : ""}`}>
            <span className="block">{m}회</span>
            <span className="block">회당 {won(price / m)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-subhead text-ink-2">
        {done ? `본전 이상 뽑았어요. 지금 회당 ${won(price / Math.max(1, worn))}이에요.` : worn === 0 ? `아직 한 번도 안 입었어요. ${GOAL_WEARS}번 입으면 회당 ${won(price / GOAL_WEARS)}이 돼요.` : `${GOAL_WEARS - worn}번 더 입으면 회당 ${won(price / GOAL_WEARS)}이 돼요.`}
      </p>
      {d && <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-footnote text-ink-2">장롱템 · {d.reason}. 오늘 탭 추천에 우선으로 섞여요.</p>}
    </div>
  );
}
