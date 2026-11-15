import { useState, type CSSProperties, type ReactNode } from "react";

export interface ImgProps {
  src: string | null | undefined;
  alt?: string;
  /** 가로/세로 비율 (예: "3 / 4"). 자리를 미리 잡아 레이아웃이 밀리지 않게 한다. 부모가 크기를 정하면 생략. */
  ratio?: string;
  fit?: "cover" | "contain";
  /** 목록은 lazy(기본), 화면 맨 위 큰 사진은 eager */
  loading?: "lazy" | "eager";
  /** 사진이 없거나 못 불러왔을 때 보여 줄 내용 */
  fallback?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 불러온 뒤 실제 크기를 알려 준다 */
  onNaturalSize?: (w: number, h: number) => void;
}

const markLoaded = (el: HTMLImageElement | null) => {
  // 캐시에 있어 이미 불러온 사진은 페이드 없이 바로 보이게
  if (el && el.complete && el.naturalWidth > 0) el.dataset.loaded = "true";
};

/**
 * 비율 상자 + 페이드인 이미지.
 * 상자가 먼저 자리를 차지하고(배경 surface-2), 사진은 다 불러온 뒤 부드럽게 나타난다.
 */
export function Img({ src, alt = "", ratio, fit = "cover", loading = "lazy", fallback, className = "", style, onNaturalSize }: ImgProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const show = !!src && failedSrc !== src;
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${className}`} style={{ aspectRatio: ratio, ...style }}>
      {show ? (
        <img
          ref={markLoaded}
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          draggable={false}
          className={`img-fade absolute inset-0 size-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
          onLoad={(e) => {
            e.currentTarget.dataset.loaded = "true";
            onNaturalSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
          }}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">{fallback}</div>
      )}
    </div>
  );
}
