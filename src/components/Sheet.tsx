import { useCallback, useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/hooks";
import { IconButton } from "./Button";
import { CloseIcon } from "./icons";

/* 열려 있는 모달 수. 하나라도 열려 있으면 앱 본문(#root)을 비활성화하고 스크롤을 잠근다. */
let openModals = 0;
function lockApp() {
  openModals++;
  if (openModals === 1) {
    document.getElementById("root")?.setAttribute("inert", "");
    document.documentElement.style.overflow = "hidden";
  }
}
function unlockApp() {
  openModals = Math.max(0, openModals - 1);
  if (openModals === 0) {
    document.getElementById("root")?.removeAttribute("inert");
    document.documentElement.style.overflow = "";
  }
}

/** 모달 공통: 열릴 때 포커스를 안으로 옮기고, 닫히면 원래 자리로. Esc로 닫기. 바깥은 inert. */
export function useModal(active: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    lockApp();
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const auto = panel.querySelector<HTMLElement>("[data-autofocus]");
      (auto ?? panel).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlockApp();
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, onClose, panelRef]);
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 아래에 고정되는 동작 영역 (주 버튼 등) */
  footer?: ReactNode;
  /** 넓은 화면에서의 최대 폭 */
  size?: "md" | "lg";
}

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.55; // px/ms

/**
 * 모바일: 아래에서 올라오는 시트. 손잡이/제목 줄을 잡고 아래로 끌어내리면 닫힌다.
 * 태블릿·데스크톱: 가운데 모달.
 * 바깥을 누르거나 Esc로도 닫힌다.
 */
export function Sheet({ open, onClose, title, children, footer, size = "md" }: SheetProps) {
  const { mounted, closing } = usePresence(open, 320);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startY: number; lastY: number; lastT: number; velocity: number } | null>(null);
  const titleId = useId();
  useModal(mounted && !closing, onClose, panelRef);

  const setOffset = useCallback((y: number, animate: boolean) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = animate ? "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)" : "none";
    panel.style.transform = y ? `translateY(${y}px)` : "";
    panel.style.setProperty("--drag-y", `${y}px`);
    if (backdropRef.current) {
      backdropRef.current.style.transition = animate ? "opacity 320ms" : "none";
      backdropRef.current.style.opacity = y ? String(Math.max(0.2, 1 - y / (panel.offsetHeight || 1))) : "";
    }
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("button, a, input")) return;
    drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const dy = e.clientY - d.startY;
    // 위로는 고무줄처럼 조금만
    setOffset(dy >= 0 ? dy : -Math.sqrt(-dy) * 2, false);
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const dy = e.clientY - d.startY;
    if (dy > DISMISS_DISTANCE || (dy > 24 && d.velocity > DISMISS_VELOCITY)) {
      // 끌던 위치(--drag-y)에서 이어서 내려가도록 나가는 애니메이션에 넘긴다
      const panel = panelRef.current;
      if (panel) {
        panel.style.transition = "none";
        panel.style.transform = "";
      }
      onClose();
    } else setOffset(0, true);
  };

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div ref={backdropRef} className={`absolute inset-0 bg-scrim ${closing ? "animate-fade-out [animation-duration:var(--dur-slow)]" : "animate-fade-in"}`} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[calc(100dvh-var(--safe-top)-24px)] w-full flex-col rounded-t-xl bg-bg shadow-3 outline-none md:max-h-[min(86dvh,820px)] md:rounded-xl ${size === "lg" ? "md:max-w-3xl" : "md:max-w-xl"} ${
          closing ? "animate-sheet-out md:animate-pop-out" : "animate-sheet-in md:animate-pop-in"
        }`}
      >
        <div className="shrink-0 touch-none select-none md:touch-auto" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
          <div aria-hidden className="mx-auto mt-2 h-[5px] w-9 rounded-full bg-line-strong md:hidden" />
          <div className="flex items-center justify-between gap-3 pt-2 pr-3 pb-2 pl-5 md:pt-4 md:pr-4 md:pl-6">
            <h2 id={titleId} className="min-w-0 truncate text-title-2">
              {title}
            </h2>
            <IconButton label="닫기" variant="filled" onClick={onClose}>
              <CloseIcon size={18} />
            </IconButton>
          </div>
        </div>
        <div className={`scroll-y thin-scrollbar min-h-0 flex-1 px-5 md:px-6 ${footer ? "pb-4" : "pb-[calc(var(--safe-bottom)+20px)] md:pb-6"}`}>{children}</div>
        {footer && <div className="hairline-t shrink-0 px-5 pt-3 pb-[calc(var(--safe-bottom)+12px)] md:px-6 md:pb-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
