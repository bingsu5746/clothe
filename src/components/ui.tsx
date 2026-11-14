import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { BackIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", loading, className = "", children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink",
    secondary: "bg-surface border border-line text-ink",
    ghost: "text-ink hover:bg-surface-2",
    danger: "bg-surface border border-line text-danger",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? "size-4" : "size-6"}`} />;
}

export function PageHeader({ title, back, right }: { title: string; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 flex min-h-14 items-center gap-2 bg-bg/90 px-4 pt-safe backdrop-blur md:-mx-8 md:px-8">
      {back && (
        <button
          aria-label="뒤로"
          onClick={() => (typeof back === "string" ? nav(back) : nav(-1))}
          className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-surface-2"
        >
          <BackIcon />
        </button>
      )}
      <h1 className="flex-1 truncate text-xl font-bold tracking-tight">{title}</h1>
      {right}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{children}</p>;
}

/** group=true: 버튼 묶음처럼 input이 아닌 내용 (label로 감싸면 첫 버튼이 눌리는 문제 방지) */
export function Field({ label, children, group }: { label: string; children: ReactNode; group?: boolean }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block" role={group ? "group" : undefined} aria-label={group ? label : undefined}>
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
    </Tag>
  );
}

export const inputCls = "w-full min-h-11 rounded-xl border border-line bg-surface px-3 text-[16px] outline-none focus:border-accent";

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink"}`}
    >
      {children}
    </button>
  );
}

/** 아래에서 올라오는 시트 (모바일) / 가운데 모달 (데스크톱) */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full flex-col rounded-t-3xl bg-bg pb-safe md:max-w-2xl md:rounded-3xl md:pb-0"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-sm font-semibold text-muted hover:bg-surface-2">
            닫기
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-8">
      <div className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg shadow-lg">{message}</div>
    </div>
  );
}

const TOAST_EVENT = "app-toast";
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const fn = (e: Event) => setMsg((e as CustomEvent<string>).detail);
    window.addEventListener(TOAST_EVENT, fn);
    return () => window.removeEventListener(TOAST_EVENT, fn);
  }, []);
  return <Toast message={msg} onDone={() => setMsg(null)} />;
}
