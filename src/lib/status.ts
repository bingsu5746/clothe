import type { AppStatus } from "../../shared/types";
import { useQuery } from "./query";

export const STATUS_PATH = "/status";

/** 선택·외부 기능 연결 상태 (GET /status). 자주 바뀌지 않아서 10분 동안 캐시를 그대로 쓴다. */
export function useAppStatus() {
  return useQuery<AppStatus>(STATUS_PATH, { staleTime: 10 * 60_000 });
}

/** Gemini 키가 있는지. 아직 모르면(불러오는 중·실패) null → 화면은 평소대로 두고 서버 오류 안내에 맡긴다. */
export function useAiConfigured(): boolean | null {
  const { data } = useAppStatus();
  return data ? data.ai.configured : null;
}
