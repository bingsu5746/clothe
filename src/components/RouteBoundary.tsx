import { Component, type ErrorInfo, type ReactNode } from "react";
import { reloadOnceForStaleChunk } from "../lib/pwa";
import { Button } from "./Button";
import { Empty } from "./Feedback";
import { RefreshIcon } from "./icons";
import { Skeleton } from "./Skeleton";

/** 화면 코드를 받는 동안: 빈 뼈대 (Layout 안의 Suspense 가 쓴다) */
export function PageFallback() {
  return (
    <div className="px-gutter pt-[calc(var(--safe-top)+var(--bar-h))]" role="status" aria-label="불러오는 중">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="mt-8 h-40 w-full max-w-xl rounded-lg" />
    </div>
  );
}

const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i;

/** 화면 코드를 못 받았거나 화면이 깨졌을 때 */
export class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    // 새로 배포되어 예전 화면 조각이 없어진 경우: 조용히 한 번 새로고침
    if (STALE_CHUNK.test(error.message)) reloadOnceForStaleChunk();
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = STALE_CHUNK.test(error.message);
    return (
      <div className="grid min-h-dvh place-items-center">
        <Empty
          icon={<RefreshIcon size={26} />}
          title="화면을 불러오지 못했어요"
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              다시 시도
            </Button>
          }
        >
          {stale ? "앱이 업데이트되었을 수 있어요. 다시 불러와 주세요." : "잠시 후 다시 시도해 주세요."}
        </Empty>
      </div>
    );
  }
}
