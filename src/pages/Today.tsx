import { useEffect, useMemo, useState } from "react";
import type { DormantItem, Item, Outfit, SimilarLookResult, SuggestedOutfit, TodayResult, Weather } from "../../shared/types";
import { CheckIcon, ChevronRightIcon, CloseIcon, HangerIcon, ImageIcon, LayersIcon, PersonIcon, PinIcon, PlusIcon, RefreshIcon, SparkIcon } from "../components/icons";
import { ItemImage, OutfitCollage, PhotoInput } from "../components/items";
import { Badge, Button, ButtonLink, Card, Chip, ChipRow, Empty, Field, IconButton, Img, Input, Notice, Page, Section, Segmented, Skeleton, SkeletonText, Textarea, toast } from "../components/ui";
import { AiOffNotice } from "../components/AiStatus";
import { api, uploadImage } from "../lib/api";
import { createOutfit, useItems, useOutfits, wearItems, wearToast } from "../lib/items";
import { DEFAULT_LOCATION, type SavedLocation } from "../lib/location";
import { useQuery } from "../lib/query";
import { AppLink } from "../lib/router";
import { loadWeather } from "../lib/weather";

const QUICK = ["출근", "데이트", "많이 걷는 날", "편하게", "꾸안꾸", "격식 있게", "운동"];

/** 기온으로 대략적인 필요한 보온성(1~5) */
function targetWarmth(w: Weather): number {
  const avg = (w.temp_min + w.temp_max) / 2;
  if (avg >= 24) return 1;
  if (avg >= 19) return 2;
  if (avg >= 13) return 3;
  if (avg >= 6) return 4;
  return 5;
}

function outfitWarmth(ids: string[], byId: Map<string, Item>): number | null {
  const ws = ids.map((id) => byId.get(id)?.warmth).filter((x): x is number => !!x);
  return ws.length ? Math.max(...ws) : null;
}

const splitKeywords = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const todayLabel = () => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

// 화면을 오가도 날씨와 추천 결과를 다시 받지 않도록 기억해 둔다 (날씨는 20분)
let weatherMemo: { key: string; at: number; weather: Weather } | null = null;
let resultMemo: { result: TodayResult; keywords: string } | null = null;
let similarMemo: { result: SimilarLookResult; mode: SimilarLookResult["mode"]; description: string; photoKey: string | null } | null = null;

