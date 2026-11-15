import type { CSSProperties } from "react";

/** 내용이 들어올 자리를 미리 잡아 두는 회색 블록. 크기는 className(예: "h-4 w-24")이나 style로. */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={`skeleton ${className}`} style={style} />;
}

/** 글 여러 줄 */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

/** 사진 타일 + 두 줄 글 (옷 카드 모양) */
export function SkeletonTile({ ratio = "3 / 4" }: { ratio?: string }) {
  return (
    <div aria-hidden>
      <Skeleton className="w-full rounded-md" style={{ aspectRatio: ratio }} />
      <Skeleton className="mt-2.5 h-3.5 w-3/4" />
      <Skeleton className="mt-1.5 h-3 w-1/2" />
    </div>
  );
}

/** 목록 화면용: 타일 여러 개. className에 실제 목록과 같은 grid 클래스를 준다. */
export function SkeletonGrid({ count = 8, ratio, className = "" }: { count?: number; ratio?: string; className?: string }) {
  return (
    <div role="status" aria-label="불러오는 중" className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonTile key={i} ratio={ratio} />
      ))}
    </div>
  );
}
