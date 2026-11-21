import { useState } from "react";
import { useParams } from "react-router";
import type { ChecklistEntry, Item, Trip, TripDayWeather, TripWeather } from "../../shared/types";
import { CheckIcon, PencilIcon, PinIcon, PlusIcon, RefreshIcon, SparkIcon, SuitcaseIcon, TrashIcon } from "../components/icons";
import { ItemImage, OutfitCollage } from "../components/items";
import { TripForm } from "../components/TripForm";
import { Badge, Button, Card, Empty, IconButton, Input, Notice, Page, Section, Skeleton, SkeletonText, confirmDialog, toast } from "../components/ui";
import { AiOffNotice } from "../components/AiStatus";
import { api } from "../lib/api";
import { todayKST, useItems } from "../lib/items";
import { formatDateTime } from "../lib/profile";
import { mutateQuery, useQuery } from "../lib/query";
import { AppLink, useGoBack } from "../lib/router";
import { TRIPS_PATH, dday, nightsLabel, removeTrip, setTrip, shortDate, tripPath } from "../lib/trips";

const WEATHER_STATUS: Record<TripWeather["status"], string> = { forecast: "전 일정 예보", partial: "일부 날짜만 예보", unavailable: "예보 없음" };

export default function TripDetail() {
  const { id } = useParams();
  return <TripView key={id} id={id!} />;
}

