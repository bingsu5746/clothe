import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { CATEGORIES, CATEGORY_LABEL, SEASONS, SEASON_LABEL, type Item, type ItemTagging, type Season, type UrlImport } from "../../shared/types";
import { ImageIcon } from "../components/icons";
import { ItemImage, PhotoInput, cpw } from "../components/items";
import { Button, Card, Chip, ErrorText, Field, PageHeader, Spinner, inputCls, toast } from "../components/ui";
import { api, uploadImage, won } from "../lib/api";
import { useItems } from "../lib/items";

type Draft = Partial<Item> & { name: string; category: Item["category"] };

const empty: Draft = { name: "", category: "top", colors: [], season: [], style_tags: [] };

const listToStr = (l?: string[]) => (l ?? []).join(", ");
const strToList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ItemEdit() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const { byId, reload } = useItems();
  const [draft, setDraft] = useState<Draft>(empty);
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [colorsText, setColorsText] = useState("");
  const [tagsText, setTagsText] = useState("");

  useEffect(() => {
    if (isNew) return;
    const cached = byId.get(id!);
    const apply = (it: Item) => {
      setDraft(it);
      setColorsText(listToStr(it.colors));
      setTagsText(listToStr(it.style_tags));
      setLoaded(true);
    };
    if (cached) apply(cached);
    else api<Item>(`/items/${id}`).then(apply).catch((e) => setErr(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const applyTagging = (t: ItemTagging) => {
    setDraft((d) => ({ ...d, ...t, name: d.name || t.name }));
    setColorsText(listToStr(t.colors));
    setTagsText(listToStr(t.style_tags));
  };

  const onPhoto = async (blob: Blob) => {
    setErr(null);
    setBusy("upload");
    try {
      const key = await uploadImage(blob);
      set("image_key", key);
      setBusy("analyze");
      applyTagging(await api<ItemTagging>("/items/analyze", { method: "POST", json: { image_key: key } }));
    } catch (e) {
      setErr(`${(e as Error).message} — 정보는 직접 입력해도 돼요.`);
    } finally {
      setBusy(null);
    }
  };

  const reanalyze = async () => {
    if (!draft.image_key) return;
    setBusy("analyze");
    setErr(null);
    try {
      applyTagging(await api<ItemTagging>("/items/analyze", { method: "POST", json: { image_key: draft.image_key } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importUrl = async () => {
    setBusy("url");
    setErr(null);
    try {
      const p = await api<UrlImport & { image_key: string | null }>("/items/import-url", { method: "POST", json: { url } });
      setDraft((d) => ({
        ...d,
        name: p.name ?? d.name,
        brand: p.brand ?? d.brand,
        purchase_price: p.price ?? d.purchase_price,
        image_key: p.image_key ?? d.image_key,
        original_shop_url: url,
      }));
      if (p.image_key) {
        setBusy("analyze");
        const t = await api<ItemTagging>("/items/analyze", { method: "POST", json: { image_key: p.image_key } }).catch(() => null);
        if (t) {
          setDraft((d) => ({ ...d, ...t, name: p.name ?? t.name }));
          setColorsText(listToStr(t.colors));
          setTagsText(listToStr(t.style_tags));
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setErr(null);
    setBusy("save");
    const body = { ...draft, colors: strToList(colorsText), style_tags: strToList(tagsText) };
    try {
      if (isNew) await api("/items", { method: "POST", json: body });
      else await api(`/items/${id}`, { method: "PATCH", json: body });
      await reload();
      toast("저장했어요");
      nav("/closet");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm("이 옷을 삭제할까요?")) return;
    await api(`/items/${id}`, { method: "DELETE" });
    await reload();
    nav("/closet");
  };

  const wearToday = async () => {
    await api("/items/wear", { method: "POST", json: { item_ids: [id] } });
    await reload();
    const it = await api<Item>(`/items/${id}`);
    setDraft(it);
    toast("오늘 착용으로 기록했어요");
  };

  if (!loaded) return <Spinner />;
  const c = !isNew ? cpw(draft as Item) : null;

  return (
    <>
      <PageHeader title={isNew ? "옷 등록" : draft.name || "옷 정보"} back="/closet" />
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <div className="relative">
            <ItemImage item={draft} className="aspect-[3/4] w-full" />
            {busy === "upload" || busy === "analyze" ? (
              <div className="absolute inset-0 grid place-items-center rounded-xl bg-black/40 text-white">
                <div className="flex flex-col items-center gap-2 text-sm font-semibold">
                  <Spinner />
                  {busy === "upload" ? "업로드 중…" : "AI가 옷을 분석하는 중…"}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <PhotoInput onPick={onPhoto} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface font-semibold">
              <ImageIcon width={18} height={18} /> {draft.image_key ? "사진 바꾸기" : "사진 올리기"}
            </PhotoInput>
            {draft.image_key && (
              <Button onClick={reanalyze} disabled={!!busy}>
                AI 분석
              </Button>
            )}
          </div>
          {isNew && (
            <Card>
              <Field label="쇼핑몰 링크로 가져오기">
                <input className={inputCls} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
              </Field>
              <Button className="mt-2 w-full" onClick={importUrl} loading={busy === "url"} disabled={!url || !!busy}>
                가져오기
              </Button>
            </Card>
          )}
          {!isNew && (
            <Card>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted">착용</div>
                  <div className="text-lg font-bold">{draft.wear_count ?? 0}회</div>
                </div>
                <div>
                  <div className="text-muted">1회당 가격</div>
                  <div className="text-lg font-bold">{c != null ? won(c) : "-"}</div>
                </div>
                <div className="col-span-2 text-muted">마지막 착용: {draft.last_worn_date ?? "기록 없음"}</div>
              </div>
              <Button variant="primary" className="mt-3 w-full" onClick={wearToday}>
                오늘 입었어요
              </Button>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Field label="이름">
            <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="예: 네이비 오버핏 셔츠" />
          </Field>
          <Field label="카테고리" group>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <Chip key={cat} active={draft.category === cat} onClick={() => set("category", cat)}>
                  {CATEGORY_LABEL[cat]}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="세부 종류">
              <input className={inputCls} value={draft.sub_category ?? ""} onChange={(e) => set("sub_category", e.target.value)} placeholder="셔츠, 슬랙스…" />
            </Field>
            <Field label="브랜드">
              <input className={inputCls} value={draft.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />
            </Field>
          </div>
          <Field label="색 (쉼표로 구분)">
            <input className={inputCls} value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="네이비, 화이트" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="소재">
              <input className={inputCls} value={draft.material ?? ""} onChange={(e) => set("material", e.target.value)} />
            </Field>
            <Field label="핏">
              <input className={inputCls} value={draft.fit ?? ""} onChange={(e) => set("fit", e.target.value)} />
            </Field>
          </div>
          <Field label="계절" group>
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((s) => {
                const on = (draft.season ?? []).includes(s);
                return (
                  <Chip key={s} active={on} onClick={() => set("season", on ? draft.season!.filter((x) => x !== s) : [...(draft.season ?? []), s] as Season[])}>
                    {SEASON_LABEL[s]}
                  </Chip>
                );
              })}
            </div>
          </Field>
          <Field label={`보온성 ${draft.warmth ?? "-"} / 5 (1 아주 얇음 ~ 5 아주 따뜻함)`}>
            <input type="range" min={1} max={5} value={draft.warmth ?? 3} onChange={(e) => set("warmth", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </Field>
          <Field label="스타일 태그 (쉼표로 구분)">
            <input className={inputCls} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="미니멀, 캐주얼" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="구매 가격 (원)">
              <input
                className={inputCls}
                inputMode="numeric"
                value={draft.purchase_price ?? ""}
                onChange={(e) => set("purchase_price", e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)}
              />
            </Field>
            <Field label="쇼핑몰 링크">
              <input className={inputCls} value={draft.original_shop_url ?? ""} onChange={(e) => set("original_shop_url", e.target.value)} />
            </Field>
          </div>
          <Field label="메모">
            <textarea className={`${inputCls} min-h-20 py-2`} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <ErrorText>{err}</ErrorText>
          <div className="flex gap-2">
            {!isNew && (
              <Button variant="danger" onClick={remove}>
                삭제
              </Button>
            )}
            <Button variant="primary" className="flex-1" onClick={save} loading={busy === "save"} disabled={!draft.name || (!!busy && busy !== "save")}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
