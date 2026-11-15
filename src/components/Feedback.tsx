import type { ReactNode } from "react";
import { AlertIcon, InfoIcon } from "./icons";

/**
 * 빈 상태. 무엇이 없는지(title) + 왜/어떻게(children) + 바로 할 수 있는 다음 행동(action).
 */
export function Empty({ icon, title, children, action, className = "" }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto flex max-w-sm flex-col items-center px-4 py-14 text-center md:py-20 ${className}`}>
      {icon && <div className="mb-5 grid size-14 place-items-center rounded-full bg-surface-2 text-ink-2">{icon}</div>}
      <h2 className="text-title-2">{title}</h2>
      {children && <p className="mt-2 text-callout text-muted">{children}</p>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * 화면 안 알림 띠. 오류(tone="error")나 안내(tone="info").
 * action에 "다시 시도" 버튼 등을 넣는다.
 */
export function Notice({ tone = "error", title, children, action, className = "" }: { tone?: "error" | "info"; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  if (!children && !title) return null;
  const error = tone === "error";
  return (
    <div role={error ? "alert" : "note"} className={`flex items-start gap-3 rounded-md px-3.5 py-3 text-subhead ${error ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-2"} ${className}`}>
      {error ? <AlertIcon size={18} className="mt-px shrink-0" /> : <InfoIcon size={18} className="mt-px shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={error ? "" : "text-muted"}>{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** 예전 이름 호환: 오류 문구 한 줄 */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Notice tone="error">{children}</Notice>;
}
