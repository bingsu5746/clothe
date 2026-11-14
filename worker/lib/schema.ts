import initSql from "../../migrations/0001_init.sql?raw";

/** 주석을 지우고 ; 기준으로 SQL 문장을 나눈다 */
export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

let ready: Promise<void> | null = null;

/**
 * 테이블이 없으면 만든다 (모두 IF NOT EXISTS라 여러 번 실행해도 안전).
 * 배포 때 따로 마이그레이션 명령을 돌리지 않아도 되게 하려는 것. Worker 인스턴스마다 한 번만 실행.
 */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= db
    .batch(splitSql(initSql).map((s) => db.prepare(s)))
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
