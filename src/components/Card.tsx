import type { ElementType, ReactNode } from "react";
import { AppLink } from "../lib/router";
import { ChevronRightIcon } from "./icons";

/** 내용을 담는 면. 테두리 대신 아주 옅은 선 + 표면색. */
export function Card({ children, className = "", as: Tag = "section", padded = true }: { children: ReactNode; className?: string; as?: ElementType; padded?: boolean }) {
  return <Tag className={`rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)] ${padded ? "p-4 md:p-5" : ""} ${className}`}>{children}</Tag>;
}

/** 화면 안의 한 구역: 제목 줄(오른쪽에 동작) + 내용 */
export function Section({ title, action, description, children, className = "" }: { title?: ReactNode; action?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-title-2">{title}</h2>}
            {description && <p className="mt-0.5 text-subhead text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** 작은 대문자풍 머리말 (카테고리, 브랜드 등) */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-eyebrow text-muted uppercase ${className}`}>{children}</div>;
}

/** 상태 꼬리표 */
export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "solid" | "danger"; className?: string }) {
  const t = tone === "solid" ? "bg-accent text-accent-ink" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-2";
  return <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-caption font-semibold whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

/** 숫자 하나를 크게 보여 주는 통계 */
export function Stat({ label, value, className = "" }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-footnote text-muted">{label}</div>
      <div className="mt-0.5 text-headline whitespace-nowrap tabular">{value}</div>
    </div>
  );
}

/** 설정 화면식 묶음 목록 */
export function ListGroup({ title, footer, children, className = "" }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {title && <h2 className="mb-2 px-4 text-footnote font-medium text-muted">{title}</h2>}
      <div className="divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_var(--line)]">{children}</div>
      {footer && <p className="mt-2 px-4 text-footnote text-muted">{footer}</p>}
    </div>
  );
}

export interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 오른쪽 값이나 컨트롤 */
  trailing?: ReactNode;
  /** 앱 안 경로. 주면 행 전체가 링크가 되고 화살표가 붙는다 */
  to?: string;
  onClick?: () => void;
  destructive?: boolean;
}

export function ListRow({ icon, title, subtitle, trailing, to, onClick, destructive }: ListRowProps) {
  const inner = (
    <>
      {icon && <span className={`grid size-7 shrink-0 place-items-center ${destructive ? "text-danger" : "text-ink-2"}`}>{icon}</span>}
      <span className="min-w-0 flex-1 py-3">
        <span className={`block text-body ${destructive ? "text-danger" : ""}`}>{title}</span>
        {subtitle && <span className="mt-0.5 block text-footnote text-muted">{subtitle}</span>}
      </span>
      {trailing != null && <span className="flex shrink-0 items-center text-callout text-muted">{trailing}</span>}
      {to && <ChevronRightIcon size={16} className="shrink-0 text-faint" />}
    </>
  );
  const cls = "flex min-h-13 w-full items-center gap-3 px-4 text-left";
  if (to)
    return (
      <AppLink to={to} className={`${cls} transition-colors duration-(--dur-fast) hover:bg-surface-2 active:bg-surface-2`}>
        {inner}
      </AppLink>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`${cls} transition-colors duration-(--dur-fast) hover:bg-surface-2 active:bg-surface-2`}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}