export default function Today() {
  const { items, byId, loading: itemsLoading } = useItems();
  const settings = useQuery<{ location?: SavedLocation }>("/settings", { staleTime: 5 * 60_000 });
  const loc = settings.data ? (settings.data.location ?? DEFAULT_LOCATION) : settings.error ? DEFAULT_LOCATION : null;
  const locKey = loc ? `${loc.lat},${loc.lon}` : null;

  const [weather, setWeather] = useState<Weather | null>(weatherMemo?.weather ?? null);
  const [weatherErr, setWeatherErr] = useState<string | null>(null);
  const [keywords, setKeywords] = useState(resultMemo?.keywords ?? "");
  const [result, setResult] = useState<TodayResult | null>(resultMemo?.result ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedTitles, setSavedTitles] = useState<Set<string>>(() => new Set());
  const saved = useOutfits();

  const [weatherTry, setWeatherTry] = useState(0);
  useEffect(() => {
    if (!loc || !locKey) return;
    if (weatherTry === 0 && weatherMemo && weatherMemo.key === locKey && Date.now() - weatherMemo.at < 20 * 60_000) return;
    let cancelled = false;
    loadWeather(loc.lat, loc.lon, loc.name)
      .then((w) => {
        weatherMemo = { key: locKey, at: Date.now(), weather: w };
        if (cancelled) return;
        setWeather(w);
        setWeatherErr(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setWeatherErr(e.message || "날씨를 불러오지 못했어요");
      });
    return () => {
      cancelled = true;
    };
    // 위치 좌표가 바뀌거나 "다시 시도"를 눌렀을 때만 다시 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey, weatherTry]);

  const recommend = async (refresh = false) => {
    if (!loc) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<TodayResult>("/stylist/today", {
        method: "POST",
        json: { weather, lat: loc.lat, lon: loc.lon, location_name: loc.name, keywords, refresh },
      });
      resultMemo = { result: r, keywords };
      setResult(r);
      setSavedTitles(new Set());
      if (r.weather) setWeather(r.weather);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = splitKeywords(keywords);
  const toggleKeyword = (k: string) => setKeywords((active.includes(k) ? active.filter((p) => p !== k) : [...active, k]).join(", "));

  const weatherSummary = weather ? `${weather.description} ${weather.temp_min}~${weather.temp_max}°C` : undefined;

  const sortedSaved = useMemo(() => {
    const list = saved.data ?? [];
    if (!weather) return list;
    const t = targetWarmth(weather);
    return [...list].sort((a, b) => Math.abs((outfitWarmth(a.item_ids, byId) ?? t) - t) - Math.abs((outfitWarmth(b.item_ids, byId) ?? t) - t));
  }, [saved.data, weather, byId]);

  const wear = async (ids: string[], outfit_id?: string) => {
    // 옷장에서 지운 옷은 빼고 기록한다 (서버는 없는 옷이 섞이면 400). 아직 저장 중인 코디(temp-)의 id 는 보내지 않는다.
    const known = ids.filter((id) => byId.has(id));
    if (!known.length) {
      toast.error("옷장에 남아 있는 옷이 없어요");
      return;
    }
    try {
      toast(wearToast(await wearItems(known, { outfit_id: outfit_id?.startsWith("temp-") ? undefined : outfit_id, weather_summary: weatherSummary })));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const save = async (o: SuggestedOutfit, tags: string[] = active) => {
    // 버튼은 바로 "저장됨"으로 바뀌고, 실패하면 되돌린다
    setSavedTitles((s) => new Set(s).add(o.title));
    try {
      await createOutfit({ name: o.title, item_ids: o.item_ids, source: "ai", reason: o.reason, tags });
      toast("코디를 저장했어요");
    } catch (e) {
      setSavedTitles((s) => {
        const next = new Set(s);
        next.delete(o.title);
        return next;
      });
      toast.error((e as Error).message);
    }
  };

  const notEnough = !itemsLoading && items.length < 2;

  return (
    <Page title="오늘" eyebrow={todayLabel()}>
      <AiOffNotice className="mb-6" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-10 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-10 xl:sticky xl:top-[calc(var(--safe-top)+var(--bar-h)+8px)] xl:self-start">
          <WeatherBlock weather={weather} error={weatherErr} onRetry={() => setWeatherTry((n) => n + 1)} />

          <Section title="코디 추천" description="오늘 날씨와 내 옷장으로 AI가 골라 드려요.">
            <ChipRow label="상황" className="xl:flex-wrap xl:overflow-visible">
              {QUICK.map((k) => (
                <Chip key={k} active={active.includes(k)} onClick={() => toggleKeyword(k)}>
                  {k}
                </Chip>
              ))}
            </ChipRow>
            <Input
              className="mt-3"
              placeholder="예: 한강 피크닉, 많이 걸어요"
              aria-label="오늘의 상황"
              value={keywords}
              enterKeyHint="go"
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && !notEnough && recommend(false)}
            />
            <div className="mt-3 flex gap-2">
              <Button variant="primary" size="lg" className="flex-1" icon={<SparkIcon size={18} />} loading={busy} onClick={() => recommend(false)} disabled={!loc || notEnough || itemsLoading}>
                {busy ? "코디를 고르는 중" : "코디 추천받기"}
              </Button>
              {result && (
                <Button size="lg" icon={<RefreshIcon size={18} />} onClick={() => recommend(true)} disabled={busy}>
                  다시
                </Button>
              )}
            </div>
            {notEnough && (
              <Notice
                tone="info"
                className="mt-3"
                action={
                  <ButtonLink to="/closet/new" size="sm" variant="primary" icon={<PlusIcon size={16} />}>
                    옷 등록하기
                  </ButtonLink>
                }
              >
                추천을 받으려면 옷장에 옷이 2벌 이상 있어야 해요.
              </Notice>
            )}
            {err && (
              <Notice
                className="mt-3"
                title="추천을 받지 못했어요"
                action={
                  <Button size="sm" onClick={() => recommend(false)}>
                    다시 시도
                  </Button>
                }
              >
                {err}
              </Notice>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-10">
          {(busy || result) && (
            <Section title="오늘의 추천">
              {busy ? (
                <div role="status" aria-label="코디를 고르는 중">
                  <SkeletonText lines={2} className="mb-5 max-w-lg" />
                  <div className="grid gap-4 md:grid-cols-2">
                    {[0, 1].map((i) => (
                      <Card key={i}>
                        <Skeleton className="h-5 w-2/5" />
                        <SkeletonText lines={2} className="mt-3" />
                        <div className="mt-4 grid grid-cols-4 gap-1.5">
                          {[0, 1, 2, 3].map((j) => (
                            <Skeleton key={j} className="aspect-[3/4]" />
                          ))}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : result ? (
                <>
                  {result.briefing && <p className="mb-4 max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">{result.briefing}</p>}
                  <ProfileUsed used={result.profile_used} />
                  <DormantStrip dormant={result.dormant} outfits={result.outfits} byId={byId} />
                  {result.outfits.length === 0 ? (
                    <Empty title="어울리는 조합을 찾지 못했어요">옷을 더 등록하거나 상황을 바꿔서 다시 받아 보세요.</Empty>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {result.outfits.map((o, i) => (
                        <SuggestionCard key={i} outfit={o} saved={savedTitles.has(o.title)} dormant={result.dormant} byId={byId} onSave={() => save(o)} onWear={() => wear(o.item_ids)} />
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </Section>
          )}

          <SimilarLook
            disabled={notEnough || itemsLoading}
            context={loc ? { weather, lat: loc.lat, lon: loc.lon, location_name: loc.name } : null}
            savedTitles={savedTitles}
            onSave={(o, mode) => save(o, [mode === "couple" ? "커플룩" : "시밀러룩"])}
            onWear={(ids) => wear(ids)}
          />

          <Section
            title="저장한 코디"
            description={weather && sortedSaved.length > 1 ? "오늘 기온에 맞는 순서예요." : undefined}
            action={
              sortedSaved.length > 0 && (
                <AppLink to="/outfits" className="text-subhead font-medium text-muted hover:text-ink">
                  전체 보기
                </AppLink>
              )
            }
          >
            {saved.loading ? (
              <div className="scroll-x bleed-gutter gap-3 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0">
                {[0, 1].map((i) => (
                  <Card key={i} className="w-[78%] shrink-0 md:w-auto">
                    <Skeleton className="h-5 w-1/2" />
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {[0, 1, 2, 3].map((j) => (
                        <Skeleton key={j} className="aspect-[3/4]" />
                      ))}
                    </div>
                    <Skeleton className="mt-4 h-11 rounded-full" />
                  </Card>
                ))}
              </div>
            ) : sortedSaved.length === 0 ? (
              <Empty
                icon={<LayersIcon size={26} />}
                title="저장한 코디가 아직 없어요"
                className="py-10 md:py-12"
                action={
                  <ButtonLink to="/outfits" icon={<HangerIcon size={18} />}>
                    직접 조합하기
                  </ButtonLink>
                }
              >
                추천받은 코디를 저장하거나, 옷장에서 직접 골라 만들어 보세요.
              </Empty>
            ) : (
              <div className="scroll-x bleed-gutter snap-x snap-mandatory gap-3 md:mx-0 md:grid md:snap-none md:grid-cols-2 md:overflow-visible md:px-0">
                {sortedSaved.slice(0, 8).map((o) => (
                  <SavedOutfitCard key={o.id} outfit={o} onWear={() => wear(o.item_ids, o.id)} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <p className="mt-14 text-caption text-muted">
        날씨 데이터{" "}
        <a className="underline underline-offset-2 hover:text-ink" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo.com
        </a>{" "}
        (CC BY 4.0)
      </p>
    </Page>
  );
}

function SavedOutfitCard({ outfit, onWear }: { outfit: Outfit; onWear: () => void }) {
  const pending = outfit.id.startsWith("temp-");
  return (
    <Card className="flex w-[78%] shrink-0 snap-start flex-col md:w-auto">
      <AppLink to={`/outfits/${outfit.id}`} aria-disabled={pending} className={`pressable-soft block rounded-sm ${pending ? "pointer-events-none" : ""}`}>
        <h3 className="mb-3 truncate text-headline">{outfit.name}</h3>
        <OutfitCollage ids={outfit.item_ids} />
      </AppLink>
      <Button className="mt-4" block onClick={onWear}>
        오늘 입을래요
      </Button>
    </Card>
  );
}

function WeatherBlock({ weather, error, onRetry }: { weather: Weather | null; error: string | null; onRetry: () => void }) {
  if (!weather) {
    if (error)
      return (
        <Notice
          title="날씨를 불러오지 못했어요"
          action={
            <Button size="sm" onClick={onRetry}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      );
    return (
      <div role="status" aria-label="날씨를 불러오는 중">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-3 h-14 w-28" />
        <Skeleton className="mt-3 h-4 w-48" />
        <Skeleton className="mt-6 h-14 w-full rounded-lg" />
      </div>
    );
  }
  const big = Math.round(weather.temp_now ?? weather.temp_max);
  const swing = Math.round(weather.diurnal_range);
  return (
    <section aria-label="오늘 날씨">
      <AppLink to="/settings" className="inline-flex items-center gap-1 rounded-sm text-subhead font-medium text-muted hover:text-ink">
        <PinIcon size={15} /> {weather.location_name ?? "현재 위치"}
      </AppLink>
      <div className="mt-1 flex items-end gap-4">
        <div className="text-display md:text-[4.5rem] tabular">{big}°</div>
        <div className="pb-1.5 text-callout text-ink-2">{weather.description}</div>
      </div>
      <dl className="mt-5 grid grid-cols-4 divide-x divide-line rounded-lg bg-surface py-3 shadow-[0_0_0_1px_var(--line)]">
        {(
          [
            ["최저", `${Math.round(weather.temp_min)}°`],
            ["최고", `${Math.round(weather.temp_max)}°`],
            ["일교차", `${swing}°`],
            ["강수", weather.precip_probability != null ? `${weather.precip_probability}%` : "–"],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="px-3 text-center">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="mt-0.5 text-headline tabular">{value}</dd>
          </div>
        ))}
      </dl>
      {swing >= 10 && <p className="mt-3 text-subhead text-ink-2">일교차가 커요. 벗고 입기 쉬운 겉옷을 챙기세요.</p>}
    </section>
  );
}

function ProfileUsed({ used }: { used: boolean }) {
  if (used)
    return (
      <p className="mb-5 flex items-center gap-1.5 text-footnote text-muted">
        <PersonIcon size={16} /> 내 퍼스널 컬러와 체형을 반영했어요
      </p>
    );
  return (
    <AppLink to="/profile" className="mb-5 inline-flex items-center gap-1 rounded-sm text-footnote text-muted hover:text-ink">
      <PersonIcon size={16} /> 퍼스널 컬러·체형 진단을 하면 추천에 반영돼요 <ChevronRightIcon size={14} />
    </AppLink>
  );
}

/** 이번 추천에 "섞어 달라"고 넘긴 장롱템. 실제로 코디에 들어간 것은 표시한다. */
function DormantStrip({ dormant, outfits, byId }: { dormant: DormantItem[]; outfits: SuggestedOutfit[]; byId: Map<string, Item> }) {
  const used = new Set(outfits.flatMap((o) => o.item_ids));
  const list = dormant.filter((d) => byId.has(d.item_id));
  if (!list.length) return null;
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-subhead font-semibold">장롱템 꺼내 입기</h3>
      <p className="mb-3 text-footnote text-muted">오래 안 입었거나 1회당 가격이 높은 옷을 코디에 섞어 달라고 했어요.</p>
      <div className="scroll-x bleed-gutter gap-3 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {list.map((d) => {
          const it = byId.get(d.item_id)!;
          const inOutfit = used.has(d.item_id);
          return (
            <AppLink key={d.item_id} to={`/closet/${d.item_id}`} className="pressable-soft flex w-[228px] shrink-0 items-center gap-3 rounded-md bg-surface p-2 pr-3 shadow-[0_0_0_1px_var(--line)]">
              <ItemImage item={it} showName={false} className="w-12 shrink-0 rounded-sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-subhead font-medium">{it.name}</span>
                <span className="block truncate text-caption text-muted">{d.reason}</span>
                {inOutfit && <span className="mt-0.5 block text-caption font-semibold text-ink">추천 코디에 들어갔어요</span>}
              </span>
            </AppLink>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionCard({ outfit: o, saved, dormant, byId, onSave, onWear }: { outfit: SuggestedOutfit; saved: boolean; dormant?: DormantItem[]; byId: Map<string, Item>; onSave: () => void; onWear: () => void }) {
  const revived = (dormant ?? []).filter((d) => o.item_ids.includes(d.item_id) && byId.has(d.item_id));
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-headline">{o.title}</h3>
        {revived.length > 0 && <Badge>장롱템 포함</Badge>}
      </div>
      <p className="mt-1 mb-4 text-subhead text-muted">{o.reason}</p>
      {revived.length > 0 && <p className="-mt-2 mb-4 text-footnote text-ink-2">다시 꺼내 입는 옷: {revived.map((d) => byId.get(d.item_id)?.name).join(", ")}</p>}
      <div className="mt-auto">
        <OutfitCollage ids={o.item_ids} />
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" icon={saved ? <CheckIcon size={18} /> : undefined} disabled={saved} onClick={onSave}>
            {saved ? "저장됨" : "저장"}
          </Button>
          <Button variant="primary" className="flex-1" onClick={onWear}>
            오늘 입을래요
          </Button>
        </div>
      </div>
    </Card>
  );
}

type SimilarContext = { weather: Weather | null; lat: number; lon: number; location_name: string };
const MODES = [
  { value: "similar" as const, label: "시밀러룩" },
  { value: "couple" as const, label: "커플룩" },
];

/** 시밀러룩 / 커플룩: 상대가 입을 옷(사진·설명)에 어울리는 내 옷장 코디 */
function SimilarLook({
  disabled,
  context,
  savedTitles,
  onSave,
  onWear,
}: {
  disabled: boolean;
  context: SimilarContext | null;
  savedTitles: Set<string>;
  onSave: (o: SuggestedOutfit, mode: SimilarLookResult["mode"]) => void;
  onWear: (ids: string[]) => void;
}) {
  const { byId } = useItems();
  const [mode, setMode] = useState<SimilarLookResult["mode"]>(similarMemo?.mode ?? "similar");
  const [description, setDescription] = useState(similarMemo?.description ?? "");
  const [photo, setPhoto] = useState<{ url: string; key: string | null; blob: Blob | null } | null>(similarMemo?.photoKey ? { url: `/api/images/${similarMemo.photoKey}`, key: similarMemo.photoKey, blob: null } : null);
  const [result, setResult] = useState<SimilarLookResult | null>(similarMemo?.result ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 업로드 뒤 key만 채워 넣을 때는 같은 주소라서 정리하지 않는다 (주소가 바뀌거나 화면을 떠날 때만)
  const photoUrl = photo?.blob ? photo.url : null;
  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );

  const ready = !!photo || description.trim().length > 0;

  const run = async (refresh = false) => {
    setBusy(true);
    setErr(null);
    try {
      let key = photo?.key ?? null;
      if (photo && !key && photo.blob) {
        key = await uploadImage(photo.blob);
        setPhoto((p) => (p ? { ...p, key } : p));
      }
      const r = await api<SimilarLookResult>("/stylist/similar", {
        method: "POST",
        json: { mode, partner_image_key: key ?? undefined, partner_description: description.trim() || undefined, ...(context ?? {}), refresh },
      });
      similarMemo = { result: r, mode, description, photoKey: key };
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="시밀러룩 · 커플룩" description="같이 만날 사람이 입을 옷을 알려 주면 내 옷장에서 어울리는 코디를 골라 드려요.">
      <Card>
        <Segmented label="맞추는 방식" value={mode} onChange={setMode} options={MODES} className="md:max-w-xs" />
        <p className="mt-2 text-footnote text-muted">{mode === "similar" ? "색감·소재·무드를 비슷하게 맞춰요." : "한 끗 다르게, 같이 섰을 때 잘 어울리게 맞춰요."}</p>
        <div className="mt-4 flex gap-3">
          {photo ? (
            <div className="relative w-24 shrink-0">
              <Img src={photo.url} ratio="3 / 4" className="rounded-md" alt="상대 옷차림 사진" />
              <IconButton label="사진 빼기" variant="filled" className="absolute -top-2 -right-2 size-8 shadow-2" onClick={() => setPhoto(null)}>
                <CloseIcon size={16} />
              </IconButton>
            </div>
          ) : (
            <PhotoInput
              label="상대 옷차림 사진 고르기"
              className="pressable grid w-24 shrink-0 place-items-center rounded-md bg-surface-2 text-muted hover:bg-surface-3"
              onPick={(b) => setPhoto({ url: URL.createObjectURL(b), key: null, blob: b })}
            >
              <span className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 text-caption">
                <ImageIcon size={22} />
                사진
              </span>
            </PhotoInput>
          )}
          <Field label="상대 옷차림 설명" className="min-w-0 flex-1">
            <Textarea className="min-h-[7.5rem]" maxLength={500} placeholder="예: 연청 데님 셔츠에 베이지 치노, 흰 스니커즈" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" icon={<SparkIcon size={18} />} loading={busy} disabled={!ready || disabled} onClick={() => run(false)}>
            {busy ? "코디를 맞추는 중" : "어울리는 코디 찾기"}
          </Button>
          {result && (
            <IconButton label="다시 추천받기" variant="filled" className="size-11" disabled={busy} onClick={() => run(true)}>
              <RefreshIcon size={18} />
            </IconButton>
          )}
        </div>
        {!ready && !result && <p className="mt-2 text-footnote text-muted">사진이나 설명 중 하나만 있어도 돼요.</p>}
        {err && (
          <Notice
            className="mt-3"
            title="코디를 맞추지 못했어요"
            action={
              <Button size="sm" onClick={() => run(false)}>
                다시 시도
              </Button>
            }
          >
            {err}
          </Notice>
        )}
      </Card>

      {busy ? (
        <div role="status" aria-label="코디를 맞추는 중" className="mt-5 grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <Skeleton className="h-5 w-2/5" />
              <SkeletonText lines={2} className="mt-3" />
              <div className="mt-4 grid grid-cols-4 gap-1.5">
                {[0, 1, 2, 3].map((j) => (
                  <Skeleton key={j} className="aspect-[3/4]" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : result ? (
        <div className="mt-5">
          {result.partner_summary && (
            <p className="mb-5 max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">
              <span className="mr-1.5 font-semibold text-ink">{result.mode === "couple" ? "커플룩" : "시밀러룩"}</span>
              {result.partner_summary}
            </p>
          )}
          {result.outfits.length === 0 ? (
            <Empty title="어울리는 조합을 찾지 못했어요">설명을 조금 더 자세히 적거나 옷을 더 등록해 보세요.</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {result.outfits.map((o, i) => (
                <SuggestionCard key={i} outfit={o} saved={savedTitles.has(o.title)} byId={byId} onSave={() => onSave(o, result.mode)} onWear={() => onWear(o.item_ids)} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Section>
  );
}
