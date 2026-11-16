import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ColorSamples, Profile } from "../../shared/types";
import { CameraIcon, CheckIcon, EyedropperIcon, ImageIcon, SparkIcon } from "../components/icons";
import { PhotoInput } from "../components/items";
import { Button, Card, Notice, Page, Segmented, Spinner, buttonClass, toast } from "../components/ui";
import { api, uploadImage } from "../lib/api";
import { NO_GAINS, applyGains, blobToCanvas, grayWorldGains, sampleRgb, toHex, whitePointGains, type Gains } from "../lib/color";
import { encodeCanvas } from "../lib/image";
import { setProfile } from "../lib/profile";
import { useNav } from "../lib/router";

type WbMode = "auto" | "point" | "none";
type Tool = "white" | "skin" | "hair" | "eye";
type Point = { x: number; y: number };
const TARGETS: { id: Exclude<Tool, "white">; label: string; hint: string }[] = [
  { id: "skin", label: "피부", hint: "볼이나 턱처럼 그늘·화장이 적은 맨살" },
  { id: "hair", label: "머리", hint: "빛이 반사되지 않는 머리카락" },
  { id: "eye", label: "눈", hint: "눈동자의 홍채 (동공 바깥 부분)" },
];
const TOOL_LABEL: Record<Tool, string> = { white: "흰색 기준", skin: "피부", hair: "머리", eye: "눈" };
const WB_OPTIONS = [
  { value: "auto" as const, label: "자동" },
  { value: "point" as const, label: "흰색 기준" },
  { value: "none" as const, label: "보정 안 함" },
];

/** 캔버스 내용을 화면용 캔버스에 그대로 그린다 */
function CanvasView({ source, className = "", label }: { source: HTMLCanvasElement; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = source.width;
    c.height = source.height;
    c.getContext("2d")?.drawImage(source, 0, 0);
  }, [source]);
  return <canvas ref={ref} role={label ? "img" : undefined} aria-label={label} className={`block h-auto w-full ${className}`} />;
}

