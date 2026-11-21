import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Item, WishlistItemV2 } from "../../shared/types";
import { imageUrl, uploadImage } from "../lib/api";
import { deleteCutout, loadCutouts, saveCutout } from "../lib/cutouts";
import { encodeCanvas } from "../lib/image";
import { createOutfit, useItems } from "../lib/items";
import { useQuery } from "../lib/query";
import { useNav } from "../lib/router";
import { Button, IconButton } from "./Button";
import { Empty, Notice } from "./Feedback";
import { Img } from "./Img";
import { ItemPicker } from "./items";
import { Sheet } from "./Sheet";
import { promptDialog, confirmDialog } from "./Dialog";
import { toast } from "./Toast";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, DownloadIcon, HangerIcon, HeartIcon, LayersIcon, MinusIcon, PlusIcon, RotateIcon, TrashIcon, WandIcon } from "./icons";

/**
 * 2D 콜라주 보드: 전신 사진(또는 무지 배경) 위에 옷 사진을 올려 끌고, 크기를 바꾸고, 앞뒤 순서를 바꾼다.
 * - 손가락/마우스: 끌어서 이동, 오른쪽 아래 손잡이로 크기, 두 손가락으로 확대·축소
 * - 키보드: 옷에 포커스 → 화살표 이동(Shift 크게), +/- 크기, [ ] 순서, R 회전, Delete 삭제, Esc 선택 해제
 * - 저장: "코디로 저장"은 옷장 옷 목록 + 이 그림(대표 사진, outfits.cover_image_key)을 함께 저장, "기기에 저장"은 그림 파일만
 * 배치는 이 기기(localStorage)에, 배경을 지운 사진은 이 기기(IndexedDB, lib/cutouts.ts)에 기억해 둔다.
 */

export interface Layer {
  id: string;
  kind: "item" | "wish";
  ref: string;
  key: string;
  name: string;
  /** 보드 기준 중심 위치 (0~1) */
  x: number;
  y: number;
  /** 보드 너비 대비 너비 (0~1) */
  w: number;
  /** 회전 (도) */
  rot: number;
}
type Background = { kind: "color"; value: string } | { kind: "photo"; key: string };
interface BoardState {
  bg: Background;
  /** 아래 → 위 순서 */
  layers: Layer[];
}

const STORE = "clothe:collage:v1";
const BOARD_RATIO = 3 / 4;
const EXPORT_W = 1200;
const COLORS = [
  { value: "#F1EFEB", label: "종이" },
  { value: "#FFFFFF", label: "흰색" },
  { value: "#D9D6CF", label: "회색" },
  { value: "#1E1E1C", label: "먹색" },
];
const MIN_W = 0.08;
const MAX_W = 1.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const uid = () => Math.random().toString(36).slice(2, 10);

function loadState(fallbackPhoto: string | null): BoardState {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw) as BoardState;
      if (s && Array.isArray(s.layers) && s.bg) return s;
    }
  } catch {
    // 저장된 배치가 없거나 읽지 못하면 새로 시작
  }
  return { bg: fallbackPhoto ? { kind: "photo", key: fallbackPhoto } : { kind: "color", value: COLORS[0].value }, layers: [] };
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 불러오지 못했어요"));
    img.src = src;
  });
}

