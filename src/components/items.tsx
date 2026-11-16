import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Item } from "../../shared/types";
import { imageUrl, won } from "../lib/api";
import { compressImage } from "../lib/image";
import { cpw, useItems } from "../lib/items";
import { AppLink } from "../lib/router";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { Empty } from "./Feedback";
import { Img } from "./Img";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";
import { CheckIcon, HangerIcon } from "./icons";

export { cpw };

/** 옷 타일의 기본 비율. 배경을 지운 사진도 이 비율로 다듬어 저장한다 (lib/image.ts composeCutout). */
export const ITEM_RATIO = "3 / 4";

type ImageSource = { image_key?: string | null; name?: string } | null | undefined;

/** 옷 사진 한 장. 사진이 없으면 옷걸이 아이콘과 이름. */
export function ItemImage({ item, className = "", ratio = ITEM_RATIO, loading, showName = true }: { item: ImageSource; className?: string; ratio?: string | null; loading?: "lazy" | "eager"; showName?: boolean }) {
  return (
    <Img
      src={imageUrl(item?.image_key)}
      alt={item?.name ?? ""}
      ratio={ratio ?? undefined}
      loading={loading}
      className={`rounded-md ${className}`}
      fallback={
        <div className="flex flex-col items-center gap-1.5 p-2 text-center text-caption text-faint">
          <HangerIcon size={24} />
          {showName && item?.name && <span className="line-clamp-2">{item.name}</span>}
        </div>
      }
    />
  );
}

/** 옷장 격자의 옷 카드: 사진 + 브랜드 + 이름 + 착용/회당 가격 */
export const ItemCard = memo(function ItemCard({ item, to, selected, preventScrollReset }: { item: Item; to: string; selected?: boolean; preventScrollReset?: boolean }) {
  const c = cpw(item);
  return (
    <AppLink to={to} preventScrollReset={preventScrollReset} aria-current={selected ? "true" : undefined} className="pressable-soft group block min-w-0 rounded-md">
      <ItemImage item={item} showName={false} className={`transition-shadow duration-(--dur-base) ${selected ? "shadow-[0_0_0_2px_var(--ink)]" : "group-hover:shadow-[0_0_0_1px_var(--line-strong)]"}`} />
      <div className="px-0.5 pt-2.5">
        {item.brand && <div className="truncate text-eyebrow text-muted uppercase">{item.brand}</div>}
        <div className="truncate text-subhead font-medium">{item.name}</div>
        <div className="truncate text-footnote text-muted tabular">
          {item.wear_count > 0 ? `${item.wear_count}회 착용` : "아직 안 입음"}
          {c != null && ` · 회당 ${won(c)}`}
        </div>
      </div>
    </AppLink>
  );
});

/**
 * 코디 미리보기: 옷 사진을 한 줄로. 4벌까지 그대로, 더 많으면 마지막 칸에 "+N".
 * extra 는 맨 앞에 끼워 넣는 타일 (위시리스트의 "새 옷" 등).
 */
export function OutfitCollage({ ids, extra, max = 4 }: { ids: string[]; extra?: ReactNode; max?: number }) {
  const { byId } = useItems();
  const items = ids.map((id) => byId.get(id)).filter((x): x is Item => !!x);
  const missing = ids.length - items.length;
  const slots = max - (extra ? 1 : 0);
  const overflow = items.length > slots ? items.length - (slots - 1) : 0;
  const shown = overflow ? items.slice(0, slots - 1) : items;
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {extra}
      {shown.map((i) => (
        <ItemImage key={i.id} item={i} className="rounded-sm" showName={false} />
      ))}
      {overflow > 0 && (
        <div className="grid place-items-center rounded-sm bg-surface-2 text-subhead font-semibold text-muted tabular" style={{ aspectRatio: ITEM_RATIO }}>
          +{overflow}
        </div>
      )}
      {missing > 0 && !overflow && shown.length + (extra ? 1 : 0) < max && (
        <div className="grid place-items-center rounded-sm bg-surface-2 p-1 text-center text-caption text-faint" style={{ aspectRatio: ITEM_RATIO }}>
          삭제된 옷 {missing}
        </div>
      )}
    </div>
  );
}

