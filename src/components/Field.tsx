import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { SearchIcon } from "./icons";

/** 입력칸 공통 모양. 글자 16px(확대 방지), 높이 48px, 채운 배경. */
export const inputCls =
  "block w-full min-h-12 rounded-md bg-surface-2 px-3.5 text-[16px] text-ink outline-none transition-shadow duration-(--dur-fast) placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--ink)] disabled:opacity-50";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${inputCls} ${className}`} />;
}

/**
 * 칸을 벗어나면 저장하는 입력칸 (defaultValue 로 시작하는 비제어 입력).
 * onCommit 은 값이 마지막으로 저장한 값과 다를 때만 불린다:
 * - 칸을 벗어날 때(blur), Enter(키보드 "완료")
 * - 칸에서 벗어나지 않은 채 화면이 사라질 때(뒤로 가기·탭 이동으로 언마운트) — 지워진 요소에는 blur 가 오지 않아서 예전에는 고친 값이 사라졌다
 * - 앱이 백그라운드로 갈 때(홈 화면으로 나가기, 앱 전환)
 * 값이 바뀌어 처음부터 다시 그려야 하면 부모가 key 를 바꾼다.
 */
export function CommitInput({ defaultValue = "", onCommit, onKeyDown, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onBlur" | "onChange"> & { defaultValue?: string | number; onCommit: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const last = useRef(String(defaultValue));
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    const flush = () => {
      if (!el || el.value === last.current) return;
      last.current = el.value;
      commitRef.current(el.value);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    el?.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      el?.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, []);
  return (
    <input
      ref={ref}
      {...rest}
      defaultValue={defaultValue}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur();
      }}
      className={`${inputCls} ${rest.className ?? ""}`}
    />
  );
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${inputCls} min-h-24 resize-y py-3 leading-normal ${className}`} />;
}

/** 검색칸 (돋보기 아이콘 포함) */
export function SearchInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input type="search" enterKeyHint="search" autoComplete="off" {...rest} className={`${inputCls} min-h-11 pl-10 [&::-webkit-search-cancel-button]:appearance-none`} />
    </div>
  );
}

export interface FieldProps {
  label: string;
  /** 라벨 오른쪽의 보조 설명이나 값 */
  hint?: ReactNode;
  children: ReactNode;
  /**
   * 버튼 묶음(Chip, Segmented)처럼 입력칸이 아닌 내용일 때 true.
   * <label>로 감싸면 첫 버튼이 대신 눌리므로 role="group"으로 묶는다.
   */
  group?: boolean;
  className?: string;
}

/** 라벨 + 입력칸 한 묶음 */
export function Field({ label, hint, children, group, className = "" }: FieldProps) {
  const head = (
    <span className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-footnote font-medium text-muted">{label}</span>
      {hint != null && <span className="text-footnote text-muted tabular">{hint}</span>}
    </span>
  );
  if (group)
    return (
      <div role="group" aria-label={label} className={`block ${className}`}>
        {head}
        {children}
      </div>
    );
  return (
    <label className={`block ${className}`}>
      {head}
      {children}
    </label>
  );
}

/** iOS식 켜고 끄기 스위치 */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-(--dur-base) after:absolute after:-inset-1.5 disabled:opacity-40 ${checked ? "bg-accent" : "bg-surface-3"}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] size-[27px] rounded-full shadow-2 transition-transform duration-(--dur-base) ease-emphasized ${checked ? "translate-x-5 bg-accent-ink" : "bg-white"}`}
      />
    </button>
  );
}
