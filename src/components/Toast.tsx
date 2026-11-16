import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/hooks";

/**
 * 짧은 알림. 어디서든 toast("저장했어요") 로 띄운다.
 * 오류는 toast.error("…"), 되돌리기 같은 동작은 { action: { label, onClick } }.
 * 앱 최상위에 <ToastHost />가 한 번 있어야 한다.
 */
export interface ToastOptions {
  tone?: "default" | "error";
  action?: { label: string; onClick: () => void };
  /** 보이는 시간(ms). 0이면 직접 닫거나 다음 토스트가 올 때까지 유지 */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

let current: ToastState | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function toast(message: string, options: ToastOptions = {}) {
  current = { id: ++seq, message, ...options };
  emit();
}
toast.error = (message: string, options: ToastOptions = {}) => toast(message, { ...options, tone: "error" });
toast.dismiss = () => {
  current = null;
  emit();
};

let lastShown: ToastState | null = null;

export function ToastHost() {
  const state = useSyncExternalStore(subscribe, () => current);
  const { mounted, closing } = usePresence(!!state, 180);
  if (state) lastShown = state;
  const shown = state ?? lastShown;

  useEffect(() => {
    if (!state) return;
    const ms = state.duration ?? (state.action ? 5000 : state.tone === "error" ? 4000 : 2400);
    if (ms <= 0) return;
    const t = setTimeout(() => {
      if (current?.id === state.id) toast.dismiss();
    }, ms);
    return () => clearTimeout(t);
  }, [state]);

  if (!mounted || !shown) return null;
  return createPortal(
    <div className="vt-toast pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-inset)+16px)] z-[80] flex justify-center px-4 md:bottom-8 md:pl-(--nav-w)">
      <div
        key={shown.id}
        role={shown.tone === "error" ? "alert" : "status"}
        aria-live={shown.tone === "error" ? "assertive" : "polite"}
        className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-full py-2.5 pr-2.5 pl-5 text-subhead font-medium shadow-3 ${
          shown.tone === "error" ? "bg-danger text-white dark:text-[#141413]" : "bg-ink text-bg"
        } ${closing ? "animate-fade-out" : "animate-rise-in"}`}
      >
        <span className="min-w-0 py-0.5 pr-2.5">{shown.message}</span>
        {shown.action && (
          <button
            type="button"
            className="pressable -my-1 shrink-0 rounded-full bg-white/20 px-3.5 py-1.5 font-semibold dark:bg-black/15"
            onClick={() => {
              shown.action?.onClick();
              toast.dismiss();
            }}
          >
            {shown.action.label}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
