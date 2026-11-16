import { useState } from "react";
import type { PurchaseValidation, ShoppingLink, ValidationPart, WishlistItemV2 } from "../../../shared/types";
import { ChevronRightIcon, ExternalIcon, HeartIcon, LinkIcon, PlusIcon, RefreshIcon, SearchIcon, SparkIcon, TrashIcon } from "../../components/icons";
import { ItemImage, ITEM_RATIO, OutfitCollage } from "../../components/items";
import { Badge, Button, Card, IconButton, Img, Input, Notice, Section, Skeleton, SkeletonText, promptDialog, toast } from "../../components/ui";
import { api, won } from "../../lib/api";
import { linkError, useItems } from "../../lib/items";
import { formatDateTime } from "../../lib/profile";
import { AppLink } from "../../lib/router";

type Wish = WishlistItemV2;
type PartKey = keyof PurchaseValidation["breakdown"];

const PARTS: { key: PartKey; label: string; what: string }[] = [
  { key: "duplicate", label: "중복", what: "옷장에 비슷한 옷이 적을수록 높아요" },
  { key: "synergy", label: "매칭 시너지", what: "이 옷으로 새로 생기는 코디 수" },
  { key: "personal_color", label: "퍼스널 컬러", what: "내 베스트 컬러에 가까울수록 높아요" },
  { key: "body_fit", label: "체형", what: "내 체형을 보완하는 핏일수록 높아요" },
];
const LEVEL: Record<string, string> = { best: "베스트 컬러", good: "잘 맞아요", neutral: "무난해요", poor: "아쉬워요", worst: "워스트 컬러", great: "아주 잘 맞아요" };

/* ───────── 살까 말까 판독 ───────── */

