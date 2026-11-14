import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CATEGORIES, CATEGORY_LABEL, type SuggestedOutfit, type WishlistItem } from "../../shared/types";
import { ItemImage, OutfitCollage } from "../components/items";
import { Button, Card, Chip, ErrorText, Field, PageHeader, Spinner, inputCls, toast } from "../components/ui";
import { api, imageUrl, won } from "../lib/api";
import { useItems } from "../lib/items";

interface Combos {
  verdict: string;
  similar_item_ids: string[];
  outfits: SuggestedOutfit[];
}

export default function WishDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { byId, reload: reloadItems } = useItems();
  const [w, setW] = useState<WishlistItem | null>(null);
  const [combos, setCombos] = useState<Combos | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<WishlistItem>(`/wishlist/${id}`).then(setW).catch((e) => setErr(e.message));
  }, [id]);

  if (!w) return err ? <ErrorText>{err}</ErrorText> : <Spinner />;
  const img = imageUrl(w.image_key) ?? w.image_url;

  const patch = async (body: Partial<WishlistItem>) => {
    setW(await api<WishlistItem>(`/wishlist/${w.id}`, { method: "PATCH", json: body }));
  };

  const loadCombos = async (force = false) => {
    setBusy("combos");
    setErr(null);
    try {
      setCombos(await api<Combos>(`/wishlist/${w.id}/combos${force ? "?force=true" : ""}`, { method: "POST" }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const bought = async () => {
    const input = prompt("실제로 산 가격 (원, 모르면 비워 두세요)", w.estimated_price ? String(w.estimated_price) : "");
    if (input === null) return;
    const price = input.replace(/\D/g, "");
    setBusy("bought");
    try {
      const r = await api<{ item_id: string }>(`/wishlist/${w.id}/bought`, { method: "POST", json: { purchase_price: price ? Number(price) : null } });
      await reloadItems();
      toast("옷장으로 옮겼어요. 정보를 확인해 주세요");
      nav(`/closet/${r.item_id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const newTile = (
    <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-2 ring-2 ring-accent">
      {img ? <img src={img} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center p-1 text-center text-xs">{w.name}</div>}
      <span className="absolute top-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink">NEW</span>
    </div>
  );

  return (
    <>
      <PageHeader title={w.name} back="/wishlist" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-3">
          {img ? <img src={img} alt="" className="w-full rounded-2xl bg-surface-2" /> : <ItemImage item={null} className="aspect-square w-32" />}
          {w.reference_id && (
            <Link to={`/inspo/${w.reference_id}`} className="block text-sm font-semibold text-accent">
              스크랩한 원본 코디 보기 →
            </Link>
          )}
          {w.shop_url && (
            <a href={w.shop_url} target="_blank" rel="noreferrer" className="block truncate text-sm text-muted underline">
              {w.shop_url}
            </a>
          )}
        </div>

        <div className="space-y-4">
          <Field label="이름">
            <input className={inputCls} defaultValue={w.name} onBlur={(e) => e.target.value !== w.name && patch({ name: e.target.value })} />
          </Field>
          <Field label="카테고리" group>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip key={c} active={w.category === c} onClick={() => patch({ category: c })}>
                  {CATEGORY_LABEL[c]}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="예상 가격 (원)">
              <input
                className={inputCls}
                inputMode="numeric"
                defaultValue={w.estimated_price ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  patch({ estimated_price: v ? Number(v) : null });
                }}
              />
            </Field>
            <Field label="쇼핑몰 링크">
              <input className={inputCls} defaultValue={w.shop_url ?? ""} onBlur={(e) => e.target.value !== (w.shop_url ?? "") && patch({ shop_url: e.target.value })} />
            </Field>
          </div>
          <div className="text-sm text-muted">
            {w.status === "wanted" ? "사고 싶어요" : w.status === "bought" ? "샀어요" : "관심 없어짐"} · 예상 {won(w.estimated_price)}
          </div>

          <Card>
            <h2 className="font-bold">이걸 사면 만들 수 있는 코디</h2>
            <p className="mb-3 text-sm text-muted">지금 내 옷장의 옷과 어떻게 조합되는지 AI가 보여 줘요.</p>
            {!combos && (
              <Button variant="primary" className="w-full" onClick={() => loadCombos()} loading={busy === "combos"}>
                조합 확인하기
              </Button>
            )}
            {combos && (
              <div className="space-y-4">
                <p className="rounded-xl bg-surface-2 px-3 py-2 text-[15px]">{combos.verdict}</p>
                {combos.similar_item_ids.length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-semibold">옷장에 이미 비슷한 옷이 있어요</div>
                    <div className="flex gap-2">
                      {combos.similar_item_ids.map((sid) => (
                        <Link key={sid} to={`/closet/${sid}`} className="w-20">
                          <ItemImage item={byId.get(sid)} className="aspect-square" />
                          <div className="mt-1 truncate text-xs">{byId.get(sid)?.name}</div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-sm font-semibold">새로 만들 수 있는 코디 {combos.outfits.length}개</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {combos.outfits.map((o, i) => (
                    <div key={i} className="rounded-xl border border-line p-3">
                      <div className="font-semibold">{o.title}</div>
                      <p className="mb-2 text-sm text-muted">{o.reason}</p>
                      <OutfitCollage ids={o.item_ids.filter((x) => x !== "NEW")} extra={newTile} />
                    </div>
                  ))}
                </div>
                <Button className="w-full" onClick={() => loadCombos(true)} loading={busy === "combos"}>
                  다시 확인
                </Button>
              </div>
            )}
          </Card>

          <ErrorText>{err}</ErrorText>
          {w.status === "wanted" ? (
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={bought} loading={busy === "bought"}>
                샀어요 → 옷장으로
              </Button>
              <Button onClick={() => patch({ status: "dropped" })}>관심 없어짐</Button>
            </div>
          ) : w.status === "bought" && w.bought_item_id ? (
            <Link to={`/closet/${w.bought_item_id}`} className="block font-semibold text-accent">
              옷장에서 보기 →
            </Link>
          ) : (
            <Button onClick={() => patch({ status: "wanted" })}>다시 사고 싶어요</Button>
          )}
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              if (!confirm("위시리스트에서 삭제할까요?")) return;
              await api(`/wishlist/${w.id}`, { method: "DELETE" });
              nav("/wishlist");
            }}
          >
            삭제
          </Button>
        </div>
      </div>
    </>
  );
}