/** 화면의 배치를 그대로 큰 캔버스에 그린다 */
async function renderBoard(state: BoardState, srcOf: (l: Layer) => string): Promise<HTMLCanvasElement> {
  const W = EXPORT_W;
  const H = Math.round(W / BOARD_RATIO);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들지 못했어요");
  ctx.imageSmoothingQuality = "high";
  if (state.bg.kind === "color") {
    ctx.fillStyle = state.bg.value;
    ctx.fillRect(0, 0, W, H);
  } else {
    const img = await loadImg(imageUrl(state.bg.key)!);
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  const imgs = await Promise.all(state.layers.map((l) => loadImg(srcOf(l))));
  state.layers.forEach((l, i) => {
    const img = imgs[i];
    const w = l.w * W;
    const h = w * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(l.x * W, l.y * H);
    ctx.rotate((l.rot * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  });
  return c;
}

type Gesture =
  | { kind: "move"; id: string; pointer: number; startX: number; startY: number; ox: number; oy: number }
  | { kind: "resize"; id: string; pointer: number; cx: number; cy: number; startDist: number; startW: number }
  | { kind: "pinch"; id: string; startDist: number; startW: number };

export function CollageBoard({ mannequins }: { mannequins: string[] }) {
  const nav = useNav();
  const { byId } = useItems();
  const [state, setState] = useState<BoardState>(() => loadState(mannequins[0] ?? null));
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<"item" | "wish" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** 배경을 지운 사진 (image key → object URL). 이 기기의 IndexedDB에서 불러오고 저장한다. */
  const [cutouts, setCutouts] = useState<Map<string, string>>(() => new Map());
  const boardRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // 배치를 기억해 둔다 (조금 모아서)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(state));
      } catch {
        // 저장 공간이 없어도 이번 화면에서는 계속 쓸 수 있다
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  // 사진이 지워진 전신 사진 배경이면 무지 배경으로
  const bg = state.bg.kind === "photo" && !mannequins.includes(state.bg.key) ? { kind: "color" as const, value: COLORS[0].value } : state.bg;

  // 배경을 지운 사진 주소는 화면을 떠날 때 한 번에 정리한다
  const cutoutUrls = useRef<string[]>([]);
  useEffect(() => () => cutoutUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // 이 기기에 저장해 둔 배경 지운 사진을 되살린다 (다시 열었을 때, 같은 옷을 다시 올렸을 때)
  const alive = useRef(true);
  const restoreCutouts = useCallback(async (keys: string[]) => {
    const found = await loadCutouts([...new Set(keys)]);
    if (!alive.current || !found.size) return;
    setCutouts((m) => {
      const next = new Map(m);
      found.forEach((blob, key) => {
        if (next.has(key)) return;
        const url = URL.createObjectURL(blob);
        cutoutUrls.current.push(url);
        next.set(key, url);
      });
      return next;
    });
  }, []);
  const initialKeys = useRef(state.layers.map((l) => l.key));
  useEffect(() => {
    alive.current = true;
    void restoreCutouts(initialKeys.current);
    return () => {
      alive.current = false;
    };
  }, [restoreCutouts]);

  const srcOf = useCallback((l: Layer) => cutouts.get(l.key) ?? imageUrl(l.key)!, [cutouts]);
  const update = (id: string, patch: Partial<Layer> | ((l: Layer) => Partial<Layer>)) =>
    setState((s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)) }));
  const remove = (id: string) => {
    setState((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) }));
    setSelected((cur) => (cur === id ? null : cur));
  };
  const reorder = (id: string, dir: 1 | -1) =>
    setState((s) => {
      const i = s.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.layers.length) return s;
      const layers = [...s.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...s, layers };
    });

  const add = (entries: { kind: Layer["kind"]; ref: string; key: string; name: string }[]) => {
    if (!entries.length) return;
    const added: Layer[] = entries.map((e, i) => ({ ...e, id: uid(), x: clamp(0.38 + (i % 3) * 0.12, 0.15, 0.85), y: clamp(0.3 + Math.floor(i / 3) * 0.18 + (i % 3) * 0.04, 0.15, 0.85), w: 0.42, rot: 0 }));
    setState((s) => ({ ...s, layers: [...s.layers, ...added] }));
    setSelected(added[added.length - 1].id);
    void restoreCutouts(added.map((l) => l.key));
  };

  /* ───── 손가락·마우스 ───── */
  const rect = () => boardRef.current!.getBoundingClientRect();
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const layerEl = target.closest<HTMLElement>("[data-layer]");
    const handle = target.closest<HTMLElement>("[data-handle]");
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    boardRef.current?.setPointerCapture(e.pointerId);

    // 두 번째 손가락: 고른 옷 확대·축소
    if (pointers.current.size === 2 && selected) {
      const [a, b] = [...pointers.current.values()];
      const l = state.layers.find((x) => x.id === selected);
      if (l) gesture.current = { kind: "pinch", id: l.id, startDist: dist(a, b), startW: l.w };
      return;
    }
    if (pointers.current.size > 1) return;
    if (!layerEl) {
      setSelected(null);
      gesture.current = null;
      return;
    }
    const id = layerEl.dataset.layer!;
    const l = state.layers.find((x) => x.id === id);
    if (!l) return;
    setSelected(id);
    const r = rect();
    if (handle) {
      const cx = r.left + l.x * r.width;
      const cy = r.top + l.y * r.height;
      gesture.current = { kind: "resize", id, pointer: e.pointerId, cx, cy, startDist: Math.max(8, dist({ x: e.clientX, y: e.clientY }, { x: cx, y: cy })), startW: l.w };
    } else {
      gesture.current = { kind: "move", id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, ox: l.x, oy: l.y };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const r = rect();
    if (g.kind === "move" && g.pointer === e.pointerId) {
      update(g.id, { x: clamp(g.ox + (e.clientX - g.startX) / r.width, 0, 1), y: clamp(g.oy + (e.clientY - g.startY) / r.height, 0, 1) });
    } else if (g.kind === "resize" && g.pointer === e.pointerId) {
      const d = dist({ x: e.clientX, y: e.clientY }, { x: g.cx, y: g.cy });
      update(g.id, { w: clamp((g.startW * d) / g.startDist, MIN_W, MAX_W) });
    } else if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      update(g.id, { w: clamp((g.startW * dist(a, b)) / Math.max(8, g.startDist), MIN_W, MAX_W) });
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    else if (gesture.current?.kind === "pinch") gesture.current = null;
  };

  /* ───── 키보드 ───── */
  const onLayerKey = (e: KeyboardEvent<HTMLButtonElement>, l: Layer) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const k = e.key;
    let handled = true;
    if (k === "ArrowLeft") update(l.id, { x: clamp(l.x - step, 0, 1) });
    else if (k === "ArrowRight") update(l.id, { x: clamp(l.x + step, 0, 1) });
    else if (k === "ArrowUp") update(l.id, { y: clamp(l.y - step, 0, 1) });
    else if (k === "ArrowDown") update(l.id, { y: clamp(l.y + step, 0, 1) });
    else if (k === "+" || k === "=") update(l.id, { w: clamp(l.w * 1.08, MIN_W, MAX_W) });
    else if (k === "-" || k === "_") update(l.id, { w: clamp(l.w / 1.08, MIN_W, MAX_W) });
    else if (k === "]" || k === "PageUp") reorder(l.id, 1);
    else if (k === "[" || k === "PageDown") reorder(l.id, -1);
    else if (k === "r" || k === "R") update(l.id, { rot: (l.rot + (e.shiftKey ? -15 : 15) + 360) % 360 });
    else if (k === "Delete" || k === "Backspace") remove(l.id);
    else if (k === "Escape") {
      setSelected(null);
      (e.currentTarget as HTMLElement).blur();
    } else handled = false;
    if (handled) e.preventDefault();
  };

  /* ───── 배경 지우기 (기기 안에서) ───── */
  const cutout = async (l: Layer) => {
    setBusy(`cut-${l.id}`);
    try {
      const [{ removeBackground }, { composeCutout }] = await Promise.all([import("../lib/background"), import("../lib/image")]);
      const blob = await fetch(imageUrl(l.key)!).then((r) => r.blob());
      const cut = await composeCutout(await removeBackground(blob, () => {}));
      void saveCutout(l.key, cut);
      if (!alive.current) return; // 기다리는 사이 화면을 떠났으면 기기에만 저장 (주소를 만들면 새어 나간다)
      const url = URL.createObjectURL(cut);
      cutoutUrls.current.push(url);
      setCutouts((m) => new Map(m).set(l.key, url));
      toast("배경을 지웠어요. 이 기기에 기억해 둘게요");
    } catch (e) {
      console.warn("배경 제거 실패", e);
      toast.error("배경을 지우지 못했어요. 원래 사진을 그대로 쓸게요");
    } finally {
      setBusy(null);
    }
  };

  /** 배경 지운 사진을 버리고 원래 사진으로 */
  const restoreOriginal = (l: Layer) => {
    const url = cutouts.get(l.key);
    setCutouts((m) => {
      const next = new Map(m);
      next.delete(l.key);
      return next;
    });
    if (url) URL.revokeObjectURL(url);
    void deleteCutout(l.key);
  };

  /* ───── 저장 ───── */
  const exportBlob = async () => encodeCanvas(await renderBoard({ ...state, bg }, srcOf), 0.88);

  const saveToDevice = async () => {
    setBusy("device");
    setErr(null);
    try {
      const blob = await exportBlob();
      const ext = blob.type.split("/")[1] ?? "png";
      const file = new File([blob], `collage-${new Date().toISOString().slice(0, 10)}.${ext}`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "내 콜라주" }).catch((e: Error) => {
          if (e.name !== "AbortError") throw e;
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (e) {
      setErr((e as Error).message || "이미지를 저장하지 못했어요");
    } finally {
      setBusy(null);
    }
  };

  const itemIds = useMemo(() => [...new Set(state.layers.filter((l) => l.kind === "item" && byId.has(l.ref)).map((l) => l.ref))], [state.layers, byId]);

  const saveOutfit = async () => {
    const name = await promptDialog({ title: "코디 이름", defaultValue: "콜라주 코디", confirmLabel: "저장" });
    if (name === null) return;
    setBusy("outfit");
    setErr(null);
    try {
      // 보드 그림을 코디의 대표 사진으로 같이 저장한다
      const cover = await uploadImage(await exportBlob());
      const o = await createOutfit({ name: name || "콜라주 코디", item_ids: itemIds, source: "manual", tags: ["콜라주"], cover_image_key: cover });
      toast("코디를 저장했어요", { action: { label: "보기", onClick: () => nav(`/outfits/${o.id}`) } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const clearAll = async () => {
    if (!(await confirmDialog({ title: "보드를 비울까요?", message: "올려 둔 옷이 모두 빠져요. 옷장의 옷은 그대로예요.", confirmLabel: "비우기", destructive: true }))) return;
    setState((s) => ({ ...s, layers: [] }));
    setSelected(null);
  };

  const sel = state.layers.find((l) => l.id === selected) ?? null;
  const top = [...state.layers].reverse();

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:gap-12">
      <div className="min-w-0 md:sticky md:top-[calc(var(--safe-top)+var(--bar-h)+8px)] md:self-start">
        <div
          ref={boardRef}
          aria-label="콜라주 보드"
          role="group"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className="relative mx-auto aspect-[3/4] w-full max-w-[min(100%,calc((100dvh-var(--bar-h)-var(--safe-top)-170px)*0.75))] touch-none overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--line)] select-none"
          style={bg.kind === "color" ? { background: bg.value } : undefined}
        >
          {bg.kind === "photo" && <img src={imageUrl(bg.key)!} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-cover" />}
          {state.layers.map((l, i) => {
            const on = l.id === selected;
            return (
              <button
                key={l.id}
                type="button"
                data-layer={l.id}
                aria-label={`${l.name}${on ? ", 선택됨" : ""}`}
                aria-describedby="collage-help"
                aria-pressed={on}
                onFocus={() => setSelected(l.id)}
                onKeyDown={(e) => onLayerKey(e, l)}
                className={`absolute block cursor-grab rounded-xs outline-offset-4 active:cursor-grabbing ${on ? "shadow-[0_0_0_1.5px_rgb(255_255_255/0.95),0_0_0_3px_rgb(20_20_19/0.85)]" : ""}`}
                style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, transform: `translate(-50%, -50%) rotate(${l.rot}deg)`, zIndex: i + 1 }}
              >
                <img src={srcOf(l)} alt="" draggable={false} className="pointer-events-none block h-auto w-full rounded-xs" />
                {busy === `cut-${l.id}` && <span className="absolute inset-0 animate-pulse rounded-xs bg-white/40" />}
                {on && (
                  <span
                    data-handle="resize"
                    aria-hidden
                    className="absolute -right-3 -bottom-3 size-7 cursor-nwse-resize rounded-full border-2 border-white bg-[#141413] shadow-2 after:absolute after:-inset-2.5"
                  />
                )}
              </button>
            );
          })}
          {state.layers.length === 0 && (
            <div className="pointer-events-none absolute inset-x-6 bottom-6 rounded-md bg-black/55 px-4 py-3 text-center text-subhead text-white backdrop-blur-sm">옷장이나 위시리스트에서 옷을 골라 보드에 올려 보세요</div>
          )}
        </div>
        <p id="collage-help" className="mt-3 text-center text-footnote text-muted">
          끌어서 옮기고, 모서리 손잡이나 두 손가락으로 크기를 바꿔요. 키보드: 화살표 이동 · +/- 크기 · [ ] 순서 · R 회전 · Delete 빼기
        </p>
        {sel && (
          <div role="toolbar" aria-label={`${sel.name} 편집`} className="mt-3 flex flex-wrap justify-center gap-1.5">
            <IconButton label="앞으로" variant="filled" onClick={() => reorder(sel.id, 1)} disabled={state.layers[state.layers.length - 1]?.id === sel.id}>
              <ArrowUpIcon size={18} />
            </IconButton>
            <IconButton label="뒤로" variant="filled" onClick={() => reorder(sel.id, -1)} disabled={state.layers[0]?.id === sel.id}>
              <ArrowDownIcon size={18} />
            </IconButton>
            <IconButton label="작게" variant="filled" onClick={() => update(sel.id, (l) => ({ w: clamp(l.w / 1.12, MIN_W, MAX_W) }))}>
              <MinusIcon size={18} />
            </IconButton>
            <IconButton label="크게" variant="filled" onClick={() => update(sel.id, (l) => ({ w: clamp(l.w * 1.12, MIN_W, MAX_W) }))}>
              <PlusIcon size={18} />
            </IconButton>
            <IconButton label="15도 돌리기" variant="filled" onClick={() => update(sel.id, (l) => ({ rot: (l.rot + 15) % 360 }))}>
              <RotateIcon size={18} />
            </IconButton>
            {cutouts.has(sel.key) ? (
              <IconButton label="원래 사진으로" variant="filled" disabled={!!busy} onClick={() => restoreOriginal(sel)}>
                <RotateIcon size={18} className="-scale-x-100" />
              </IconButton>
            ) : (
              <IconButton label="배경 지우기" variant="filled" loading={busy === `cut-${sel.id}`} disabled={!!busy} onClick={() => cutout(sel)}>
                <WandIcon size={18} />
              </IconButton>
            )}
            <IconButton label="보드에서 빼기" variant="filled" className="text-danger" onClick={() => remove(sel.id)}>
              <TrashIcon size={18} />
            </IconButton>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-7">
        <section>
          <h2 className="mb-2.5 text-headline">옷 올리기</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button icon={<HangerIcon size={18} />} onClick={() => setPicking("item")}>
              옷장에서
            </Button>
            <Button icon={<HeartIcon size={18} />} onClick={() => setPicking("wish")}>
              위시리스트에서
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 text-headline">배경</h2>
          <div role="radiogroup" aria-label="배경" className="flex flex-wrap gap-2">
            {COLORS.map((c) => {
              const on = bg.kind === "color" && bg.value === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setState((s) => ({ ...s, bg: { kind: "color", value: c.value } }))}
                  className={`pressable relative size-11 rounded-sm shadow-[inset_0_0_0_1px_var(--line-strong)] ${on ? "outline-2 outline-offset-2 outline-ink" : ""}`}
                  style={{ background: c.value }}
                />
              );
            })}
            {mannequins.map((k, i) => {
              const on = bg.kind === "photo" && bg.key === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`전신 사진 ${i + 1}`}
                  onClick={() => setState((s) => ({ ...s, bg: { kind: "photo", key: k } }))}
                  className={`pressable w-11 overflow-hidden rounded-sm ${on ? "outline-2 outline-offset-2 outline-ink" : ""}`}
                >
                  <Img src={imageUrl(k)} ratio="3 / 4" />
                </button>
              );
            })}
          </div>
          {mannequins.length === 0 && <p className="mt-2 text-footnote text-muted">프로필에 전신 사진을 올리면 내 사진 위에 옷을 올려 볼 수 있어요.</p>}
        </section>

        <section>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-headline">레이어</h2>
            {state.layers.length > 0 && (
              <button type="button" onClick={clearAll} className="rounded-sm text-subhead font-medium text-muted hover:text-danger">
                모두 빼기
              </button>
            )}
          </div>
          {state.layers.length === 0 ? (
            <p className="text-subhead text-muted">아직 올린 옷이 없어요.</p>
          ) : (
            <ol className="divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
              {top.map((l, i) => (
                <li key={l.id} className={`flex items-center gap-3 py-1.5 pr-1.5 pl-2 ${l.id === selected ? "bg-surface-2" : ""}`}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-sm py-1 text-left" onClick={() => setSelected(l.id)} aria-pressed={l.id === selected}>
                    <Img src={srcOf(l)} ratio="3 / 4" className="w-9 shrink-0 rounded-xs" />
                    <span className="min-w-0">
                      <span className="block truncate text-subhead font-medium">{l.name}</span>
                      <span className="block text-caption text-muted">{l.kind === "wish" ? "위시리스트" : "옷장"}</span>
                    </span>
                  </button>
                  <IconButton label={`${l.name} 앞으로`} onClick={() => reorder(l.id, 1)} disabled={i === 0}>
                    <ArrowUpIcon size={18} />
                  </IconButton>
                  <IconButton label={`${l.name} 뒤로`} onClick={() => reorder(l.id, -1)} disabled={i === top.length - 1}>
                    <ArrowDownIcon size={18} />
                  </IconButton>
                  <IconButton label={`${l.name} 빼기`} onClick={() => remove(l.id)}>
                    <TrashIcon size={18} />
                  </IconButton>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-2">
          <Notice>{err}</Notice>
          <Button variant="primary" size="lg" block icon={<LayersIcon size={18} />} disabled={itemIds.length === 0 || !!busy} loading={busy === "outfit"} onClick={saveOutfit}>
            코디로 저장
          </Button>
          <Button block icon={<DownloadIcon size={18} />} disabled={state.layers.length === 0 || !!busy} loading={busy === "device"} onClick={saveToDevice}>
            그림을 기기에 저장
          </Button>
          <p className="text-footnote text-muted">
            {state.layers.length > 0 && itemIds.length === 0
              ? "옷장 옷을 하나 이상 올리면 코디로 저장할 수 있어요. 위시리스트 옷만 있는 보드는 그림으로만 저장돼요."
              : "코디로 저장하면 옷장 옷 목록과 이 그림이 함께 저장돼요(위시리스트 옷은 그림에만 남아요)."}
          </p>
        </section>
      </div>

      {picking === "item" && (
        <ItemPicker
          open
          initial={[]}
          title="보드에 올릴 옷"
          doneLabel=" 올리기"
          onClose={() => setPicking(null)}
          onDone={(ids) => {
            setPicking(null);
            add(ids.map((id) => byId.get(id)).filter((i): i is Item => !!i?.image_key).map((i) => ({ kind: "item" as const, ref: i.id, key: i.image_key!, name: i.name })));
            const noPhoto = ids.filter((id) => !byId.get(id)?.image_key).length;
            if (noPhoto) toast(`사진이 없는 ${noPhoto}벌은 올리지 않았어요`);
          }}
        />
      )}
      <WishPicker
        open={picking === "wish"}
        onClose={() => setPicking(null)}
        onDone={(ws) => {
          setPicking(null);
          add(ws.map((w) => ({ kind: "wish" as const, ref: w.id, key: w.image_key!, name: w.name })));
        }}
      />
    </div>
  );
}

/** 위시리스트에서 여러 벌 고르기 (서버에 사진이 있는 것만 — 외부 주소 사진은 캔버스로 저장할 수 없어서) */
function WishPicker({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (w: WishlistItemV2[]) => void }) {
  const { data, loading, error } = useQuery<WishlistItemV2[]>(open ? "/wishlist" : null);
  const [sel, setSel] = useState<string[]>([]);
  const list = (data ?? []).filter((w) => w.status !== "dropped");
  const usable = list.filter((w) => w.image_key);
  const hidden = list.length - usable.length;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="위시리스트에서 올리기"
      size="lg"
      footer={
        <Button
          variant="primary"
          block
          disabled={!sel.length}
          onClick={() => {
            onDone(usable.filter((w) => sel.includes(w.id)));
            setSel([]);
          }}
        >
          {sel.length ? `${sel.length}벌 올리기` : "옷을 골라 주세요"}
        </Button>
      }
    >
      {loading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton aspect-[3/4] rounded-md" />
          ))}
        </div>
      ) : error && !data ? (
        <Notice title="위시리스트를 불러오지 못했어요">{error}</Notice>
      ) : usable.length === 0 ? (
        <Empty icon={<HeartIcon size={26} />} title="올릴 수 있는 옷이 없어요">
          사진을 올려서 추가한 위시리스트 옷만 보드에 올릴 수 있어요.
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5">
            {usable.map((w) => {
              const on = sel.includes(w.id);
              return (
                <button key={w.id} type="button" aria-pressed={on} onClick={() => setSel((s) => (on ? s.filter((x) => x !== w.id) : [...s, w.id]))} className="pressable-soft relative rounded-md text-left">
                  <Img src={imageUrl(w.image_key)} ratio="3 / 4" className={`rounded-md transition-shadow duration-(--dur-fast) ${on ? "shadow-[0_0_0_2px_var(--ink)]" : ""}`} />
                  <span
                    aria-hidden
                    className={`absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full ${on ? "bg-accent text-accent-ink" : "scale-90 bg-black/15 text-transparent shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.9)]"}`}
                  >
                    <CheckIcon size={14} strokeWidth={2.4} />
                  </span>
                  <span className="mt-1.5 block truncate text-footnote">{w.name}</span>
                </button>
              );
            })}
          </div>
          {hidden > 0 && <p className="mt-4 text-footnote text-muted">쇼핑몰 주소로만 사진이 있는 {hidden}벌은 저장할 때 그림에 넣을 수 없어서 뺐어요.</p>}
        </>
      )}
    </Sheet>
  );
}

