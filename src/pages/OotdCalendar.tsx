import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import type { Item, OutfitLog } from "../../shared/types";
import { CalendarIcon, CameraIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, PencilIcon, PlusIcon, TrashIcon } from "../components/icons";
import { ItemImage, ItemPicker, OutfitCollage, PhotoInput } from "../components/items";
import { OutfitsTabs } from "../components/OutfitsTabs";
import { Badge, Button, ButtonLink, Card, Empty, Field, IconButton, Img, Input, Notice, Page, Sheet, Skeleton, Textarea, buttonClass, confirmDialog, toast } from "../components/ui";
import { api, imageUrl, uploadImage } from "../lib/api";
import { todayKST, useItems } from "../lib/items";
import { Rating, Stars, TagEditor } from "../components/Rating";
import { OCCASIONS, addDays, applyLog, dayLabel, monthPath, removeLog } from "../lib/logs";
import { useQuery } from "../lib/query";
import { AppLink } from "../lib/router";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const isMonth = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function daysIn(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const monthTitle = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
};

export default function OotdCalendar() {
  const today = todayKST();
  const [params, setParams] = useSearchParams();
  const month = isMonth(params.get("month")) ? params.get("month")! : today.slice(0, 7);
  const dayParam = params.get("day");
  const day = isDate(dayParam) && dayParam.startsWith(month) ? dayParam : month === today.slice(0, 7) ? today : null;
  const { data, loading, error, reload } = useQuery<OutfitLog[]>(monthPath(month));
  const { byId } = useItems();
  const [editing, setEditing] = useState<OutfitLog | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);

  const go = (m: string, d?: string | null, focus = false) => {
    const next = new URLSearchParams();
    next.set("month", m);
    if (d) next.set("day", d);
    setParams(next, { replace: true, preventScrollReset: true });
    if (focus && d) {
      // 같은 달이면 칸이 이미 있으니 바로, 다른 달이면 그려진 뒤에(아래 효과) 포커스.
      // (화면 전환(View Transition) 때문에 새 달은 몇 프레임 뒤에 그려질 수 있어 requestAnimationFrame 으로는 놓쳤다)
      const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${d}"]`);
      if (el) el.focus();
      else pendingFocus.current = d;
    }
  };
  useEffect(() => {
    const d = pendingFocus.current;
    if (!d) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${d}"]`);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  const byDay = useMemo(() => {
    const m = new Map<string, OutfitLog[]>();
    for (const l of data ?? []) m.set(l.worn_date, [...(m.get(l.worn_date) ?? []), l]);
    return m;
  }, [data]);

  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, logs] of byDay) for (const id of new Set(logs.flatMap((l) => l.item_ids))) counts.set(id, (counts.get(id) ?? 0) + 1);
    const top = [...counts.entries()].filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1])[0];
    return { days: byDay.size, top: top ? { item: byId.get(top[0])!, n: top[1] } : null };
  }, [byDay, byId]);

  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const total = daysIn(month);
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const focusDay = day ?? `${month}-01`;

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    // 키를 빠르게 여러 번 눌러도 지금 포커스된 칸을 기준으로 움직인다
    const from = (e.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date ?? focusDay;
    let next: string | null = null;
    if (e.key in moves) next = addDays(from, moves[e.key]);
    else if (e.key === "PageUp") next = `${shiftMonth(month, -1)}-01`;
    else if (e.key === "PageDown") next = `${shiftMonth(month, 1)}-01`;
    else if (e.key === "Home") next = `${month}-01`;
    else if (e.key === "End") next = `${month}-${String(total).padStart(2, "0")}`;
    if (!next) return;
    e.preventDefault();
    go(next.slice(0, 7), next, true);
  };

  const logs = day ? (byDay.get(day) ?? []) : [];

  const remove = async (log: OutfitLog) => {
    if (!(await confirmDialog({ title: "이 착용 기록을 지울까요?", message: "기록에 든 옷의 착용 횟수도 1씩 줄어요.", confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/logs/${log.id}`, { method: "DELETE" });
      removeLog(log);
      toast("기록을 지웠어요");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Page
      title="코디"
      eyebrow={stats.days ? `${monthTitle(month)} · ${stats.days}일 기록` : undefined}
      right={
        <AppLink to={`/outfits/ootd${day ? `?date=${day}` : ""}`} aria-label="OOTD 기록" title="OOTD 기록하기" className={buttonClass({ variant: "primary", size: "sm" })}>
          <CameraIcon size={16} /> 기록
        </AppLink>
      }
    >
      <OutfitsTabs value="calendar" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <section aria-label="OOTD 달력" className="min-w-0">
          <div className="mb-3 flex items-center gap-1">
            <h2 className="mr-auto text-title-2 tabular" aria-live="polite">
              {monthTitle(month)}
            </h2>
            {month !== today.slice(0, 7) && (
              <Button size="sm" variant="ghost" onClick={() => go(today.slice(0, 7), today)}>
                오늘
              </Button>
            )}
            <IconButton label="이전 달" onClick={() => go(shiftMonth(month, -1))}>
              <ChevronLeftIcon size={20} />
            </IconButton>
            <IconButton label="다음 달" onClick={() => go(shiftMonth(month, 1))}>
              <ChevronRightIcon size={20} />
            </IconButton>
          </div>

          <div role="grid" aria-label={`${monthTitle(month)} 착용 기록`} ref={gridRef} onKeyDown={onGridKey}>
            <div role="row" className="mb-1.5 grid grid-cols-7 gap-1 md:gap-1.5">
              {WEEK.map((w, i) => (
                <div key={w} role="columnheader" className={`text-center text-caption font-medium ${i === 0 ? "text-danger" : "text-muted"}`}>
                  {w}
                </div>
              ))}
            </div>
            {Array.from({ length: cells.length / 7 }, (_, r) => (
              <div role="row" key={r} className="mb-1 grid grid-cols-7 gap-1 md:mb-1.5 md:gap-1.5">
                {cells.slice(r * 7, r * 7 + 7).map((d, i) =>
                  d ? (
                    <DayCell key={d} date={d} logs={byDay.get(d) ?? []} byId={byId} selected={d === day} isToday={d === today} future={d > today} focusable={d === focusDay} loading={loading} onSelect={() => go(month, d)} />
                  ) : (
                    <div role="gridcell" key={`e${i}`} />
                  ),
                )}
              </div>
            ))}
          </div>
          {error && !data && (
            <Notice
              className="mt-4"
              title="기록을 불러오지 못했어요"
              action={
                <Button size="sm" onClick={reload}>
                  다시 시도
                </Button>
              }
            >
              {error}
            </Notice>
          )}
          {stats.top && (
            <p className="mt-4 text-subhead text-muted">
              이번 달 가장 많이 입은 옷:{" "}
              <AppLink to={`/closet/${stats.top.item.id}`} className="font-semibold text-ink hover:underline">
                {stats.top.item.name}
              </AppLink>{" "}
              <span className="tabular">({stats.top.n}일)</span>
            </p>
          )}
        </section>

        <section aria-label={day ? `${dayLabel(day)} 기록` : "날짜를 고르세요"} className="min-w-0">
          {!day ? (
            <Empty icon={<CalendarIcon size={26} />} title="날짜를 골라 주세요" className="py-10">
              달력에서 날짜를 누르면 그날 입은 옷이 보여요.
            </Empty>
          ) : (
            <>
              <h2 className="mb-3 text-title-2">{dayLabel(day)}</h2>
              {loading ? (
                <Card>
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="mt-3 aspect-[4/1] w-full" />
                </Card>
              ) : logs.length === 0 ? (
                <Card className="text-center">
                  <p className="text-callout text-muted">{day > addDays(today, 1) ? "아직 오지 않은 날이에요." : "이날은 기록이 없어요."}</p>
                  {day <= addDays(today, 1) && (
                    <ButtonLink to={`/outfits/ootd?date=${day}`} className="mt-4" icon={<PlusIcon size={18} />}>
                      이날 입은 옷 기록하기
                    </ButtonLink>
                  )}
                </Card>
              ) : (
                <div className="space-y-4">
                  {logs.map((l) => (
                    <LogCard key={l.id} log={l} onEdit={() => setEditing(l)} onDelete={() => remove(l)} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <LogEditor log={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function DayCell({ date, logs, byId, selected, isToday, future, focusable, loading, onSelect }: { date: string; logs: OutfitLog[]; byId: Map<string, Item>; selected: boolean; isToday: boolean; future: boolean; focusable: boolean; loading: boolean; onSelect: () => void }) {
  const selfie = logs.find((l) => l.selfie_key)?.selfie_key ?? null;
  const firstItem = !selfie ? logs.flatMap((l) => l.item_ids).map((id) => byId.get(id)).find((i) => i?.image_key) : undefined;
  const n = Number(date.slice(8));
  const has = logs.length > 0;
  return (
    <div role="gridcell" aria-selected={selected}>
      <button
        type="button"
        data-date={date}
        tabIndex={focusable ? 0 : -1}
        aria-current={isToday ? "date" : undefined}
        onClick={onSelect}
        className={`pressable-soft relative block aspect-[3/4] w-full overflow-hidden rounded-sm text-left transition-shadow duration-(--dur-fast) ${has ? "bg-surface-2" : "bg-surface shadow-[inset_0_0_0_1px_var(--line)]"} ${selected ? "shadow-[0_0_0_2px_var(--ink)]" : ""} ${future ? "bg-transparent" : ""}`}
      >
        {loading ? (
          <span className="skeleton absolute inset-0 rounded-none" />
        ) : selfie ? (
          <img src={imageUrl(selfie)!} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : firstItem ? (
          <span className="absolute inset-[18%_10%_6%]">
            <img src={imageUrl(firstItem.image_key)!} alt="" loading="lazy" className="size-full rounded-xs object-cover" />
          </span>
        ) : null}
        {selfie && <span aria-hidden className="absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-black/45 to-transparent" />}
        <span
          className={`absolute top-1 left-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-caption font-semibold tabular ${
            isToday ? "bg-accent text-accent-ink" : selfie ? "text-white" : future ? "text-muted" : "text-ink-2"
          }`}
        >
          {/* 보이는 숫자가 접근 가능한 이름 안에 그대로 들어가도록 (음성 제어: "21 누르기") */}
          <span className="sr-only">{date.slice(5, 7).replace(/^0/, "")}월 </span>
          {n}
          <span className="sr-only">{`일 (${dayLabel(date).split("(")[1]}${has ? `, 기록 ${logs.length}개` : ""}${isToday ? ", 오늘" : ""}`}</span>
        </span>
        {logs.length > 1 && <span className="absolute right-1 bottom-1 rounded-full bg-black/60 px-1.5 text-[10px] leading-4 font-semibold text-white tabular">{logs.length}</span>}
      </button>
    </div>
  );
}

function LogCard({ log, onEdit, onDelete }: { log: OutfitLog; onEdit: () => void; onDelete: () => void }) {
  return (
    <Card>
      <div className="flex gap-4">
        {log.selfie_key && <Img src={imageUrl(log.selfie_key)} ratio="3 / 4" className="w-24 shrink-0 rounded-md sm:w-28" alt="OOTD 셀카" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-headline">{log.item_ids.length}벌</div>
              {log.rating ? <Stars value={log.rating} /> : <span className="text-footnote text-muted">평점 없음</span>}
            </div>
            <div className="-mt-1 -mr-1 flex shrink-0">
              <IconButton label="기록 고치기" onClick={onEdit}>
                <PencilIcon size={18} />
              </IconButton>
              <IconButton label="기록 지우기" className="text-danger" onClick={onDelete}>
                <TrashIcon size={18} />
              </IconButton>
            </div>
          </div>
          {log.occasion_tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {log.occasion_tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
          {log.weather_summary && <p className="mt-2 text-footnote text-muted">{log.weather_summary}</p>}
          {log.note && <p className="mt-2 text-subhead text-ink-2">{log.note}</p>}
        </div>
      </div>
      <div className="mt-4">
        <OutfitCollage ids={log.item_ids} max={5} />
      </div>
    </Card>
  );
}

/** 착용 기록 고치기: 옷, 날짜, 사진, 평점, 상황, 메모 */
function LogEditor({ log, onClose }: { log: OutfitLog | null; onClose: () => void }) {
  const [form, setForm] = useState<OutfitLog | null>(log);
  const [last, setLast] = useState<OutfitLog | null>(log);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { byId } = useItems();
  if (log !== last) {
    setLast(log);
    if (log) {
      setForm(log);
      setErr(null);
    }
  }
  const today = todayKST();
  const f = form;

  const save = async () => {
    if (!f || !log) return;
    setBusy("save");
    setErr(null);
    try {
      const body = { item_ids: f.item_ids, date: f.worn_date, rating: f.rating, occasion_tags: f.occasion_tags, note: f.note?.trim() || null, selfie_key: f.selfie_key };
      const saved = await api<OutfitLog>(`/logs/${log.id}`, { method: "PATCH", json: body });
      applyLog(saved, log);
      toast("기록을 고쳤어요");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const changePhoto = async (b: Blob) => {
    setBusy("photo");
    try {
      const key = await uploadImage(b);
      setForm((x) => (x ? { ...x, selfie_key: key } : x));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={!!log}
      onClose={onClose}
      title="착용 기록 고치기"
      footer={
        <Button variant="primary" block loading={busy === "save"} disabled={!f?.item_ids.length || !!busy} onClick={save}>
          저장
        </Button>
      }
    >
      {f && (
        <div className="space-y-5 pt-1">
          <div className="flex gap-4">
            <div className="w-24 shrink-0">
              <Img src={imageUrl(f.selfie_key)} ratio="3 / 4" className="rounded-md" fallback={<ImageIcon size={20} className="text-faint" />} />
              <PhotoInput onPick={changePhoto} disabled={!!busy} className={buttonClass({ variant: "ghost", size: "sm", block: true, className: "mt-1.5" })}>
                {busy === "photo" ? "올리는 중" : f.selfie_key ? "사진 바꾸기" : "사진 넣기"}
              </PhotoInput>
            </div>
            <div className="min-w-0 flex-1">
              <Field label="날짜">
                <Input type="date" value={f.worn_date} max={addDays(today, 1)} className="tabular" onChange={(e) => e.target.value && setForm({ ...f, worn_date: e.target.value })} />
              </Field>
              <p className="mt-2 text-footnote text-muted">날짜나 옷을 바꾸면 착용 횟수도 알맞게 다시 세요.</p>
            </div>
          </div>
          <Field label={`입은 옷 ${f.item_ids.length}벌`} group>
            <div className="scroll-x gap-2">
              {f.item_ids.map((id) => (
                <span key={id} className="w-14 shrink-0">
                  <ItemImage item={byId.get(id)} showName={false} className="rounded-xs" />
                </span>
              ))}
            </div>
            <Button size="sm" className="mt-2" onClick={() => setPicking(true)}>
              옷 바꾸기
            </Button>
          </Field>
          <Field label="만족도" group>
            <Rating value={f.rating} onChange={(rating) => setForm({ ...f, rating })} label="만족도" />
          </Field>
          <Field label="상황" group>
            <TagEditor value={f.occasion_tags} onChange={(occasion_tags) => setForm({ ...f, occasion_tags })} suggestions={OCCASIONS} label="상황" />
          </Field>
          <Field label="메모">
            <Textarea maxLength={500} value={f.note ?? ""} onChange={(e) => setForm({ ...f, note: e.target.value })} />
          </Field>
          <Notice>{err}</Notice>
        </div>
      )}
      {picking && f && (
        <ItemPicker
          open
          title="입은 옷"
          initial={f.item_ids}
          doneLabel="로 바꾸기"
          onClose={() => setPicking(false)}
          onDone={(ids) => {
            setForm({ ...f, item_ids: ids });
            setPicking(false);
          }}
        />
      )}
    </Sheet>
  );
}
