import { useCallback, useEffect, useMemo, useState } from "react";
import type { Item, Outfit, SuggestedOutfit, Weather } from "../../shared/types";
import { CheckIcon, HangerIcon, LayersIcon, PinIcon, PlusIcon, RefreshIcon, SparkIcon } from "../components/icons";
import { OutfitCollage } from "../components/items";
import { Button, ButtonLink, Card, Chip, ChipRow, Empty, Input, Notice, Page, Section, Skeleton, SkeletonText, toast } from "../components/ui";
import { api } from "../lib/api";
import { createOutfit, useItems, useOutfits, wearItems } from "../lib/items";
import { DEFAULT_LOCATION, type SavedLocation } from "../lib/location";
import { useQuery } from "../lib/query";
import { AppLink } from "../lib/router";
import { loadWeather } from "../lib/weather";

const QUICK = ["출근", "데이트", "많이 걷는 날", "편하게", "꾸안꾸", "격식 있게", "운동"];

interface TodayResult {
  weather: Weather | null;
  briefing: string;
  outfits: SuggestedOutfit[];
}

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

  const fetchWeather = useCallback(async (l: SavedLocation) => {
    const key = `${l.lat},${l.lon}`;
    try {
      const w = await loadWeather(l.lat, l.lon, l.name);
      weatherMemo = { key, at: Date.now(), weather: w };
      setWeather(w);
      setWeatherErr(null);
    } catch (e) {
      setWeatherErr((e as Error).message || "날씨를 불러오지 못했어요");
    }
  }, []);

  useEffect(() => {
    if (!loc || !locKey) return;
    if (weatherMemo && weatherMemo.key === locKey && Date.now() - weatherMemo.at < 20 * 60_000) return;
    void fetchWeather(loc);
    // 위치 좌표가 바뀔 때만 다시 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey, fetchWeather]);

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
    try {
      await wearItems(ids, { outfit_id, weather_summary: weatherSummary });
      toast("오늘 입은 걸로 기록했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const save = async (o: SuggestedOutfit) => {
    // 버튼은 바로 "저장됨"으로 바뀌고, 실패하면 되돌린다
    setSavedTitles((s) => new Set(s).add(o.title));
    try {
      await createOutfit({ name: o.title, item_ids: o.item_ids, source: "ai", reason: o.reason, tags: active });
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
      <div className="grid gap-x-16 gap-y-10 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-10 xl:sticky xl:top-[calc(var(--safe-top)+var(--bar-h)+8px)] xl:self-start">
          <WeatherBlock weather={weather} error={weatherErr} onRetry={() => loc && fetchWeather(loc)} />

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
                  {result.briefing && <p className="mb-5 max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">{result.briefing}</p>}
                  {result.outfits.length === 0 ? (
                    <Empty title="어울리는 조합을 찾지 못했어요">옷을 더 등록하거나 상황을 바꿔서 다시 받아 보세요.</Empty>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {result.outfits.map((o, i) => {
                        const isSaved = savedTitles.has(o.title);
                        return (
                          <Card key={i} className="flex flex-col">
                            <h3 className="text-headline">{o.title}</h3>
                            <p className="mt-1 mb-4 text-subhead text-muted">{o.reason}</p>
                            <div className="mt-auto">
                              <OutfitCollage ids={o.item_ids} />
                              <div className="mt-4 flex gap-2">
                                <Button className="flex-1" icon={isSaved ? <CheckIcon size={18} /> : undefined} disabled={isSaved} onClick={() => save(o)}>
                                  {isSaved ? "저장됨" : "저장"}
                                </Button>
                                <Button variant="primary" className="flex-1" onClick={() => wear(o.item_ids)}>
                                  오늘 입을래요
                                </Button>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : null}
            </Section>
          )}

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

      <p className="mt-14 text-caption text-faint">
        날씨 데이터{" "}
        <a className="underline underline-offset-2 hover:text-muted" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
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