export function Validator({ wish, image, onUpdate }: { wish: Wish; image: string | null; onUpdate: (w: Wish) => void }) {
  const { byId } = useItems();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const v = wish.validation;

  const run = async (force: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<PurchaseValidation & { cached: boolean }>(`/wishlist/${wish.id}/validate${force ? "?force=true" : ""}`, { method: "POST" });
      const { cached: _c, ...validation } = r;
      void _c;
      onUpdate({ ...wish, validation, validator_score: validation.score });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const newTile = (
    <div className="relative">
      <Img src={image} ratio={ITEM_RATIO} className="rounded-sm shadow-[0_0_0_1.5px_var(--ink)]" fallback={<HeartIcon size={18} className="text-faint" />} />
      <span className="absolute top-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none font-bold text-accent-ink">새 옷</span>
    </div>
  );

  return (
    <Section title="살까 말까 판독" description="중복, 코디 시너지, 퍼스널 컬러, 체형을 따져 100점 만점으로 매겨요.">
      {busy ? (
        <Card>
          <div role="status" className="flex items-center gap-5">
            <Skeleton className="size-24 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="text-subhead font-medium text-muted">옷장과 프로필을 보고 판독하는 중이에요</p>
              <SkeletonText lines={2} className="mt-3" />
            </div>
          </div>
          <SkeletonText lines={4} className="mt-6" />
        </Card>
      ) : !v ? (
        <>
          <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
              <SparkIcon size={24} />
            </span>
            <p className="min-w-0 flex-1 text-subhead text-muted">사기 전에 옷장에 비슷한 게 있는지, 몇 가지 새 코디가 생기는지, 나한테 어울리는지 확인해 보세요.</p>
            <Button variant="primary" icon={<SparkIcon size={18} />} onClick={() => run(false)}>
              판독하기
            </Button>
          </Card>
          {err && (
            <Notice className="mt-3" title="판독하지 못했어요" action={<Button size="sm" onClick={() => run(false)}>다시 시도</Button>}>
              {err}
            </Notice>
          )}
        </>
      ) : (
        <div className="space-y-6">
          {v.stale && (
            <Notice
              tone="info"
              title="판독 뒤에 옷장이나 프로필이 바뀌었어요"
              action={
                <Button size="sm" variant="primary" icon={<RefreshIcon size={16} />} onClick={() => run(true)}>
                  다시 판독
                </Button>
              }
            >
              지금 상태로 다시 판독하면 점수가 달라질 수 있어요.
            </Notice>
          )}
          {err && <Notice title="다시 판독하지 못했어요">{err}</Notice>}

          <Card>
            <div className="flex items-center gap-5">
              <ScoreRing score={v.score} />
              <div className="min-w-0">
                <Badge tone={v.score >= 60 ? "solid" : v.score < 40 ? "danger" : "neutral"}>{v.label}</Badge>
                <p className="mt-2 text-body text-ink-2">{v.verdict}</p>
              </div>
            </div>
          </Card>

          <div>
            <h3 className="mb-2 text-subhead font-semibold">점수 내역</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
              {PARTS.map((p) => (
                <PartRow key={p.key} label={p.label} what={p.what} part={v.breakdown[p.key]} level={"level" in v.breakdown[p.key] ? ((v.breakdown[p.key] as { level: string | null }).level ?? null) : null} />
              ))}
            </ul>
            <Formula v={v} />
          </div>

          {v.breakdown.duplicate.similar.some((s) => byId.has(s.item_id)) && (
            <div>
              <h3 className="mb-2 text-subhead font-semibold">옷장에 이미 있는 비슷한 옷</h3>
              <div className="scroll-x gap-2.5">
                {v.breakdown.duplicate.similar
                  .filter((s) => byId.has(s.item_id))
                  .map((s) => (
                    <AppLink key={s.item_id} to={`/closet/${s.item_id}`} className="pressable-soft relative w-[76px] shrink-0 rounded-sm">
                      <ItemImage item={byId.get(s.item_id)} showName={false} className="rounded-sm" />
                      <Badge tone={s.level === "same" ? "danger" : "neutral"} className="absolute top-1 left-1 h-5 px-1.5 text-[10px]">
                        {s.level === "same" ? "거의 같음" : "비슷함"}
                      </Badge>
                      <div className="mt-1 truncate text-caption text-muted">{byId.get(s.item_id)?.name}</div>
                    </AppLink>
                  ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-subhead font-semibold">이걸 사면 새로 생기는 코디 {v.breakdown.synergy.new_outfit_count}개</h3>
            {v.breakdown.synergy.outfits.length === 0 ? (
              <p className="text-subhead text-muted">지금 옷장과 새로 맞춰 입을 조합을 찾지 못했어요.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {v.breakdown.synergy.outfits.map((o, i) => (
                  <Card key={i}>
                    <div className="text-headline">{o.title}</div>
                    <p className="mt-1 mb-3 text-subhead text-muted">{o.reason}</p>
                    <OutfitCollage ids={o.item_ids.filter((x) => x !== "NEW")} extra={newTile} />
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<RefreshIcon size={18} />} onClick={() => run(true)}>
              다시 판독
            </Button>
            <span className="text-footnote text-muted">{formatDateTime(v.validated_at)} 판독</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-24 shrink-0" role="img" aria-label={`구매 추천 점수 ${score}점 (100점 만점)`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--ink)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, score)) / 100)} className="transition-[stroke-dashoffset] duration-(--dur-slow)" />
      </svg>
      <span aria-hidden className="absolute inset-0 grid place-items-center">
        <span className="text-center">
          <span className="block text-[1.75rem] leading-none font-semibold tracking-[-0.04em] tabular">{score}</span>
          <span className="block text-caption text-muted">/ 100</span>
        </span>
      </span>
    </div>
  );
}

function PartRow({ label, what, part, level }: { label: string; what: string; part: ValidationPart; level: string | null }) {
  const on = part.available && part.score != null;
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-callout font-semibold">{label}</span>
          {level && LEVEL[level] && <Badge>{LEVEL[level]}</Badge>}
        </span>
        {on ? (
          <span className="shrink-0 text-callout font-semibold tabular">
            {part.score}
            <span className="font-normal text-muted"> / {part.max}</span>
          </span>
        ) : (
          <Badge>점수에서 제외</Badge>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {on && <div className="h-full rounded-full bg-accent" style={{ width: `${(part.score! / part.max) * 100}%` }} />}
      </div>
      <p className="mt-2 text-subhead text-ink-2">{part.comment || what}</p>
      {!part.available && (
        <AppLink to="/profile" className="mt-1 inline-flex items-center gap-0.5 rounded-sm text-subhead font-semibold hover:underline">
          프로필에서 진단하기 <ChevronRightIcon size={15} />
        </AppLink>
      )}
    </li>
  );
}

function Formula({ v }: { v: PurchaseValidation }) {
  const parts = Object.values(v.breakdown) as ValidationPart[];
  const used = parts.filter((p) => p.available && p.score != null);
  const earned = used.reduce((s, p) => s + (p.score ?? 0), 0);
  const max = used.reduce((s, p) => s + p.max, 0);
  const excluded = parts.length - used.length;
  return (
    <p className="mt-2 px-1 text-footnote text-muted">
      <span className="tabular">
        {earned} ÷ {max} × 100 ≈ {v.score}점
      </span>
      {excluded > 0 && ` · 진단하지 않은 ${excluded}개 항목은 계산에서 빼고 비율로 맞췄어요.`}
    </p>
  );
}

/* ───────── 구매 링크 ───────── */

const SOURCE_LABEL: Record<ShoppingLink["source"], string> = { naver_search: "네이버 쇼핑 검색", musinsa_search: "무신사 검색", "29cm_search": "29CM 검색", naver_item: "네이버 쇼핑", custom: "직접 추가" };

export function ShoppingLinks({ wish, onUpdate }: { wish: Wish; onUpdate: (w: Wish) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const links = wish.recommended_links;
  const items = links.filter((l) => l.source === "naver_item");
  const searches = links.filter((l) => l.source.endsWith("_search"));
  const custom = links.filter((l) => l.source === "custom");

  const save = async (next: ShoppingLink[]) => {
    const w = await api<Wish>(`/wishlist/${wish.id}`, { method: "PATCH", json: { recommended_links: next } });
    onUpdate(w);
  };

  const find = async () => {
    setBusy("find");
    setErr(null);
    try {
      const r = await api<{ query: string; source: "naver" | "links"; notice: string | null; recommended_links: ShoppingLink[] }>(`/wishlist/${wish.id}/links`, { method: "POST", json: query.trim() ? { query: query.trim() } : {} });
      setNotice(r.notice);
      setQuery(r.query);
      // 검색은 링크 목록을 덮어쓰므로, 직접 추가해 둔 링크는 다시 붙여 저장한다
      const keep = custom.filter((c) => !r.recommended_links.some((l) => l.url === c.url));
      if (keep.length) await save([...r.recommended_links, ...keep]);
      else onUpdate({ ...wish, recommended_links: r.recommended_links });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addCustom = async () => {
    const url = await promptDialog({ title: "구매 링크 추가", message: "상품 페이지 주소를 붙여 넣어 주세요.", placeholder: "https://", inputMode: "url", confirmLabel: "다음" });
    if (!url) return;
    const bad = linkError(url, "링크") ?? (url.trim() ? null : "주소를 넣어 주세요");
    if (bad) {
      toast.error(bad);
      return;
    }
    const title = await promptDialog({ title: "링크 이름", defaultValue: new URL(url.trim()).hostname.replace(/^www\./, ""), confirmLabel: "추가", allowEmpty: true });
    if (title === null) return;
    setBusy("add");
    try {
      await save([...links, { title: title.trim() || url.trim(), url: url.trim(), source: "custom", price: null, image_url: null, mall: null }]);
      toast("링크를 저장했어요");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (l: ShoppingLink) => {
    const before = wish;
    onUpdate({ ...wish, recommended_links: links.filter((x) => x !== l) });
    try {
      await save(links.filter((x) => x !== l));
    } catch (e) {
      onUpdate(before);
      toast.error((e as Error).message);
    }
  };

  return (
    <Section title="구매 링크" description="비슷한 상품을 찾거나 직접 링크를 저장해 두세요.">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input aria-label="검색어" placeholder={wish.name} maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
        <Button type="submit" className="h-12" icon={<SearchIcon size={18} />} loading={busy === "find"} disabled={!!busy}>
          {links.length ? "다시 찾기" : "찾기"}
        </Button>
      </form>
      {notice && (
        <Notice tone="info" className="mt-3">
          {notice}
        </Notice>
      )}
      <Notice className="mt-3">{err}</Notice>

      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
          {items.map((l) => (
            <LinkRow key={l.url} link={l} onRemove={() => remove(l)} thumb />
          ))}
        </ul>
      )}
      {(searches.length > 0 || custom.length > 0) && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
          {[...custom, ...searches].map((l) => (
            <LinkRow key={l.url} link={l} onRemove={() => remove(l)} />
          ))}
        </ul>
      )}
      {links.length === 0 && <p className="mt-3 text-subhead text-muted">아직 저장한 링크가 없어요. 이름으로 검색하거나 직접 추가해 보세요.</p>}
      <Button variant="ghost" className="mt-2 -ml-2" icon={<PlusIcon size={18} />} loading={busy === "add"} disabled={!!busy} onClick={addCustom}>
        링크 직접 추가
      </Button>
    </Section>
  );
}

function LinkRow({ link: l, onRemove, thumb }: { link: ShoppingLink; onRemove: () => void; thumb?: boolean }) {
  return (
    <li className="flex items-center gap-1 pr-1">
      <a href={l.url} target="_blank" rel="noreferrer noopener" className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 transition-colors duration-(--dur-fast) hover:bg-surface-2">
        {thumb ? (
          <Img src={l.image_url} ratio="1 / 1" className="w-12 shrink-0 rounded-xs" fallback={<LinkIcon size={16} className="text-faint" />} />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">{l.source === "custom" ? <LinkIcon size={17} /> : <SearchIcon size={17} />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-callout font-medium">{l.title}</span>
          <span className="block truncate text-footnote text-muted tabular">
            {[l.source === "naver_item" ? (l.mall ?? SOURCE_LABEL[l.source]) : SOURCE_LABEL[l.source], l.price != null ? won(l.price) : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ExternalIcon size={16} className="shrink-0 text-faint" />
      </a>
      <IconButton label={`${l.title} 링크 빼기`} className="text-muted" onClick={onRemove}>
        <TrashIcon size={17} />
      </IconButton>
    </li>
  );
}
