import { useState, type KeyboardEvent } from "react";
import { Chip } from "./Chip";
import { inputCls } from "./Field";
import { CloseIcon, StarIcon } from "./icons";

/** 별점 1~5 고르기. 같은 별을 다시 누르면 지운다. 좌우 화살표 키 지원. */
export function Rating({ value, onChange, label = "평점" }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = Math.min(5, Math.max(1, (value ?? 0) + (e.key === "ArrowRight" ? 1 : -1)));
    onChange(next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex" onKeyDown={onKey}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n}점`}
            tabIndex={value === n || (value == null && n === 1) ? 0 : -1}
            onClick={() => onChange(value === n ? null : n)}
            className={`pressable grid size-11 place-items-center rounded-full ${on ? "text-ink" : "text-faint hover:text-muted"}`}
          >
            <StarIcon size={26} fill={on ? "currentColor" : "none"} />
          </button>
        );
      })}
    </div>
  );
}

/** 읽기 전용 별점 */
export function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  if (!value) return null;
  return (
    <span role="img" aria-label={`${value}점`} className="inline-flex text-ink">
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} fill={n <= value ? "currentColor" : "none"} className={n <= value ? "" : "text-faint"} />
      ))}
    </span>
  );
}

/** 자주 쓰는 태그 칩 + 직접 입력. 값은 문자열 배열. */
export function TagEditor({ value, onChange, suggestions = [], label = "태그", max = 10 }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; label?: string; max?: number }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const tag = t.trim().slice(0, 30);
    if (!tag || value.includes(tag) || value.length >= max) return;
    onChange([...value, tag]);
  };
  const extra = value.filter((t) => !suggestions.includes(t));
  return (
    <div role="group" aria-label={label}>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => {
          const on = value.includes(s);
          return (
            <Chip key={s} active={on} onClick={() => (on ? onChange(value.filter((x) => x !== s)) : add(s))}>
              {s}
            </Chip>
          );
        })}
        {extra.map((t) => (
          <Chip key={t} active onClick={() => onChange(value.filter((x) => x !== t))}>
            {t}
            <CloseIcon size={14} aria-label="빼기" />
          </Chip>
        ))}
      </div>
      <input
        className={`${inputCls} mt-2`}
        placeholder="직접 입력하고 Enter"
        aria-label={`${label} 직접 입력`}
        value={draft}
        enterKeyHint="done"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 한글 조합 중의 Enter/쉼표는 글자를 확정하는 키다 (macOS·iPad 키보드는 조합 중 Enter 와 확정 뒤 Enter 를 둘 다 보낸다).
          // 여기서 태그를 만들면 조합 중인 글자가 확정되면서 입력칸에 마지막 글자가 다시 남아, 칸을 벗어날 때 "강" 같은 태그가 하나 더 생겼다.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
            setDraft("");
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
            setDraft("");
          }
        }}
      />
    </div>
  );
}
