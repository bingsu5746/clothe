import { useState } from "react";
import { BODY_TYPE_LABEL, UNDERTONE_LABEL, type BodyAnalysis, type ColorAnalysis, type PaletteColor, type Profile as ProfileT } from "../../shared/types";
import { CheckIcon, CloseIcon, EyedropperIcon, ImageIcon, PersonIcon, PlusIcon, RefreshIcon, ShirtIcon, SparkIcon, TrashIcon } from "../components/icons";
import { PhotoInput } from "../components/items";
import { Badge, Button, ButtonLink, Card, Eyebrow, Field, Img, Input, ListGroup, ListRow, Notice, Page, Section, Sheet, Skeleton, SkeletonText, confirmDialog, toast } from "../components/ui";
import { AiOffNotice } from "../components/AiStatus";
import { api, imageUrl, uploadImage } from "../lib/api";
import { readableOn } from "../lib/color";
import { useIsWide } from "../lib/hooks";
import { CONFIDENCE_LABEL, formatDateTime, patchProfile, setProfile, useProfile } from "../lib/profile";
import { MORE_PATH } from "../nav";

const MAX_MANNEQUIN = 6;

export default function Profile() {
  const { data: p, loading, error, reload } = useProfile();
  const wide = useIsWide();

  return (
    <Page title="프로필" back={wide ? undefined : MORE_PATH} large subtitle="퍼스널 컬러와 체형을 알아 두면 코디 추천과 살까 말까 판독에 반영돼요.">
      <AiOffNotice className="mb-6" />
      {loading ? (
        <div role="status" aria-label="불러오는 중" className="grid gap-10 xl:grid-cols-2">
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-lg" />
            <SkeletonText lines={4} />
          </div>
        </div>
      ) : error && !p ? (
        <Notice
          title="프로필을 불러오지 못했어요"
          action={
            <Button size="sm" onClick={reload}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      ) : p ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-10">
            <BodyStats profile={p} />
            <ColorSection profile={p} />
          </div>
          <div className="min-w-0 space-y-10">
            <MannequinSection profile={p} />
            <BodySection profile={p} />
            <ListGroup title="가상 피팅">
              <ListRow to="/profile/fitting" icon={<ShirtIcon size={22} />} title="피팅룸" subtitle="내 전신 사진에 옷 입혀 보기 · 2D 콜라주 보드" />
            </ListGroup>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

/* ───────── 키·몸무게 ───────── */

function BodyStats({ profile: p }: { profile: ProfileT }) {
  const [err, setErr] = useState<string | null>(null);
  const save = async (field: "height_cm" | "weight_kg", raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (v === p[field]) return;
    if (v != null && !Number.isFinite(v)) {
      setErr("숫자로 입력해 주세요");
      return;
    }
    setErr(null);
    try {
      await patchProfile({ [field]: v });
      toast("저장했어요");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Section title="신체 정보" description="체형 진단 때 참고해요. 비워 둬도 돼요.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="키 (cm)">
          <Input key={`h${p.height_cm}`} inputMode="decimal" className="tabular" placeholder="예: 165" defaultValue={p.height_cm ?? ""} onBlur={(e) => save("height_cm", e.target.value)} />
        </Field>
        <Field label="몸무게 (kg)">
          <Input key={`w${p.weight_kg}`} inputMode="decimal" className="tabular" placeholder="예: 55" defaultValue={p.weight_kg ?? ""} onBlur={(e) => save("weight_kg", e.target.value)} />
        </Field>
      </div>
      <Notice className="mt-3">{err}</Notice>
    </Section>
  );
}

/* ───────── 퍼스널 컬러 ───────── */

function ColorSection({ profile: p }: { profile: ProfileT }) {
  const a = p.color_analysis;
  const [busy, setBusy] = useState<"redo" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const redo = async () => {
    setBusy("redo");
    setErr(null);
    try {
      setProfile(await api<ProfileT>("/profile/analyze-color", { method: "POST", json: { force: true } }));
      toast("다시 진단했어요");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: "퍼스널 컬러 진단을 지울까요?", message: "사진은 남고 결과만 지워져요. 추천에도 더 이상 반영되지 않아요.", confirmLabel: "지우기", destructive: true }))) return;
    setBusy("delete");
    try {
      setProfile(await api<ProfileT>("/profile/analysis/color", { method: "DELETE" }));
      toast("진단 결과를 지웠어요");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!a)
    return (
      <Section title="퍼스널 컬러">
        <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div aria-hidden className="flex shrink-0 -space-x-2">
            {["#E8B796", "#C58C6A", "#8E5B43", "#3E2C25"].map((c) => (
              <span key={c} className="size-10 rounded-full shadow-[0_0_0_2px_var(--surface)]" style={{ background: c }} />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-headline">내 퍼스널 컬러 알아보기</div>
            <p className="mt-0.5 text-subhead text-muted">자연광에서 찍은 얼굴 사진의 조명 색을 바로잡고, 피부·머리·눈 색을 직접 찍어 진단해요.</p>
          </div>
          <ButtonLink to="/profile/color" variant="primary" icon={<SparkIcon size={18} />}>
            진단 시작
          </ButtonLink>
        </Card>
      </Section>
    );

  return (
    <Section
      title="퍼스널 컬러"
      action={
        <span className="text-footnote text-muted">{formatDateTime(a.analyzed_at)}</span>
      }
    >
      {p.color_analysis_stale && (
        <Notice
          tone="info"
          className="mb-4"
          title="얼굴 사진이 바뀌었어요"
          action={
            <Button size="sm" variant="primary" icon={<RefreshIcon size={16} />} loading={busy === "redo"} onClick={redo}>
              지금 사진으로 다시 진단
            </Button>
          }
        >
          진단한 뒤에 사진이 바뀌어서 결과가 지금 사진과 다를 수 있어요.
        </Notice>
      )}
      <ColorResult a={a} />
      {err && (
        <Notice className="mt-4" title="다시 진단하지 못했어요">
          {err}
        </Notice>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink to="/profile/color" icon={<EyedropperIcon size={18} />}>
          새 사진으로 진단
        </ButtonLink>
        <Button icon={<RefreshIcon size={18} />} loading={busy === "redo"} disabled={!!busy} onClick={redo}>
          다시 진단
        </Button>
        <Button variant="ghost" className="text-danger" icon={<TrashIcon size={18} />} loading={busy === "delete"} disabled={!!busy} onClick={remove}>
          결과 지우기
        </Button>
      </div>
    </Section>
  );
}

function ColorResult({ a }: { a: ColorAnalysis }) {
  const measured = [
    ["피부", a.skin_hex],
    ["머리", a.hair_hex],
    ["눈", a.eye_hex],
  ] as const;
  return (
    <div className="space-y-7">
      <Card padded={false} className="overflow-hidden">
        <div aria-hidden className="flex h-20">
          {a.best_colors.slice(0, 6).map((c) => (
            <span key={c.hex} className="flex-1" style={{ background: c.hex }} />
          ))}
        </div>
        <div className="p-4 md:p-5">
          <Eyebrow>나의 퍼스널 컬러</Eyebrow>
          <div className="mt-1 text-title-1">{a.label}</div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Badge tone="solid">{UNDERTONE_LABEL[a.undertone]}</Badge>
            {a.sub_tone && <Badge>{a.sub_tone}</Badge>}
            <Badge>{CONFIDENCE_LABEL[a.confidence]}</Badge>
          </div>
          {a.summary && <p className="mt-4 border-l-2 border-ink pl-4 text-body text-ink-2">{a.summary}</p>}
        </div>
      </Card>

      <div>
        <h3 className="text-subhead font-semibold">측정한 색</h3>
        <p className="mt-0.5 mb-3 text-footnote text-muted">{a.hex_source === "client" ? "조명 색을 바로잡은 사진에서 직접 찍은 값이에요." : "AI가 사진에서 추정한 값이에요."}</p>
        <div className="grid grid-cols-3 gap-3">
          {measured.map(([label, hex]) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className={`size-11 shrink-0 rounded-full ${hex ? "" : "bg-surface-2"} shadow-[inset_0_0_0_1px_var(--line)]`} style={hex ? { background: hex } : undefined} />
              <span className="min-w-0">
                <span className="block text-subhead font-medium">{label}</span>
                <span className="block font-mono text-caption text-muted">{hex ?? "없음"}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <Palette title="잘 어울리는 색" colors={a.best_colors} large />
      <Palette title="피하면 좋은 색" colors={a.worst_colors} />

      {a.tips.length > 0 && (
        <div>
          <h3 className="mb-2 text-subhead font-semibold">스타일링 팁</h3>
          <ul className="space-y-2">
            {a.tips.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-callout text-ink-2">
                <CheckIcon size={18} className="mt-0.5 shrink-0 text-ink" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.caveat && <Notice tone="info">{a.caveat}</Notice>}
    </div>
  );
}

function Palette({ title, colors, large }: { title: string; colors: PaletteColor[]; large?: boolean }) {
  if (!colors.length) return null;
  return (
    <div>
      <h3 className="mb-3 text-subhead font-semibold">{title}</h3>
      <ul className={`grid gap-x-2.5 gap-y-4 ${large ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-4 sm:grid-cols-6"}`}>
        {colors.map((c) => (
          <li key={c.hex + c.name} className="min-w-0">
            <div
              className={`relative rounded-md shadow-[inset_0_0_0_1px_var(--line)] ${large ? "aspect-square" : "aspect-[4/3]"}`}
              style={{ background: c.hex }}
              role="img"
              aria-label={`${c.name} ${c.hex}`}
            >
              {!large && (
                <span aria-hidden className={`absolute inset-0 grid place-items-center ${readableOn(c.hex) === "dark" ? "text-black/45" : "text-white/70"}`}>
                  <CloseIcon size={16} />
                </span>
              )}
            </div>
            <div className="mt-1.5 truncate text-footnote font-medium">{c.name}</div>
            <div className="font-mono text-caption text-muted">{c.hex}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── 마네킹(전신) 사진 ───────── */

function MannequinSection({ profile: p }: { profile: ProfileT }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = p.mannequin_images;

  const add = async (blob: Blob) => {
    setBusy(true);
    try {
      const key = await uploadImage(blob);
      await patchProfile({ mannequin_images: [...list, key].slice(0, MAX_MANNEQUIN) });
      toast("전신 사진을 추가했어요");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="전신 사진" description="체형 진단과 가상 피팅·콜라주에 써요. 첫 번째 사진이 기본이에요." action={<span className="text-footnote text-muted tabular">{list.length}/{MAX_MANNEQUIN}</span>}>
      <div className="scroll-x bleed-gutter gap-3 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((k, i) => (
          <button key={k} type="button" onClick={() => setOpen(k)} className="pressable-soft relative w-[38%] shrink-0 rounded-md text-left md:w-auto">
            <span className="sr-only">전신 사진 {i + 1}</span>
            <Img src={imageUrl(k)} ratio="3 / 4" className="rounded-md" />
            {i === 0 && <Badge tone="solid" className="absolute top-2 left-2">기본</Badge>}
          </button>
        ))}
        {list.length < MAX_MANNEQUIN && (
          <PhotoInput
            onPick={add}
            disabled={busy}
            label="전신 사진 추가"
            className="pressable relative grid w-[38%] shrink-0 place-items-center rounded-md bg-surface-2 text-muted hover:bg-surface-3 disabled:opacity-50 md:w-auto"
          >
            <span className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 text-footnote">
              {busy ? <SkeletonPulse /> : <PlusIcon size={24} />}
              {busy ? "올리는 중" : "사진 추가"}
            </span>
          </PhotoInput>
        )}
      </div>
      {list.length === 0 && <p className="mt-3 text-footnote text-muted">밝은 곳에서 정면으로, 몸에 붙는 옷을 입고 머리부터 발끝까지 나오게 찍으면 좋아요.</p>}
      <MannequinSheet profile={p} imageKey={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

const SkeletonPulse = () => <span className="size-6 animate-pulse rounded-full bg-surface-3" />;

function MannequinSheet({ profile: p, imageKey, onClose }: { profile: ProfileT; imageKey: string | null; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(imageKey);
  if (imageKey && imageKey !== last) setLast(imageKey);
  const k = imageKey ?? last;
  const index = k ? p.mannequin_images.indexOf(k) : -1;

  const run = async (kind: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(kind);
    try {
      await fn();
      toast(done);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={!!imageKey}
      onClose={onClose}
      title={index === 0 ? "기본 전신 사진" : "전신 사진"}
      footer={
        <div className="grid gap-2">
          <Button
            variant="primary"
            block
            icon={<SparkIcon size={18} />}
            loading={busy === "body"}
            disabled={!!busy}
            onClick={() => run("body", async () => setProfile(await api<ProfileT>("/profile/analyze-body", { method: "POST", json: { image_key: k, force: true } })), "체형을 진단했어요")}
          >
            이 사진으로 체형 진단
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={index <= 0 || !!busy}
              loading={busy === "default"}
              onClick={() => run("default", () => patchProfile({ mannequin_images: [k!, ...p.mannequin_images.filter((x) => x !== k)] }), "기본 사진으로 정했어요")}
            >
              {index === 0 ? "기본 사진이에요" : "기본으로"}
            </Button>
            <Button
              variant="danger"
              disabled={!!busy}
              loading={busy === "delete"}
              icon={<TrashIcon size={18} />}
              onClick={async () => {
                if (!(await confirmDialog({ title: "이 사진을 삭제할까요?", message: "다른 곳(피팅 결과 등)에서 쓰지 않으면 사진 파일도 지워져요.", confirmLabel: "삭제", destructive: true }))) return;
                await run("delete", () => patchProfile({ mannequin_images: p.mannequin_images.filter((x) => x !== k) }), "삭제했어요");
              }}
            >
              삭제
            </Button>
          </div>
        </div>
      }
    >
      {k && <Img src={imageUrl(k)} ratio="3 / 4" loading="eager" className="mx-auto w-full max-w-[320px] rounded-lg" />}
    </Sheet>
  );
}

/* ───────── 체형 ───────── */

function BodySection({ profile: p }: { profile: ProfileT }) {
  const a = p.body_analysis;
  const [busy, setBusy] = useState<"analyze" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const photo = p.mannequin_images[0] ?? p.body_image_key;

  const analyze = async (image_key: string | null | undefined) => {
    setBusy("analyze");
    setErr(null);
    try {
      setProfile(await api<ProfileT>("/profile/analyze-body", { method: "POST", json: { image_key: image_key ?? undefined, force: true } }));
      toast("체형을 진단했어요");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: "체형 진단을 지울까요?", confirmLabel: "지우기", destructive: true }))) return;
    setBusy("delete");
    try {
      setProfile(await api<ProfileT>("/profile/analysis/body", { method: "DELETE" }));
      toast("진단 결과를 지웠어요");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const errBox = err && (
    <Notice
      className="mt-4"
      title="체형을 진단하지 못했어요"
      action={
        <Button size="sm" onClick={() => analyze(photo)}>
          다시 시도
        </Button>
      }
    >
      {err}
    </Notice>
  );

  if (busy === "analyze")
    return (
      <Section title="체형">
        <Card>
          <p role="status" className="flex items-center gap-2 text-subhead font-medium text-muted">
            <SparkIcon size={18} /> AI가 어깨너비와 상·하체 비율을 살펴보는 중이에요
          </p>
          <Skeleton className="mt-4 h-7 w-1/3" />
          <SkeletonText lines={4} className="mt-4" />
        </Card>
      </Section>
    );

  if (!a)
    return (
      <Section title="체형">
        <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
            <PersonIcon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-headline">체형 진단</div>
            <p className="mt-0.5 text-subhead text-muted">{photo ? "기본 전신 사진으로 스트레이트·웨이브·내추럴 중 어디에 가까운지 보고 핏 가이드를 드려요." : "먼저 위에 전신 사진을 올려 주세요."}</p>
          </div>
          {photo ? (
            <Button variant="primary" icon={<SparkIcon size={18} />} onClick={() => analyze(photo)}>
              진단하기
            </Button>
          ) : null}
        </Card>
        {errBox}
      </Section>
    );

  return (
    <Section title="체형" action={<span className="text-footnote text-muted">{formatDateTime(a.analyzed_at)}</span>}>
      {p.body_analysis_stale && (
        <Notice
          tone="info"
          className="mb-4"
          title="전신 사진이 바뀌었어요"
          action={
            <Button size="sm" variant="primary" icon={<RefreshIcon size={16} />} onClick={() => analyze(photo)}>
              기본 사진으로 다시 진단
            </Button>
          }
        >
          진단한 뒤에 사진이 바뀌어서 결과가 지금 사진과 다를 수 있어요.
        </Notice>
      )}
      <BodyResult a={a} />
      {errBox}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button icon={<RefreshIcon size={18} />} onClick={() => analyze(photo ?? a.image_key)}>
          다시 진단
        </Button>
        <Button variant="ghost" className="text-danger" icon={<TrashIcon size={18} />} loading={busy === "delete"} onClick={remove}>
          결과 지우기
        </Button>
      </div>
    </Section>
  );
}

function BodyResult({ a }: { a: BodyAnalysis }) {
  return (
    <div className="space-y-6">
      <Card className="flex gap-4">
        <Img src={imageUrl(a.image_key)} ratio="3 / 4" className="w-20 shrink-0 rounded-sm" fallback={<ImageIcon size={18} className="text-faint" />} />
        <div className="min-w-0">
          <Eyebrow>골격 체형</Eyebrow>
          <div className="mt-1 text-title-1">{BODY_TYPE_LABEL[a.body_type]}</div>
          {a.body_type_label && a.body_type_label !== BODY_TYPE_LABEL[a.body_type] && <div className="text-subhead text-muted">{a.body_type_label}</div>}
          <Badge className="mt-2">{CONFIDENCE_LABEL[a.confidence]}</Badge>
        </div>
      </Card>
      {a.proportions && <p className="border-l-2 border-ink pl-4 text-body text-ink-2">{a.proportions}</p>}
      {a.features.length > 0 && (
        <div>
          <h3 className="mb-2 text-subhead font-semibold">특징</h3>
          <div className="flex flex-wrap gap-1.5">
            {a.features.map((f, i) => (
              <Badge key={i} className="h-auto py-1 whitespace-normal">
                {f}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <TipList title="잘 맞는 핏" items={a.fit_tips} icon={<CheckIcon size={18} className="mt-0.5 shrink-0 text-ink" />} />
      <TipList title="피하면 좋은 것" items={a.avoid} icon={<CloseIcon size={18} className="mt-0.5 shrink-0 text-muted" />} />
      {a.caveat && <Notice tone="info">{a.caveat}</Notice>}
    </div>
  );
}

function TipList({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-subhead font-semibold">{title}</h3>
      <ul className="divide-y divide-line rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2.5 px-4 py-3 text-callout text-ink-2">
            {icon}
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

