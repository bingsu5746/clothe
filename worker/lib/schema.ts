import { migrate } from "./migrate";

export { splitSql } from "./migrate";

let ready: Promise<void> | null = null;

/**
 * DB 스키마를 최신 버전으로 올린다 (worker/lib/migrate.ts 참고).
 * 배포 때 따로 마이그레이션 명령을 돌리지 않아도 되게 하려는 것. Worker 인스턴스마다 한 번만 실행하고,
 * 실패하면 다음 요청에서 다시 시도한다.
 */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db)
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** 테스트용: 인스턴스 캐시 초기화 */
export function resetSchemaCache(): void {
  ready = null;
}
