import { useMemo, useState } from "react";
import { CATEGORY_LABEL, type WishlistItem } from "../../shared/types";
import { HeartIcon, ImageIcon, LinkIcon, PlusIcon } from "../components/icons";
import { PhotoInput } from "../components/items";
import { Button, Empty, Eyebrow, Field, IconButton, Img, Input, Notice, Page, Segmented, Sheet, Skeleton, buttonClass } from "../components/ui";
import { api, imageUrl, uploadImage, won } from "../lib/api";
import { useIsWide } from "../lib/hooks";
import { MORE_PATH } from "../nav";
import { mutateQuery, useQuery } from "../lib/query";
import { AppLink, useNav } from "../lib/router";

type Filter = WishlistItem["status"];
const WISH_PATH = "/wishlist";
const FILTERS: [Filter, string][] = [
  ["wanted", "사고 싶어요"],
  ["bought", "샀어요"],
  ["dropped", "관심 없음"],
];
const EMPTY_COPY: Record<Filter, [string, string]> = {
  wanted: ["사고 싶은 옷이 없어요", "쇼핑몰 링크를 붙여 넣거나, 스크랩한 코디에서 없는 옷을 담아 보세요."],
  bought: ["아직 산 옷이 없어요", "위시리스트의 옷을 사면 “샀어요”로 옷장에 옮길 수 있어요."],
  dropped: ["관심 없어진 옷이 없어요", "마음이 바뀐 옷은 여기에 모여요."],
};
const GRID = "grid gap-x-8 md:grid-cols-2 xl:grid-cols-3";

export default function Wishlist() {
  const { data, loading, error, reload } = useQuery<WishlistItem[]>(WISH_PATH);
  const [filter, setFilter] = useState<Filter>("wanted");
  const [adding, setAdding] = useState(false);
  const wide = useIsWide();

  const { list, total, unknown, counts } = useMemo(() => {
    const all = data ?? [];
    const wanted = all.filter((w) => w.status === "wanted");
    return {
      list: all.filter((w) => w.status === filter),
      total: wanted.reduce((s, w) => s + (w.estimated_price ?? 0), 0),
      unknown: wanted.filter((w) => w.estimated_price == null).length,
      counts: { wanted: wanted.length, bought: all.filter((w) => w.status === "bought").length, dropped: all.filter((w) => w.status === "dropped").length },
    };
  }, [data, filter]);

  return (
    <Page
      title="위시리스트"
      back={wide ? undefined : MORE_PATH}
      large
      right={
        <IconButton label="위시리스트에 추가" variant="primary" onClick={() => setAdding(true)}>
          <PlusIcon size={20} />
        </IconButton>
      }
    >
      <section aria-label="합계" className="mb-6">
        <div className="text-subhead text-muted">사고 싶은 옷을 다 사면</div>
        {loading ? <Skeleton className="mt-2 h-10 w-44" /> : <div className="mt-0.5 text-[2.25rem] leading-tight font-semibold tracking-[-0.04em] tabular">{won(total)}</div>}
        {unknown > 0 && <div className="mt-1 text-footnote text-muted">가격을 모르는 {unknown}벌은 빼고 계산했어요.</div>}
      </section>

      <Segmented
        label="상태"
        className="mb-2 md:max-w-md"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map(([value, label]) => ({
          value,
          label: (
            <>
              {label}
              {counts[value] > 0 && <span className="text-caption opacity-60 tabular">{counts[value]}</span>}
            </>
          ),
        }))}
      />

      {loading ? (
        <div className={GRID} role="status" aria-label="불러오는 중">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4 border-b border-line py-4">
              <Skeleton className="w-[72px] shrink-0 rounded-sm" style={{ aspectRatio: "3 / 4" }} />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <Notice
          className="mt-4"
          title="위시리스트를 불러오지 못했어요"
          action={
            <Button size="sm" onClick={reload}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      ) : list.length === 0 ? (
        <Empty
          icon={<HeartIcon size={26} />}
          title={EMPTY_COPY[filter][0]}
          action={
            filter === "wanted" && (
              <Button variant="primary" icon={<PlusIcon size={18} />} onClick={() => setAdding(true)}>
                추가하기
              </Button>
            )
          }
        >
          {EMPTY_COPY[filter][1]}
        </Empty>
      ) : (
        <div className={GRID}>
          {list.map((w) => (
            <AppLink key={w.id} to={`/wishlist/${w.id}`} className="pressable-soft group flex items-center gap-4 border-b border-line py-4">
              <Img src={imageUrl(w.image_key) ?? w.image_url} ratio="3 / 4" className="w-[72px] shrink-0 rounded-sm" fallback={<HeartIcon size={20} className="text-faint" />} />
              <div className="min-w-0 flex-1">
                {w.category && <Eyebrow>{CATEGORY_LABEL[w.category]}</Eyebrow>}
                <div className="mt-0.5 line-clamp-2 text-callout font-medium group-hover:underline">{w.name}</div>
                <div className="mt-1 text-subhead text-muted tabular">{w.estimated_price != null ? won(w.estimated_price) : "가격 미정"}</div>
              </div>
            </AppLink>
          ))}
        </div>
      )}
      <AddWishSheet open={adding} onClose={() => setAdding(false)} />
    </Page>
  );
}

function AddWishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNav();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"url" | "name" | "photo" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (kind: "url" | "name" | "photo", fn: () => Promise<WishlistItem>) => {
    setBusy(kind);
    setErr(null);
    try {
      const w = await fn();
      mutateQuery<WishlistItem[]>(WISH_PATH, (cur) => (cur ? [w, ...cur] : cur));
      setUrl("");
      setName("");
      onClose();
      nav(`/wishlist/${w.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const addUrl = () => run("url", () => api("/wishlist/from-url", { method: "POST", json: { url } }));

  return (
    <Sheet open={open} onClose={onClose} title="위시리스트에 추가">
      <div className="space-y-6 pt-1">
        <div>
          <Field label="쇼핑몰 링크">
            <Input data-autofocus placeholder="https://" inputMode="url" autoCapitalize="none" autoCorrect="off" enterKeyHint="go" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url && !busy && addUrl()} />
          </Field>
          <Button variant="primary" block className="mt-2" icon={<LinkIcon size={18} />} disabled={!url || !!busy} loading={busy === "url"} onClick={addUrl}>
            링크로 추가
          </Button>
        </div>
        <div className="flex items-center gap-3 text-caption text-faint before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">또는</div>
        <div>
          <Field label="이름만 적어 두기">
            <Input placeholder="예: 베이지 트렌치코트" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button disabled={!name.trim() || !!busy} loading={busy === "name"} onClick={() => run("name", () => api("/wishlist", { method: "POST", json: { name: name.trim() } }))}>
              이름으로 추가
            </Button>
            <PhotoInput
              disabled={!!busy}
              className={buttonClass({ variant: "secondary" })}
              onPick={(b) => run("photo", async () => api("/wishlist", { method: "POST", json: { name: name.trim() || "사진으로 추가한 옷", image_key: await uploadImage(b) } }))}
            >
              <ImageIcon size={18} /> 사진으로 추가
            </PhotoInput>
          </div>
        </div>
        <Notice>{err}</Notice>
      </div>
    </Sheet>
  );
}
