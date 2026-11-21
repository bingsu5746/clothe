import { useAiConfigured } from "../lib/status";
import { Notice } from "./Feedback";
import { AppLink } from "../lib/router";

/**
 * AI 버튼 근처에 두는 차분한 안내. Gemini 키가 없다고 확인됐을 때만 보인다 (모르면 아무것도 안 보임).
 * 버튼은 막지 않는다: 눌러도 서버가 같은 이유를 알려 준다.
 */
export function AiOffNotice({ className = "" }: { className?: string }) {
  const configured = useAiConfigured();
  if (configured !== false) return null;
  return (
    <Notice tone="info" title="AI 기능이 아직 연결되지 않았어요" className={className}>
      Gemini API 키(GEMINI_API_KEY)를 넣으면 쓸 수 있어요.{" "}
      <AppLink to="/settings" className="font-semibold text-ink underline underline-offset-2">
        설정 → 연결 상태
      </AppLink>
    </Notice>
  );
}