export default function ColorDiagnosis() {
  const nav = useNav();
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<WbMode>("auto");
  const [white, setWhite] = useState<Point | null>(null);
  const [points, setPoints] = useState<Partial<Record<Exclude<Tool, "white">, Point>>>({});
  const [tool, setTool] = useState<Tool>("skin");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (blob: Blob) => {
    setErr(null);
    try {
      setOriginal(await blobToCanvas(blob, 1280));
      setWhite(null);
      setPoints({});
      setTool(mode === "point" ? "white" : "skin");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const gains: Gains = useMemo(() => {
    if (!original || mode === "none") return NO_GAINS;
    if (mode === "point") {
      const rgb = white ? sampleRgb(original, white.x, white.y, 0.025) : null;
      return rgb ? whitePointGains(rgb) : NO_GAINS;
    }
    const ctx = original.getContext("2d", { willReadFrequently: true });
    return ctx ? grayWorldGains(ctx.getImageData(0, 0, original.width, original.height)) : NO_GAINS;
  }, [original, mode, white]);

  const corrected = useMemo(() => (original ? (gains === NO_GAINS ? original : applyGains(original, gains)) : null), [original, gains]);

  const samples = useMemo(() => {
    const out: Partial<Record<Exclude<Tool, "white">, string>> = {};
    if (!corrected) return out;
    for (const t of TARGETS) {
      const p = points[t.id];
      const rgb = p ? sampleRgb(corrected, p.x, p.y, t.id === "eye" ? 0.008 : 0.018) : null;
      if (rgb) out[t.id] = toHex(rgb);
    }
    return out;
  }, [corrected, points]);

  const chooseMode = (m: WbMode) => {
    setMode(m);
    if (m === "point" && !white) setTool("white");
    else if (tool === "white") setTool("skin");
  };

  const place = (p: Point) => {
    const pt = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
    if (tool === "white") {
      setWhite(pt);
      setTool("skin");
      return;
    }
    const next = { ...points, [tool]: pt };
    setPoints(next);
    // 처음 찍은 부위면 아직 안 찍은 다음 부위로 자동으로 넘어간다
    if (!points[tool]) {
      const nextTarget = TARGETS.find((t) => !next[t.id]);
      if (nextTarget) setTool(nextTarget.id);
    }
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    place({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = tool === "white" ? white : points[tool];
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in moves) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      const base = cur ?? { x: 0.5, y: 0.4 };
      if (tool === "white") setWhite({ x: Math.min(1, Math.max(0, base.x + dx)), y: Math.min(1, Math.max(0, base.y + dy)) });
      else setPoints((p) => ({ ...p, [tool]: { x: Math.min(1, Math.max(0, base.x + dx)), y: Math.min(1, Math.max(0, base.y + dy)) } }));
    } else if ((e.key === "Enter" || e.key === " ") && !cur) {
      e.preventDefault();
      place({ x: 0.5, y: 0.4 });
    }
  };

  const submit = async () => {
    if (!corrected) return;
    setBusy("upload");
    setErr(null);
    try {
      const key = await uploadImage(await encodeCanvas(corrected, 0.9));
      setBusy("analyze");
      const body: { image_key: string; samples?: ColorSamples } = { image_key: key };
      if (Object.keys(samples).length) body.samples = samples;
      setProfile(await api<Profile>("/profile/analyze-color", { method: "POST", json: body }));
      toast("퍼스널 컬러를 진단했어요");
      nav("/profile", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const markers: { id: Tool; p: Point }[] = [...(mode === "point" && white ? [{ id: "white" as const, p: white }] : []), ...TARGETS.flatMap((t) => (points[t.id] ? [{ id: t.id, p: points[t.id]! }] : []))];
  const count = Object.keys(samples).length;

  return (
    <Page title="퍼스널 컬러 진단" back="/profile" width="default">
      {!original || !corrected ? (
        <div className="mx-auto max-w-xl space-y-6">
          <Card>
            <h2 className="text-headline">이렇게 찍으면 정확해요</h2>
            <ul className="mt-3 space-y-2 text-callout text-ink-2">
              {["창가 자연광 아래, 형광등·노란 조명은 끄고", "화장·필터 없이 정면으로", "흰 종이나 흰 벽이 같이 나오면 조명 색을 더 정확히 바로잡을 수 있어요"].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <CheckIcon size={18} className="mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-footnote text-muted">사진의 색 보정과 색 뽑기는 이 기기 안에서 해요. 보정한 사진만 진단에 올라가요.</p>
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <PhotoInput onPick={pick} capture className={buttonClass({ variant: "primary", size: "lg" })}>
              <CameraIcon size={20} /> 찍기
            </PhotoInput>
            <PhotoInput onPick={pick} className={buttonClass({ variant: "secondary", size: "lg" })}>
              <ImageIcon size={20} /> 사진 고르기
            </PhotoInput>
          </div>
          <Notice>{err}</Notice>
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-12">
          <div className="md:sticky md:top-[calc(var(--safe-top)+var(--bar-h)+8px)] md:self-start">
            <div
              role="application"
              tabIndex={0}
              aria-label={`사진에서 ${TOOL_LABEL[tool]} 위치 고르기. 누르거나 화살표 키로 옮겨요.`}
              onPointerDown={onPointer}
              onKeyDown={onKey}
              className="relative mx-auto max-w-[min(100%,calc((100dvh-var(--bar-h)-var(--safe-top)-120px)*0.8))] cursor-crosshair touch-manipulation overflow-hidden rounded-lg bg-surface-2 select-none"
            >
              <CanvasView source={corrected} />
              {markers.map(({ id, p }) => (
                <span
                  key={id}
                  aria-hidden
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgb(0_0_0/0.55),0_2px_8px_rgb(0_0_0/0.3)] ${id === tool ? "size-8" : "size-6"}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: id === "white" ? "transparent" : samples[id] }}
                >
                  <span className="absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full bg-black/70 px-1.5 py-0.5 text-[11px] leading-none font-semibold whitespace-nowrap text-white">{TOOL_LABEL[id]}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-footnote text-muted" aria-live="polite">
              <EyedropperIcon size={16} />
              {tool === "white" ? "원래 흰색이나 회색인 곳(종이, 벽, 흰 옷)을 눌러 주세요" : `${TOOL_LABEL[tool]}: ${TARGETS.find((t) => t.id === tool)?.hint}`}
            </p>
          </div>

          <div className="min-w-0 space-y-8">
            <section>
              <h2 className="text-title-2">① 조명 색 바로잡기</h2>
              <p className="mt-0.5 mb-3 text-subhead text-muted">노란 조명이나 그늘의 푸른 기를 빼서 피부색을 있는 그대로 봐요.</p>
              <Segmented label="화이트밸런스 보정" value={mode} onChange={chooseMode} options={WB_OPTIONS} />
              <p className="mt-2 text-footnote text-muted">
                {mode === "auto" ? "사진 전체의 평균 색이 무채색이 되도록 맞춰요(그레이 월드)." : mode === "point" ? (white ? "누른 곳을 무채색 기준으로 맞췄어요. 다시 누르려면 아래 버튼을 쓰세요." : "사진에서 흰색이었던 곳을 눌러 주세요.") : "찍힌 그대로 써요."}
              </p>
              {mode === "point" && white && (
                <Button size="sm" className="mt-2" icon={<EyedropperIcon size={16} />} onClick={() => setTool("white")}>
                  기준점 다시 찍기
                </Button>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <figure>
                  <CanvasView source={original} className="rounded-md" label="보정 전 사진" />
                  <figcaption className="mt-1.5 text-center text-footnote text-muted">보정 전</figcaption>
                </figure>
                <figure>
                  <CanvasView source={corrected} className="rounded-md" label="보정 후 사진" />
                  <figcaption className="mt-1.5 text-center text-footnote font-medium text-ink">보정 후</figcaption>
                </figure>
              </div>
              {mode !== "none" && gains !== NO_GAINS && (
                <p className="mt-2 font-mono text-caption text-muted tabular">
                  R×{gains[0].toFixed(2)} G×{gains[1].toFixed(2)} B×{gains[2].toFixed(2)}
                </p>
              )}
            </section>

            <section>
              <h2 className="text-title-2">② 피부 · 머리 · 눈 색 찍기</h2>
              <p className="mt-0.5 mb-3 text-subhead text-muted">고른 부위를 누르고 사진에서 그 위치를 눌러요. 주변 픽셀을 모아 반사광과 그림자를 빼고 평균을 내요.</p>
              <div role="radiogroup" aria-label="찍을 부위" className="grid grid-cols-3 gap-2">
                {TARGETS.map((t) => {
                  const on = tool === t.id;
                  const hex = samples[t.id];
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setTool(t.id)}
                      className={`pressable flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-md px-2 py-3 ${on ? "bg-surface shadow-[0_0_0_2px_var(--ink)]" : "bg-surface-2 hover:bg-surface-3"}`}
                    >
                      <span className={`size-9 rounded-full ${hex ? "" : "border-2 border-dashed border-line-strong"}`} style={hex ? { background: hex, boxShadow: "inset 0 0 0 1px var(--line)" } : undefined} />
                      <span className="text-subhead font-semibold">{t.label}</span>
                      <span className="font-mono text-caption text-muted">{hex ?? "아직"}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              {busy ? (
                <div role="status" className="flex items-center gap-3 rounded-md bg-surface-2 px-4 py-3.5 text-subhead font-medium text-ink-2">
                  <Spinner size={18} />
                  {busy === "upload" ? "보정한 사진을 올리는 중" : "AI가 퍼스널 컬러를 진단하는 중이에요 (최대 1분)"}
                </div>
              ) : null}
              {err && (
                <Notice
                  title="진단하지 못했어요"
                  action={
                    <Button size="sm" onClick={submit}>
                      다시 시도
                    </Button>
                  }
                >
                  {err}
                </Notice>
              )}
              <Button variant="primary" size="lg" block icon={<SparkIcon size={18} />} loading={!!busy} onClick={submit}>
                {count === 3 ? "이 색으로 진단하기" : count > 0 ? `찍은 ${count}곳으로 진단하기` : "AI가 사진에서 색 찾기"}
              </Button>
              <p className="text-center text-footnote text-muted">{count < 3 ? "세 곳을 모두 찍으면 더 정확해요. 안 찍은 부위는 AI가 사진에서 추정해요." : "찍은 색을 1차 근거로 써요."}</p>
              <PhotoInput onPick={pick} disabled={!!busy} className={buttonClass({ variant: "ghost", block: true })}>
                <ImageIcon size={18} /> 다른 사진 고르기
              </PhotoInput>
            </section>
          </div>
        </div>
      )}
    </Page>
  );
}