export function CategoryFilter({ value, onChange, counts, wrap }: { value: Category | "all"; onChange: (v: Category | "all") => void; counts?: Partial<Record<Category, number>>; wrap?: boolean }) {
  return (
    <ChipRow label="카테고리" wrap={wrap}>
      <Chip active={value === "all"} onClick={() => onChange("all")}>
        전체
      </Chip>
      {CATEGORIES.filter((c) => !counts || counts[c]).map((c) => (
        <Chip key={c} active={value === c} onClick={() => onChange(c)}>
          {CATEGORY_LABEL[c]}
          {counts?.[c] ? <span className="opacity-60 tabular">{counts[c]}</span> : null}
        </Chip>
      ))}
    </ChipRow>
  );
}

export function countByCategory(items: Item[]): Partial<Record<Category, number>> {
  const m: Partial<Record<Category, number>> = {};
  for (const i of items) m[i.category] = (m[i.category] ?? 0) + 1;
  return m;
}

/** 옷장에서 여러 벌 고르기 (시트) */
export function ItemPicker({ open, onClose, initial, onDone, title = "옷 고르기", doneLabel }: { open: boolean; onClose: () => void; initial: string[]; onDone: (ids: string[]) => void; title?: string; doneLabel?: string }) {
  const { items, loading } = useItems();
  const [sel, setSel] = useState<string[]>(initial);
  const [cat, setCat] = useState<Category | "all">("all");
  const shown = useMemo(() => items.filter((i) => cat === "all" || i.category === cat), [items, cat]);
  const counts = useMemo(() => countByCategory(items), [items]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <Button variant="primary" block disabled={sel.length === 0} onClick={() => onDone(sel)}>
          {sel.length > 0 ? `${sel.length}벌 ${doneLabel ?? "선택 완료"}` : "옷을 골라 주세요"}
        </Button>
      }
    >
      {!loading && items.length === 0 ? (
        <Empty icon={<HangerIcon size={26} />} title="옷장이 비어 있어요">
          먼저 옷장에 옷을 등록해 주세요.
        </Empty>
      ) : (
        <>
          <div className="-mx-5 px-5 [--gutter:20px] md:-mx-6 md:px-6 md:[--gutter:24px]">
            <CategoryFilter value={cat} onChange={setCat} counts={counts} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5">
            {shown.map((i) => {
              const on = sel.includes(i.id);
              return (
                <button key={i.id} type="button" aria-pressed={on} onClick={() => toggle(i.id)} className="pressable-soft relative rounded-md text-left">
                  <ItemImage item={i} showName={false} className={`transition-shadow duration-(--dur-fast) ${on ? "shadow-[0_0_0_2px_var(--ink)]" : ""}`} />
                  <span
                    aria-hidden
                    className={`absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full transition-[background-color,transform] duration-(--dur-fast) ${on ? "bg-accent text-accent-ink" : "scale-90 bg-black/15 text-transparent shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.9)]"}`}
                  >
                    <CheckIcon size={14} strokeWidth={2.4} />
                  </span>
                  <span className="mt-1.5 block truncate text-footnote">{i.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * 사진 고르기/찍기 버튼. 고른 사진은 방향을 바로잡고 줄여서 압축한 Blob 으로 넘겨준다.
 * className 으로 버튼 모양을 준다 (buttonClass(...) 사용).
 */
export function PhotoInput({ onPick, children, className = "", capture, disabled, label }: { onPick: (b: Blob) => void; children: ReactNode; className?: string; capture?: boolean; disabled?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        className="hidden"
        tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            onPick(await compressImage(f));
          } catch (err) {
            toast.error((err as Error).message || "이미지를 읽지 못했어요");
          }
        }}
      />
      <button type="button" aria-label={label} title={label} disabled={disabled} className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
    </>
  );
}
