import { useMemo, useRef, useState, type ReactNode } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Item } from "../../shared/types";
import { imageUrl } from "../lib/api";
import { compressImage } from "../lib/image";
import { useItems } from "../lib/items";
import { CheckIcon, HangerIcon } from "./icons";
import { Button, Chip, Sheet } from "./ui";

export function ItemImage({ item, className = "" }: { item: { image_key?: string | null; name?: string } | null | undefined; className?: string }) {
  const src = imageUrl(item?.image_key);
  return (
    <div className={`overflow-hidden rounded-xl bg-surface-2 ${className}`}>
      {src ? (
        <img src={src} alt={item?.name ?? ""} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center p-2 text-center text-xs text-muted">
          <div>
            <HangerIcon className="mx-auto mb-1 opacity-60" />
            {item?.name}
          </div>
        </div>
      )}
    </div>
  );
}

/** 코디 미리보기: 아이템 썸네일을 격자로 */
export function OutfitCollage({ ids, extra }: { ids: string[]; extra?: ReactNode }) {
  const { byId } = useItems();
  const items = ids.map((id) => byId.get(id)).filter(Boolean) as Item[];
  const cols = items.length + (extra ? 1 : 0) <= 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={`grid gap-1.5 ${cols}`}>
      {extra}
      {items.map((i) => (
        <ItemImage key={i.id} item={i} className="aspect-square" />
      ))}
      {ids.length > items.length && <div className="grid aspect-square place-items-center rounded-xl bg-surface-2 text-xs text-muted">삭제된 옷 {ids.length - items.length}</div>}
    </div>
  );
}

export function CategoryFilter({ value, onChange, counts }: { value: Category | "all"; onChange: (v: Category | "all") => void; counts?: Partial<Record<Category, number>> }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      <Chip active={value === "all"} onClick={() => onChange("all")}>전체</Chip>
      {CATEGORIES.filter((c) => !counts || counts[c]).map((c) => (
        <Chip key={c} active={value === c} onClick={() => onChange(c)}>
          {CATEGORY_LABEL[c]}
          {counts?.[c] ? <span className="ml-1 opacity-60">{counts[c]}</span> : null}
        </Chip>
      ))}
    </div>
  );
}

/** 옷장에서 여러 벌 고르기 */
export function ItemPicker({ open, onClose, initial, onDone, title = "옷 고르기" }: { open: boolean; onClose: () => void; initial: string[]; onDone: (ids: string[]) => void; title?: string }) {
  const { items } = useItems();
  const [sel, setSel] = useState<string[]>(initial);
  const [cat, setCat] = useState<Category | "all">("all");
  const shown = useMemo(() => items.filter((i) => cat === "all" || i.category === cat), [items, cat]);
  const counts = useMemo(() => {
    const m: Partial<Record<Category, number>> = {};
    items.forEach((i) => (m[i.category] = (m[i.category] ?? 0) + 1));
    return m;
  }, [items]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <CategoryFilter value={cat} onChange={setCat} counts={counts} />
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {shown.map((i) => {
          const on = sel.includes(i.id);
          return (
            <button key={i.id} onClick={() => toggle(i.id)} className="relative text-left">
              <ItemImage item={i} className={`aspect-square ring-2 ${on ? "ring-accent" : "ring-transparent"}`} />
              {on && (
                <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-accent text-accent-ink">
                  <CheckIcon width={14} height={14} />
                </span>
              )}
              <span className="mt-1 block truncate text-xs">{i.name}</span>
            </button>
          );
        })}
      </div>
      <div className="sticky bottom-0 mt-4 bg-bg pt-2">
        <Button variant="primary" className="w-full" onClick={() => onDone(sel)}>
          {sel.length}벌 선택 완료
        </Button>
      </div>
    </Sheet>
  );
}

/** 사진 고르기/찍기 → 압축된 Blob 전달 */
export function PhotoInput({ onPick, children, className = "", capture }: { onPick: (b: Blob) => void; children: ReactNode; className?: string; capture?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(await compressImage(f));
        }}
      />
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
    </>
  );
}

export function cpw(item: Item): number | null {
  if (!item.purchase_price) return null;
  return item.purchase_price / Math.max(1, item.wear_count);
}
