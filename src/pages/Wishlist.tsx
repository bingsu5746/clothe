import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CATEGORY_LABEL, type WishlistItem } from "../../shared/types";
import { PlusIcon } from "../components/icons";
import { ItemImage, PhotoInput } from "../components/items";
import { Button, Card, Chip, Empty, ErrorText, Field, PageHeader, Sheet, Spinner, inputCls } from "../components/ui";
import { api, imageUrl, uploadImage, won } from "../lib/api";
import { useFetch } from "../lib/items";

type Filter = "wanted" | "bought" | "dropped";

export default function Wishlist() {
  const { data, loading } = useFetch<WishlistItem[]>("/wishlist");
  const [filter, setFilter] = useState<Filter>("wanted");
  const [adding, setAdding] = useState(false);
  const list = (data ?? []).filter((w) => w.status === filter);
  const total = (data ?? []).filter((w) => w.status === "wanted").reduce((s, w) => s + (w.estimated_price ?? 0), 0);
  const unknown = (data ?? []).filter((w) => w.status === "wanted" && w.estimated_price == null).length;

  return (
    <>
      <PageHeader
        title="위시리스트"
        right={
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            <PlusIcon width={18} height={18} /> 추가
          </button>
        }
      />
      <Card className="mb-4">
        <div className="text-sm text-muted">사고 싶은 옷 전부 사려면</div>
        <div className="text-2xl font-extrabold">{won(total)}</div>
        {unknown > 0 && <div className="text-xs text-muted">가격 모르는 옷 {unknown}개 제외</div>}
      </Card>
      <div className="mb-4 flex gap-2">
        {(
          [
            ["wanted", "사고 싶어요"],
            ["bought", "샀어요"],
            ["dropped", "관심 없어짐"],
          ] as [Filter, string][]
        ).map(([k, l]) => (
          <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>
            {l}
          </Chip>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="비어 있어요">스크랩한 코디에서 옷을 추가하거나, 쇼핑몰 링크로 바로 추가할 수 있어요.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((w) => (
            <Link key={w.id} to={`/wishlist/${w.id}`}>
              <Card className="flex gap-3 p-3">
                {w.image_key || w.image_url ? (
                  <img src={imageUrl(w.image_key) ?? w.image_url!} alt="" className="size-20 shrink-0 rounded-xl bg-surface-2 object-cover" loading="lazy" />
                ) : (
                  <ItemImage item={null} className="size-20 shrink-0" />
                )}
                <div className="min-w-0">
                  {w.category && <div className="text-xs font-semibold text-muted">{CATEGORY_LABEL[w.category]}</div>}
                  <div className="line-clamp-2 font-semibold">{w.name}</div>
                  <div className="text-sm text-muted">{w.estimated_price != null ? won(w.estimated_price) : "가격 미정"}</div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <AddWishSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddWishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<WishlistItem>) => {
    setBusy(true);
    setErr(null);
    try {
      const w = await fn();
      onClose();
      nav(`/wishlist/${w.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="위시리스트에 추가">
      <div className="space-y-4">
        <Field label="쇼핑몰 링크">
          <input className={inputCls} placeholder="https://" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Button variant="primary" className="w-full" disabled={!url} loading={busy} onClick={() => run(() => api("/wishlist/from-url", { method: "POST", json: { url } }))}>
          링크로 추가
        </Button>
        <div className="text-center text-xs text-muted">또는</div>
        <Field label="이름만 적어 두기">
          <input className={inputCls} placeholder="예: 베이지 트렌치코트" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!name || busy} onClick={() => run(() => api("/wishlist", { method: "POST", json: { name } }))}>
            이름으로 추가
          </Button>
          <PhotoInput
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface font-semibold"
            onPick={(b) => run(async () => api("/wishlist", { method: "POST", json: { name: name || "사진으로 추가한 옷", image_key: await uploadImage(b) } }))}
          >
            사진으로 추가
          </PhotoInput>
        </div>
        <ErrorText>{err}</ErrorText>
      </div>
    </Sheet>
  );
}
