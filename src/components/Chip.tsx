import type { ReactNode } from "react";

/** 켜고 끄는 알약 버튼 (필터, 여러 개 고르기) */
export function Chip({ active, onClick, children, className = "" }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={!!active}
      onClick={onClick}
      className={`pressable relative inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-subhead font-medium whitespace-nowrap after:absolute after:inset-x-0 after:-inset-y-1 ${
        active ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:bg-surface-3"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * 칩 한 줄. 모바일에서는 화면 끝까지 가로로 스크롤되고(wrap=false), 넓은 화면이나 wrap=true면 줄바꿈.
 */
export function ChipRow({ children, wrap, className = "", label }: { children: ReactNode; wrap?: boolean; className?: string; label?: string }) {
  return (
    <div role="group" aria-label={label} className={`gap-2 ${wrap ? "flex flex-wrap" : "scroll-x bleed-gutter py-1"} ${className}`}>
      {children}
    </div>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

/** 하나만 고르는 세그먼트 컨트롤 (iOS식). 선택 표시가 미끄러지듯 움직인다. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  block = true,
  className = "",
}: {
  value: T | null | undefined;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  /** 스크린 리더용 이름 */
  label: string;
  block?: boolean;
  className?: string;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative grid h-10 auto-cols-fr grid-flow-col rounded-[11px] bg-surface-2 p-[3px] ${block ? "w-full" : "inline-grid"} ${className}`}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const next = options[(Math.max(0, index) + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
        onChange(next.value);
        const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        buttons[options.indexOf(next)]?.focus();
      }}
    >
      {index >= 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] rounded-[8px] bg-surface shadow-2 transition-transform duration-(--dur-slow) ease-emphasized dark:bg-surface-3"
          style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
        />
      )}
      {options.map((o, i) => {
        const on = i === index;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`relative z-[1] flex min-w-0 items-center justify-center gap-1 rounded-[8px] px-2 text-subhead whitespace-nowrap transition-colors duration-(--dur-base) after:absolute after:inset-x-0 after:-inset-y-1 ${on ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
