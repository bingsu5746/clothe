import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Item, Outfit, SuggestedOutfit, Weather } from "../../shared/types";
import { PinIcon, SparkIcon } from "../components/icons";
import { OutfitCollage } from "../components/items";
import { Button, Card, Chip, Empty, ErrorText, PageHeader, Spinner, inputCls, toast } from "../components/ui";
import { api } from "../lib/api";
import { useFetch, useItems } from "../lib/items";
import { getSavedLocation, type SavedLocation } from "../lib/location";
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

export default function Today() {
  const { items, byId } = useItems();
  const [loc, setLoc] = useState<SavedLocation | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherErr, setWeatherErr] = useState<string | null>(null);
  const [keywords, setKeywords] = useState("");
  const [result, setResult] = useState<TodayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saved = useFetch<Outfit[]>("/outfits");

  useEffect(() => {
    getSavedLocation().then(setLoc);
  }, []);

  useEffect(() => {
    if (!loc) return;
    loadWeather(loc.lat, loc.lon, loc.name)
      .then(setWeather)
      .catch((e) => setWeatherErr(e.message));
  }, [loc]);

  const recommend = useCallback(
    async (refresh = false) => {
      if (!loc) return;
      setBusy(true);
      setErr(null);
      try {
        const r = await api<TodayResult>("/stylist/today", {
          method: "POST",
          json: { weather, lat: loc.lat, lon: loc.lon, location_name: loc.name, keywords, refresh },
        });
        setResult(r);
        if (r.weather) setWeather(r.weather);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loc, keywords, weather],
  );

  const toggleKeyword = (k: string) => {
    const parts = keywords.split(",").map((s) => s.trim()).filter(Boolean);
    setKeywords((parts.includes(k) ? parts.filter((p) => p !== k) : [...parts, k]).join(", "));
  };

  const weatherSummary = weather ? `${weather.description} ${weather.temp_min}~${weather.temp_max}°C` : undefined;

  const sortedSaved = useMemo(() => {
    const list = saved.data ?? [];
    if (!weather) return list;
    const t = targetWarmth(weather);
    return [...list].sort((a, b) => {
      const da = Math.abs((outfitWarmth(a.item_ids, byId) ?? t) - t);
      const db = Math.abs((outfitWarmth(b.item_ids, byId) ?? t) - t);
      return da - db;
    });
  }, [saved.data, weather, byId]);

  const wear = async (ids: string[], outfit_id?: string) => {
    await api("/items/wear", { method: "POST", json: { item_ids: ids, outfit_id, weather_summary: weatherSummary } });
    toast("오늘 착용으로 기록했어요");
  };

  const save = async (o: SuggestedOutfit) => {
    await api("/outfits", { method: "POST", json: { name: o.title, item_ids: o.item_ids, source: "ai", reason: o.reason, tags: keywords ? keywords.split(",").map((s) => s.trim()) : [] } });
    toast("코디를 저장했어요");
    saved.reload();
  };

  return (
    <>
      <PageHeader title="오늘 뭐 입지?" />

      <Card className="mb-4">
        {weather ? (
          <div className="flex items-end justify-between gap-4">
            <div>
              <Link to="/settings" className="mb-1 inline-flex items-center gap-1 text-sm text-muted">
                <PinIcon width={14} height={14} /> {weather.location_name ?? "현재 위치"}
              </Link>
              <div className="text-4xl font-extrabold tracking-tight">{weather.temp_now != null ? `${Math.round(weather.temp_now)}°` : `${Math.round(weather.temp_max)}°`}</div>
              <div className="text-sm text-muted">
                {weather.description} · 최저 {Math.round(weather.temp_min)}° / 최고 {Math.round(weather.temp_max)}°
                {weather.precip_probability != null && ` · 강수 ${weather.precip_probability}%`}
              </div>
            </div>
            <div className={`rounded-xl px-3 py-2 text-right ${weather.diurnal_range >= 10 ? "bg-accent text-accent-ink" : "bg-surface-2"}`}>
              <div className="text-xs font-semibold opacity-80">일교차</div>
              <div className="text-xl font-bold">{Math.round(weather.diurnal_range)}°</div>
            </div>
          </div>
        ) : weatherErr ? (
          <ErrorText>{weatherErr}</ErrorText>
        ) : (
          <div className="flex h-20 items-center justify-center text-muted">
            <Spinner />
          </div>
        )}
        {weather && weather.diurnal_range >= 10 && <p className="mt-3 text-sm">일교차가 커요. 벗고 입기 쉬운 겉옷을 챙기세요.</p>}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-2 font-bold">AI 코디 추천</h2>
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {QUICK.map((k) => (
            <Chip key={k} active={keywords.split(",").map((s) => s.trim()).includes(k)} onClick={() => toggleKeyword(k)}>
              {k}
            </Chip>
          ))}
        </div>
        <input className={inputCls} placeholder="예: 한강 피크닉, 많이 걸어요" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <div className="mt-3 flex gap-2">
          <Button variant="primary" className="flex-1" loading={busy} onClick={() => recommend(false)} disabled={!loc || items.length < 2}>
            <SparkIcon width={18} height={18} /> 코디 추천받기
          </Button>
          {result && (
            <Button onClick={() => recommend(true)} disabled={busy}>
              다시
            </Button>
          )}
        </div>
        {items.length < 2 && (
          <p className="mt-2 text-sm text-muted">
            추천을 받으려면 <Link to="/closet/new" className="font-semibold text-accent underline">옷장에 옷을 2벌 이상</Link> 등록해 주세요.
          </p>
        )}
        <div className="mt-3">
          <ErrorText>{err}</ErrorText>
        </div>
      </Card>

      {result && (
        <section className="mb-8">
          {result.briefing && <p className="mb-3 rounded-2xl bg-surface-2 px-4 py-3 text-[15px]">{result.briefing}</p>}
          {result.outfits.length === 0 && <Empty title="추천할 만한 조합을 찾지 못했어요">옷을 더 등록하거나 키워드를 바꿔 보세요.</Empty>}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {result.outfits.map((o, i) => (
              <Card key={i}>
                <h3 className="font-bold">{o.title}</h3>
                <p className="mt-1 mb-3 text-sm text-muted">{o.reason}</p>
                <OutfitCollage ids={o.item_ids} />
                <div className="mt-3 flex gap-2">
                  <Button className="flex-1" onClick={() => save(o)}>저장</Button>
                  <Button variant="primary" className="flex-1" onClick={() => wear(o.item_ids)}>오늘 입을래요</Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold">저장한 코디에서 고르기</h2>
          <Link to="/outfits" className="text-sm font-semibold text-muted">전체 보기</Link>
        </div>
        {weather && sortedSaved.length > 0 && <p className="-mt-2 mb-3 text-xs text-muted">오늘 기온에 맞는 순서로 보여 드려요</p>}
        {saved.loading ? (
          <Spinner />
        ) : sortedSaved.length === 0 ? (
          <Empty title="아직 저장한 코디가 없어요">AI 추천에서 저장하거나 코디 탭에서 직접 만들어 보세요.</Empty>
        ) : (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:px-0">
            {sortedSaved.slice(0, 9).map((o) => (
              <Card key={o.id} className="w-64 shrink-0 snap-start md:w-auto">
                <Link to={`/outfits/${o.id}`}>
                  <h3 className="mb-2 truncate font-bold">{o.name}</h3>
                  <OutfitCollage ids={o.item_ids} />
                </Link>
                <Button variant="primary" className="mt-3 w-full" onClick={() => wear(o.item_ids, o.id)}>오늘 입을래요</Button>
              </Card>
            ))}
          </div>
        )}
      </section>
      <p className="mt-10 text-center text-xs text-muted">
        날씨 데이터: <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0)
      </p>
    </>
  );
}
