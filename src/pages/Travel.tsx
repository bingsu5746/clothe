import { useMemo, useState } from "react";
import type { Trip } from "../../shared/types";
import { PlusIcon, SuitcaseIcon } from "../components/icons";
import { OutfitCollage } from "../components/items";
import { TripForm } from "../components/TripForm";
import { Badge, Button, Card, Empty, IconButton, Notice, Page, Section, Skeleton } from "../components/ui";
import { useIsWide } from "../lib/hooks";
import { todayKST } from "../lib/items";
import { useQuery } from "../lib/query";
import { AppLink, useNav } from "../lib/router";
import { TRIPS_PATH, dday, nightsLabel, shortDate } from "../lib/trips";
import { MORE_PATH } from "../nav";

const GRID = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

export default function Travel() {
  const { data, loading, error, reload } = useQuery<Trip[]>(TRIPS_PATH);
  const [adding, setAdding] = useState(false);
  const wide = useIsWide();
  const nav = useNav();
  const today = todayKST();

  const { upcoming, past } = useMemo(() => {
    const all = data ?? [];
    return {
      upcoming: all.filter((t) => t.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      past: all.filter((t) => t.end_date < today),
    };
  }, [data, today]);

  return (
    <Page
      title="여행"
      back={wide ? undefined : MORE_PATH}
      large
      eyebrow={upcoming.length ? `다가오는 여행 ${upcoming.length}개` : undefined}
      right={
        <IconButton label="여행 추가" variant="primary" onClick={() => setAdding(true)}>
          <PlusIcon size={20} />
        </IconButton>
      }
    >
      {loading ? (
        <div className={GRID} role="status" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-1/2" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <div className="mt-4 grid grid-cols-4 gap-1.5">
                {[0, 1, 2, 3].map((j) => (
                  <Skeleton key={j} className="aspect-[3/4]" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : error && !data ? (
        <Notice
          title="여행을 불러오지 못했어요"
          action={
            <Button size="sm" onClick={reload}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      ) : !data?.length ? (
        <Empty
          icon={<SuitcaseIcon size={26} />}
          title="계획한 여행이 없어요"
          action={
            <Button variant="primary" icon={<PlusIcon size={18} />} onClick={() => setAdding(true)}>
              여행 추가하기
            </Button>
          }
        >
          여행지와 날짜, 일정을 적으면 일기예보에 맞춰 돌려 입을 최소한의 옷과 짐 체크리스트를 만들어 드려요.
        </Empty>
      ) : (
        <div className="space-y-10">
          {upcoming.length > 0 && (
            <div className={GRID}>
              {upcoming.map((t) => (
                <TripCard key={t.id} trip={t} today={today} />
              ))}
            </div>
          )}
          {past.length > 0 && (
            <Section title="다녀온 여행">
              <div className={GRID}>
                {past.map((t) => (
                  <TripCard key={t.id} trip={t} today={today} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
      <TripForm open={adding} onClose={() => setAdding(false)} onSaved={(t) => {
        setAdding(false);
        nav(`/travel/${t.id}`);
      }} />
    </Page>
  );
}

function TripCard({ trip: t, today }: { trip: Trip; today: string }) {
  const d = dday(t, today);
  const packed = t.checklist.filter((c) => c.packed).length;
  const total = t.checklist.length;
  return (
    <AppLink to={`/travel/${t.id}`} className="pressable-soft block rounded-lg">
      <Card className="h-full transition-shadow duration-(--dur-base) hover:shadow-[0_0_0_1px_var(--line-strong)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-eyebrow text-muted uppercase">{t.location_name ?? t.destination}</div>
            <h2 className="mt-0.5 truncate text-headline">{t.name}</h2>
            <p className="text-subhead text-muted tabular">
              {shortDate(t.start_date)} – {shortDate(t.end_date)} · {nightsLabel(t)}
            </p>
          </div>
          <Badge tone={d.tone}>{d.label}</Badge>
        </div>
        {t.plan ? (
          <>
            <div className="mt-4">
              <OutfitCollage ids={t.plan.capsule_item_ids} />
            </div>
            {total > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-footnote text-muted tabular">
                  <span>짐 챙김</span>
                  <span>
                    {packed}/{total}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-(--dur-slow)" style={{ width: `${(packed / total) * 100}%` }} />
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 rounded-md bg-surface-2 px-3 py-2.5 text-subhead text-muted">아직 짐 싸기 계획이 없어요</p>
        )}
      </Card>
    </AppLink>
  );
}
