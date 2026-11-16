import { useCallback, useId, useRef, useState, useSyncExternalStore, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/hooks";
import { buttonClass } from "./Button";
import { inputCls } from "./Field";
import { useModal } from "./Sheet";

/**
 * window.confirm / window.prompt 대신 쓰는 대화상자.
 *
 *   if (await confirmDialog({ title: "이 옷을 삭제할까요?", destructive: true, confirmLabel: "삭제" })) …
 *   const name = await promptDialog({ title: "코디 이름", defaultValue: "내 코디" });  // 취소하면 null
 *
 * 앱 최상위에 <DialogHost />가 한 번 있어야 한다 (App.tsx).
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 삭제처럼 되돌릴 수 없는 동작이면 true (확인 버튼이 빨간색) */
  destructive?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  /** true면 빈 값으로도 확인할 수 있다 (기본: 빈 값이면 확인 버튼이 꺼짐) */
  allowEmpty?: boolean;
}

type Request =
  | { kind: "confirm"; id: number; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; id: number; options: PromptOptions; resolve: (v: string | null) => void };

let current: Request | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function dismissCurrent() {
  if (!current) return;
  if (current.kind === "confirm") current.resolve(false);
  else current.resolve(null);
  current = null;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dismissCurrent();
    current = { kind: "confirm", id: ++seq, options, resolve };
    emit();
  });
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    dismissCurrent();
    current = { kind: "prompt", id: ++seq, options, resolve };
    emit();
  });
}

export function DialogHost() {
  const request = useSyncExternalStore(subscribe, () => current);
  // 닫히는 애니메이션 동안에도 내용을 보여 주기 위해 마지막 요청을 기억한다
  const [last, setLast] = useState<Request | null>(null);
  if (request && request !== last) setLast(request);
  const { mounted, closing } = usePresence(!!request, 160);
  const shown = request ?? last;
  if (!mounted || !shown) return null;
  return <DialogView key={shown.id} request={shown} closing={closing} />;
}

function DialogView({ request, closing }: { request: Request; closing: boolean }) {
  const { options } = request;
  const panelRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(request.kind === "prompt" ? (request.options.defaultValue ?? "") : "");

  const finish = useCallback(
    (ok: boolean) => {
      if (current !== request) return;
      if (request.kind === "confirm") request.resolve(ok);
      else request.resolve(ok ? value.trim() : null);
      current = null;
      emit();
    },
    [request, value],
  );
  const cancel = useCallback(() => finish(false), [finish]);
  useModal(!closing, cancel, panelRef);

  const canSubmit = request.kind === "confirm" || request.options.allowEmpty || value.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-6">
      <div className={`absolute inset-0 bg-scrim ${closing ? "animate-fade-out" : "animate-fade-in"}`} onClick={cancel} />
      <form
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full max-w-[340px] rounded-xl bg-surface p-5 shadow-3 outline-none ${closing ? "animate-pop-out" : "animate-pop-in"}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) finish(true);
        }}
      >
        <h2 id={titleId} className="text-headline">
          {options.title}
        </h2>
        {options.message && <p className="mt-1.5 text-subhead text-muted">{options.message}</p>}
        {request.kind === "prompt" && (
          <input
            data-autofocus
            aria-label={request.options.label ?? options.title}
            className={`${inputCls} mt-4`}
            value={value}
            placeholder={request.options.placeholder}
            inputMode={request.options.inputMode}
            enterKeyHint="done"
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className={buttonClass({ variant: "secondary" })} onClick={cancel}>
            {options.cancelLabel ?? "취소"}
          </button>
          <button type="submit" disabled={!canSubmit} data-autofocus={request.kind === "confirm" ? "" : undefined} className={buttonClass({ variant: options.destructive ? "danger" : "primary" })}>
            {options.confirmLabel ?? "확인"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
