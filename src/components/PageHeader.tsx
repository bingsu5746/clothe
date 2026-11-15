import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGoBack, useNav } from "../lib/router";
import { IconButton } from "./Button";
import { BackIcon, CloseIcon } from "./icons";

export type PageWidth = "narrow" | "default" | "wide";
const WIDTH: Record<PageWidth, string> = {
  narrow: "mx-auto w-full max-w-[680px]",
  default: "mx-auto w-full max-w-[1120px]",
  wide: "w-full",
};

export interface PageHeaderProps {
  title: string;
  /** 큰 제목 위의 작은 글 (날짜, 개수 등) */
  eyebrow?: ReactNode;
  /** 큰 제목 아래 설명 */
  subtitle?: ReactNode;
  /** 뒤로 버튼. 문자열이면 돌아갈 경로(직접 진입했을 때의 목적지), true면 history.back() */
  back?: boolean | string;
  /** 뒤로 버튼 모양: 분할 보기의 오른쪽 패널처럼 "닫는" 화면이면 close */
  backStyle?: "back" | "close";
  /** 오른쪽 동작 (IconButton, 작은 Button) */
  right?: ReactNode;
  /** 큰 제목을 쓸지. 기본: back이 없으면(최상위 화면) 큰 제목 */
  large?: boolean;
  width?: PageWidth;
}

/**
 * 화면 머리.
 * - 위에 붙는 얇은 바(뒤로, 작은 제목, 동작) + 그 아래 큰 제목.
 * - 스크롤해서 큰 제목이 바 밑으로 들어가면 작은 제목이 나타나고 바에 반투명 배경이 깔린다 (iOS 큰 제목 방식).
 * - 상단 안전 영역(노치)은 바가 알아서 비운다.
 */
export function PageHeader({ title, eyebrow, subtitle, back, backStyle = "back", right, large = !back, width = "default" }: PageHeaderProps) {
  const nav = useNav();
  const goBack = useGoBack();
  const barRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    const sentinel = sentinelRef.current;
    if (!bar || !sentinel || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px`, threshold: 0 });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [large]);

  return (
    <>
      {!large && <div ref={sentinelRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" />}
      <div
        ref={barRef}
        className={`sticky top-0 z-20 pt-safe transition-[background-color,box-shadow] duration-(--dur-base) ${scrolled ? "bar-material hairline-b" : ""}`}
      >
        <div className={`relative flex h-(--bar-h) items-center gap-1 px-gutter ${WIDTH[width]}`}>
          {back && (
            <IconButton label={backStyle === "close" ? "닫기" : "뒤로"} className="-ml-2" onClick={() => (typeof back === "string" ? goBack(back) : nav(-1))}>
              {backStyle === "close" ? <CloseIcon /> : <BackIcon />}
            </IconButton>
          )}
          <div
            aria-hidden={large && !scrolled}
            className={`pointer-events-none absolute inset-x-0 mx-auto max-w-[56%] truncate text-center text-headline transition-[opacity,transform] duration-(--dur-base) ${
              large && !scrolled ? "translate-y-1 opacity-0" : "opacity-100"
            }`}
          >
            {large ? title : <h1 className="truncate">{title}</h1>}
          </div>
          <div className="ml-auto flex items-center gap-1.5">{right}</div>
        </div>
      </div>
      {large && (
        <div className={`px-gutter pt-1 pb-4 md:pt-2 md:pb-6 ${WIDTH[width]}`}>
          {eyebrow && <div className="mb-1 text-subhead font-medium text-muted">{eyebrow}</div>}
          <h1 className="text-large-title md:text-[2.5rem]">{title}</h1>
          <div ref={sentinelRef} aria-hidden className="h-px" />
          {subtitle && <p className="mt-2 max-w-prose text-callout text-muted">{subtitle}</p>}
        </div>
      )}
    </>
  );
}

export interface PageProps extends PageHeaderProps {
  children: ReactNode;
  /** 본문 영역 추가 클래스 */
  className?: string;
}

/**
 * 화면 하나의 뼈대: PageHeader + 좌우 여백과 최대 폭이 잡힌 본문 + 아래 탭 바만큼의 여백.
 * 모든 화면은 이걸로 감싼다.
 */
export function Page({ children, className = "", width = "default", ...header }: PageProps) {
  return (
    <div className="page-enter relative">
      <PageHeader {...header} width={width} />
      <div className={`px-gutter pb-[calc(var(--bottom-inset)+40px)] ${WIDTH[width]} ${className}`}>{children}</div>
    </div>
  );
}
