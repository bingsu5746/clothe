import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LinkProps } from "react-router";
import { AppLink } from "../lib/router";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3",
  outline: "text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger-soft text-danger hover:brightness-95",
};

// 보이는 높이가 44px보다 작은 sm도 ::after로 터치 영역은 44px을 확보한다
const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-subhead relative after:absolute after:inset-x-0 after:-inset-y-1",
  md: "h-11 px-5 text-callout",
  lg: "h-13 px-6 text-body",
};

export function buttonClass({ variant = "secondary", size = "md", block = false, className = "" }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return `pressable inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap disabled:pointer-events-none disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${block ? "w-full" : ""} ${className}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 가로로 꽉 채우기 */
  block?: boolean;
  /** 진행 중: 스피너를 보여 주고 누를 수 없게 */
  loading?: boolean;
  /** 글자 앞 아이콘 */
  icon?: ReactNode;
}

export function Button({ variant, size, block, loading, icon, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass({ variant, size, block, className })}>
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
}

/** 버튼처럼 보이는 링크 (앱 안 이동) */
export function ButtonLink({ variant, size, block, icon, className, children, ...rest }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; icon?: ReactNode }) {
  return (
    <AppLink {...rest} className={buttonClass({ variant, size, block, className: className as string | undefined })}>
      {icon}
      {children}
    </AppLink>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 스크린 리더와 툴팁에 쓰는 이름 (필수) */
  label: string;
  variant?: "ghost" | "filled" | "primary";
  loading?: boolean;
}

export function iconButtonClass(variant: "ghost" | "filled" | "primary" = "ghost", className = "") {
  const v = variant === "primary" ? "bg-accent text-accent-ink hover:opacity-90" : variant === "filled" ? "bg-surface-2 text-ink hover:bg-surface-3" : "text-ink hover:bg-surface-2";
  return `pressable relative grid size-9 shrink-0 place-items-center rounded-full after:absolute after:-inset-1 disabled:pointer-events-none disabled:opacity-40 ${v} ${className}`;
}

/** 아이콘만 있는 둥근 버튼. 보이는 크기 36px, 터치 영역 44px. */
export function IconButton({ label, variant, loading, className, children, type = "button", disabled, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} title={label} disabled={disabled || loading} className={iconButtonClass(variant, className)}>
      {loading ? <Spinner size={16} /> : children}
    </button>
  );
}

/** 버튼 안이나 짧은 대기에만 쓴다. 내용이 들어올 자리는 Skeleton을 쓸 것. */
export function Spinner({ size = 20, small, className = "" }: { size?: number; small?: boolean; className?: string }) {
  const s = small ? 16 : size;
  return (
    <span role="status" aria-label="불러오는 중" className={`inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70 ${className}`} style={{ width: s, height: s }} />
  );
}