function TripView({ id }: { id: string }) {
  const goBack = useGoBack();
  const list = useQuery<Trip[]>(TRIPS_PATH);
  const detail = useQuery<Trip>(tripPath(id));
  const trip = detail.data ?? list.data?.find((t) => t.id === id) ?? null;
  const { byId } = useItems();
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);

  if (!trip)
    return (
      <Page title="여행" back="/travel">
        {detail.loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <SkeletonText lines={3} />
          </div>
        ) : (
          <Empty icon={<SuitcaseIcon size={26} />} title="여행을 찾을 수 없어요" action={<Button onClick={() => goBack("/travel")}>여행 목록으로</Button>}>
            {detail.error && detail.error !== "여행을 찾을 수 없어요" ? detail.error : "삭제되었거나 주소가 잘못되었어요."}
          </Empty>
        )}
      </Page>
    );

  const plan = async (force: boolean) => {
    if (force && trip.plan && !(await confirmDialog({ title: "계획을 다시 만들까요?", message: "최신 예보와 지금 옷장으로 다시 골라요. 챙김 표시와 직접 추가한 준비물은 그대로 남아요.", confirmLabel: "다시 만들기" }))) return;
    setPlanning(true);
    setPlanErr(null);
    try {
      setTrip(await api<Trip>(`/trips/${trip.id}/plan${force ? "?force=true" : ""}`, { method: "POST", json: { force } }));
      toast(force ? "계획을 새로 만들었어요" : "짐 싸기 계획을 만들었어요");
    } catch (e) {
      setPlanErr((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "이 여행을 삭제할까요?", message: "계획과 체크리스트가 함께 사라져요.", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/trips/${trip.id}`, { method: "DELETE" });
      goBack("/travel");
      removeTrip(trip.id);
      toast("삭제했어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const d = dday(trip, todayKST());

  return (
    <Page
      title={trip.name}
      eyebrow={
        <span className="tabular">
          {shortDate(trip.start_date)} – {shortDate(trip.end_date)} · {nightsLabel(trip)} · {d.label}
        </span>
      }
      back="/travel"
      large
      right={
        <>
          <IconButton label="여행 정보 고치기" onClick={() => setEditing(true)}>
            <PencilIcon size={20} />
          </IconButton>
          <IconButton label="여행 삭제" className="text-danger" onClick={remove}>
            <TrashIcon size={20} />
          </IconButton>
        </>
      }
    >
      <AiOffNotice className="mb-6" />
      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-subhead text-muted">
        <span className="inline-flex items-center gap-1">
          <PinIcon size={16} /> {trip.location_name ?? trip.destination}
        </span>
        {trip.notes && <span className="text-ink-2">{trip.notes}</span>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-10">
          {planning ? (
            <div role="status" className="space-y-4">
              <p className="flex items-center gap-2 text-subhead font-medium text-muted">
                <SparkIcon size={18} /> 일기예보를 확인하고 돌려 입을 옷을 고르는 중이에요
              </p>
              <Skeleton className="h-24 rounded-lg" />
              <SkeletonText lines={2} />
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="aspect-[3/4]" />
                ))}
              </div>
            </div>
          ) : !trip.plan ? (
            <>
              <Empty
                icon={<SparkIcon size={26} />}
                title="짐 싸기 계획 만들기"
                className="py-10 md:py-14"
                action={
                  <Button variant="primary" icon={<SparkIcon size={18} />} onClick={() => plan(false)}>
                    계획 만들기
                  </Button>
                }
              >
                출발 2주 안쪽이면 실제 일기예보를, 그보다 멀면 계절과 메모를 보고 골라요. 상·하의를 돌려 입어 매일 다른 느낌이 나도록 최소한만 챙겨요.
              </Empty>
              {planErr && (
                <Notice title="계획을 만들지 못했어요" action={<Button size="sm" onClick={() => plan(false)}>다시 시도</Button>}>
                  {planErr}
                </Notice>
              )}
            </>
          ) : (
            <>
              {planErr && <Notice title="계획을 다시 만들지 못했어요">{planErr}</Notice>}
              <WeatherCard weather={trip.plan.weather} />
              {trip.plan.summary && <p className="max-w-prose border-l-2 border-ink pl-4 text-body text-ink-2">{trip.plan.summary}</p>}

              <Section title={`캡슐 옷장 ${trip.plan.capsule_item_ids.filter((x) => byId.has(x)).length}벌`} description="이 옷들만 챙기면 일정 내내 돌려 입을 수 있어요.">
                <div className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-5">
                  {trip.plan.capsule_item_ids
                    .map((x) => byId.get(x))
                    .filter((x): x is Item => !!x)
                    .map((i) => (
                      <AppLink key={i.id} to={`/closet/${i.id}`} className="pressable-soft block min-w-0">
                        <ItemImage item={i} showName={false} className="rounded-sm" />
                        <span className="mt-1.5 block truncate text-footnote">{i.name}</span>
                      </AppLink>
                    ))}
                </div>
              </Section>

              <Section title="날짜별 코디">
                <ol className="space-y-3">
                  {trip.plan.days.map((day) => {
                    const w = trip.plan!.weather.days.find((x) => x.date === day.date);
                    return (
                      <li key={day.day}>
                        <Card>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-eyebrow text-muted">{day.day}일차</div>
                              <div className="text-headline tabular">{shortDate(day.date)}</div>
                            </div>
                            <DayWeather w={w} />
                          </div>
                          {day.note && <p className="mt-2 text-subhead text-ink-2">{day.note}</p>}
                          <div className="mt-3">
                            {day.item_ids.length ? <OutfitCollage ids={day.item_ids} max={5} /> : <p className="text-subhead text-muted">이날은 정해 둔 코디가 없어요.</p>}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ol>
              </Section>

              {trip.plan.tips.length > 0 && (
                <Section title="여행 팁">
                  <ul className="space-y-2">
                    {trip.plan.tips.map((t, i) => (
                      <li key={i} className="flex gap-2.5 text-callout text-ink-2">
                        <CheckIcon size={18} className="mt-0.5 shrink-0 text-ink" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button icon={<RefreshIcon size={18} />} onClick={() => plan(true)}>
                  최신 예보로 다시 계획
                </Button>
                <span className="text-footnote text-muted">{formatDateTime(trip.plan.generated_at)}에 만들었어요</span>
              </div>
            </>
          )}
        </div>

        <div className="min-w-0 xl:sticky xl:top-[calc(var(--safe-top)+var(--bar-h)+8px)] xl:self-start">
          <Checklist trip={trip} byId={byId} />
        </div>
      </div>

      <TripForm open={editing} trip={trip} onClose={() => setEditing(false)} onSaved={() => {
        setEditing(false);
        toast("저장했어요");
      }} />
    </Page>
  );
}

function WeatherCard({ weather: w }: { weather: TripWeather }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-headline">현지 날씨</h2>
        <Badge tone={w.status === "unavailable" ? "neutral" : "solid"}>{WEATHER_STATUS[w.status]}</Badge>
        {w.location_name && <span className="text-footnote text-muted">{w.location_name}</span>}
      </div>
      {w.message && <p className="mt-1.5 text-subhead text-muted">{w.message}</p>}
      {w.days.length > 0 && (
        <ul className="scroll-x bleed-gutter mt-4 gap-2 md:mx-0 md:flex-wrap md:px-0">
          {w.days.map((d) => (
            <li key={d.date} className="w-[92px] shrink-0 rounded-md bg-surface-2 px-2.5 py-2 text-center">
              <div className="text-caption text-muted tabular">{shortDate(d.date)}</div>
              <div className="mt-0.5 truncate text-footnote">{d.description}</div>
              <div className="mt-1 text-subhead font-semibold tabular">
                {Math.round(d.temp_min)}° / {Math.round(d.temp_max)}°
              </div>
              {d.precip_probability != null && <div className="text-caption text-muted tabular">비 {d.precip_probability}%</div>}
            </li>
          ))}
        </ul>
      )}
      {w.status === "partial" && <p className="mt-3 text-footnote text-muted">예보가 없는 날은 기온을 표시하지 않고, 계절과 메모를 기준으로 골랐어요.</p>}
    </Card>
  );
}

function DayWeather({ w }: { w: TripDayWeather | undefined }) {
  if (!w) return <span className="shrink-0 text-footnote text-muted">예보 없음</span>;
  return (
    <span className="shrink-0 text-right">
      <span className="block text-subhead font-semibold tabular">
        {Math.round(w.temp_min)}° / {Math.round(w.temp_max)}°
      </span>
      <span className="block text-caption text-muted">
        {w.description}
        {w.precip_probability != null && ` · 비 ${w.precip_probability}%`}
      </span>
    </span>
  );
}

/* ───────── 짐 체크리스트 ───────── */

function Checklist({ trip, byId }: { trip: Trip; byId: Map<string, Item> }) {
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = trip.checklist;
  const packed = list.filter((c) => c.packed).length;
  const all = list.length > 0 && packed === list.length;

  /** 화면을 먼저 바꾸고 보낸다. 실패하면 되돌린다. */
  const optimisticTrip = async (next: (t: Trip) => Trip, req: () => Promise<Trip>) => {
    const before = trip;
    setErr(null);
    mutateQuery<Trip>(tripPath(trip.id), next(trip));
    try {
      setTrip(await req());
    } catch (e) {
      mutateQuery<Trip>(tripPath(trip.id), before);
      setErr((e as Error).message);
    }
  };

  const toggle = (c: ChecklistEntry) =>
    optimisticTrip(
      (t) => ({ ...t, checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, packed: !x.packed } : x)) }),
      () => api<Trip>(`/trips/${trip.id}/checklist/${c.id}`, { method: "PATCH", json: { packed: !c.packed } }),
    );
  const setAll = (v: boolean) =>
    optimisticTrip(
      (t) => ({ ...t, checklist: t.checklist.map((x) => ({ ...x, packed: v })) }),
      () => api<Trip>(`/trips/${trip.id}/checklist`, { method: "PUT", json: { packed: v } }),
    );
  const remove = (c: ChecklistEntry) =>
    optimisticTrip(
      (t) => ({ ...t, checklist: t.checklist.filter((x) => x.id !== c.id) }),
      () => api<Trip>(`/trips/${trip.id}/checklist/${c.id}`, { method: "DELETE" }),
    );
  const add = async () => {
    const v = label.trim();
    if (!v) return;
    setAdding(true);
    setErr(null);
    try {
      setTrip(await api<Trip>(`/trips/${trip.id}/checklist`, { method: "POST", json: { label: v } }));
      setLabel("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const clothes = list.filter((c) => c.kind === "item");
  const extras = list.filter((c) => c.kind === "extra");

  return (
    <Section
      title="짐 체크리스트"
      action={
        list.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
            {all ? "모두 해제" : "모두 챙김"}
          </Button>
        )
      }
    >
      <div className="mb-4">
        <div className="flex justify-between text-subhead tabular">
          <span className="font-medium">{list.length ? (all ? "다 챙겼어요" : `${list.length - packed}개 남았어요`) : "아직 항목이 없어요"}</span>
          <span className="text-muted">
            {packed}/{list.length}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="짐 챙긴 정도" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={packed}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-(--dur-slow)" style={{ width: list.length ? `${(packed / list.length) * 100}%` : 0 }} />
        </div>
      </div>

      {clothes.length > 0 && <Group title="옷" entries={clothes} byId={byId} onToggle={toggle} onRemove={remove} />}
      {extras.length > 0 && <Group title="준비물" entries={extras} byId={byId} onToggle={toggle} onRemove={remove} />}
      {list.length === 0 && <p className="mb-4 text-subhead text-muted">계획을 만들면 캡슐 옷과 준비물이 채워져요. 직접 추가해도 돼요.</p>}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input aria-label="준비물 추가" placeholder="준비물 추가 (예: 보조배터리)" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} enterKeyHint="done" />
        <Button type="submit" className="h-12" icon={<PlusIcon size={18} />} loading={adding} disabled={!label.trim()}>
          추가
        </Button>
      </form>
      <Notice className="mt-3">{err}</Notice>
    </Section>
  );
}

const SOURCE: Record<ChecklistEntry["source"], string | null> = { plan: null, ai: "AI", user: "직접" };

function Group({ title, entries, byId, onToggle, onRemove }: { title: string; entries: ChecklistEntry[]; byId: Map<string, Item>; onToggle: (c: ChecklistEntry) => void; onRemove: (c: ChecklistEntry) => void }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 px-1 text-footnote font-medium text-muted">
        {title} <span className="tabular">{entries.filter((e) => e.packed).length}/{entries.length}</span>
      </h3>
      <ul className="divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
        {entries.map((c) => {
          const item = c.item_id ? byId.get(c.item_id) : undefined;
          return (
            <li key={c.id} className="flex items-center gap-1 pr-1">
              <button type="button" role="checkbox" aria-checked={c.packed} onClick={() => onToggle(c)} className="flex min-h-13 min-w-0 flex-1 items-center gap-3 py-1.5 pl-3 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2">
                <span
                  aria-hidden
                  className={`grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-(--dur-fast) ${c.packed ? "bg-accent text-accent-ink" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)]"}`}
                >
                  {c.packed && <CheckIcon size={14} strokeWidth={2.4} />}
                </span>
                {item && <ItemImage item={item} showName={false} className="w-8 shrink-0 rounded-xs" />}
                <span className={`min-w-0 flex-1 truncate text-callout ${c.packed ? "text-muted line-through decoration-1" : ""}`}>{c.label}</span>
                {SOURCE[c.source] && <span className="shrink-0 text-caption text-muted">{SOURCE[c.source]}</span>}
              </button>
              <IconButton label={`${c.label} 빼기`} onClick={() => onRemove(c)} className="text-muted">
                <TrashIcon size={17} />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
