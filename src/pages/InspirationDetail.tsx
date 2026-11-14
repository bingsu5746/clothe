import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CATEGORY_LABEL, type Inspiration } from "../../shared/types";
import { ItemImage } from "../components/items";
import { Button, Card, ErrorText, PageHeader, Spinner, toast } from "../components/ui";
import { api, imageUrl } from "../lib/api";
import { useItems } from "../lib/items";

export default function InspirationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { byId } = useItems();
  const [insp, setInsp] = useState<Inspiration | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const autoTried = useRef(false);

  const analyze = useCallback(
    async (force = false) => {
      setBusy("analyze");
      setErr(null);
      try {
        setInsp(await api<Inspiration>(`/inspirations/${id}/analyze${force ? "?force=true" : ""}`, { method: "POST" }));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [id],
  );

  useEffect(() => {
    api<Inspiration>(`/inspirations/${id}`)
      .then((i) => {
        setInsp(i);
        // 처음 열었을 때 분석 결과가 없으면 자동으로 분석 (결과는 저장되어 다시 호출하지 않음)
        if (!i.analysis && !autoTried.current) {
          autoTried.current = true;
          analyze();
        }
      })
      .catch((e) => setErr(e.message));
  }, [id, analyze]);

  if (!insp) return err ? <ErrorText>{err}</ErrorText> : <Spinner />;
  const pieces = insp.analysis?.pieces ?? [];

  const addWish = async (index: number) => {
    setBusy(`wish-${index}`);
    try {
      const { wishlist_id } = await api<{ wishlist_id: string }>(`/inspirations/${insp.id}/pieces/${index}/wishlist`, { method: "POST" });
      setInsp((cur) => {
        if (!cur?.analysis) return cur;
        const next = structuredClone(cur);
        next.analysis!.pieces[index].wishlist_id = wishlist_id;
        return next;
      });
      toast("위시리스트에 추가했어요");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyLook = async () => {
    const ids = pieces.map((p) => p.matched_item_ids[0]).filter((x): x is string => !!x && byId.has(x));
    if (ids.length < 2) {
      toast("내 옷장에서 비슷한 옷을 2벌 이상 찾지 못했어요");
      return;
    }
    const o = await api<{ id: string }>("/outfits", {
      method: "POST",
      json: { name: "스크랩 따라 입기", item_ids: [...new Set(ids)], source: "reference", reason: insp.analysis?.summary },
    });
    nav(`/outfits/${o.id}`);
  };

  return (
    <>
      <PageHeader
        title="스크랩한 코디"
        back="/inspo"
        right={
          <button
            className="text-sm font-semibold text-danger"
            onClick={async () => {
              if (!confirm("이 사진을 삭제할까요?")) return;
              await api(`/inspirations/${insp.id}`, { method: "DELETE" });
              nav("/inspo");
            }}
          >
            삭제
          </button>
        }
      />
      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
        <div>
          <img src={imageUrl(insp.image_key)!} alt="" className="w-full rounded-2xl bg-surface-2" />
          {insp.source_url && (
            <a href={insp.source_url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm text-muted underline">
              {insp.source_url}
            </a>
          )}
        </div>
        <div className="space-y-3">
          <ErrorText>{err}</ErrorText>
          {busy === "analyze" && (
            <Card className="flex items-center gap-3">
              <Spinner /> AI가 사진 속 옷을 나눠서 분석하는 중…
            </Card>
          )}
          {!insp.analysis && busy !== "analyze" && (
            <Button variant="primary" className="w-full" onClick={() => analyze()}>
              AI로 분석하기
            </Button>
          )}
          {insp.analysis && (
            <>
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[15px]">{insp.analysis.summary}</p>
              {pieces.map((p, i) => (
                <Card key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-muted">{CATEGORY_LABEL[p.category]}</div>
                      <div className="font-semibold">{p.description}</div>
                      {p.colors.length > 0 && <div className="text-sm text-muted">{p.colors.join(", ")}</div>}
                    </div>
                    {p.matched_item_ids.length > 0 ? (
                      <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">비슷한 옷 있음</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">옷장에 없음</span>
                    )}
                  </div>
                  {p.matched_item_ids.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {p.matched_item_ids.map((mid) => (
                        <Link key={mid} to={`/closet/${mid}`} className="w-20">
                          <ItemImage item={byId.get(mid)} className="aspect-square" />
                          <div className="mt-1 truncate text-xs">{byId.get(mid)?.name ?? "삭제된 옷"}</div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <div className="mt-3">
                    {p.wishlist_id ? (
                      <Link to={`/wishlist/${p.wishlist_id}`} className="text-sm font-semibold text-accent">
                        위시리스트에 있어요 →
                      </Link>
                    ) : (
                      <Button className="w-full" onClick={() => addWish(i)} loading={busy === `wish-${i}`}>
                        위시리스트에 추가
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={copyLook}>
                  내 옷으로 따라 입기
                </Button>
                <Button onClick={() => analyze(true)} disabled={!!busy}>
                  다시 분석
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
