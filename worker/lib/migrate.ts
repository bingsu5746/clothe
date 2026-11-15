import initSql from "../../migrations/0001_init.sql?raw";
import featuresSql from "../../migrations/0002_features.sql?raw";

/**
 * 런타임 마이그레이터.
 *
 * 배포 때 `wrangler d1 migrations apply`를 돌리지 않으므로 Worker가 직접 스키마를 올린다.
 * - 적용한 버전은 `schema_migrations` 표에 기록한다.
 * - 한 버전의 모든 문장 + 버전 기록은 D1 batch(=트랜잭션) 하나로 실행되어, 중간에 실패하면 전부 되돌려진다.
 * - `ALTER TABLE x ADD COLUMN y`는 SQLite에 IF NOT EXISTS가 없어서, 실행 전에 컬럼이 이미 있는지 확인하고 있으면 건너뛴다.
 * - 버전 1(0001_init.sql)은 전부 `IF NOT EXISTS`라서, 예전 방식(ensureSchema)으로 표가 이미 만들어진 운영 DB에서는
 *   아무것도 바꾸지 않고 버전만 기록한다.
 *
 * 새 마이그레이션을 추가할 때: migrations/000N_*.sql 파일을 만들고 아래 MIGRATIONS 끝에 추가한다.
 * 이미 배포된 파일은 고치지 않는다.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "0001_init", sql: initSql },
  { version: 2, name: "0002_features", sql: featuresSql },
];

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

const ADD_COLUMN_RE = /^ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+(?:COLUMN\s+)?["`]?(\w+)["`]?\s/i;

/** `ALTER TABLE t ADD COLUMN c ...` 문장이면 표/컬럼 이름을 돌려준다 */
export function parseAddColumn(stmt: string): { table: string; column: string } | null {
  const m = stmt.match(ADD_COLUMN_RE);
  return m ? { table: m[1], column: m[2] } : null;
}

const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))";

async function appliedVersions(db: D1Database): Promise<Set<number>> {
  const [, rows] = await db.batch<{ version: number }>([
    db.prepare(CREATE_MIGRATIONS_TABLE),
    db.prepare("SELECT version FROM schema_migrations"),
  ]);
  return new Set(rows.results.map((r) => Number(r.version)));
}

async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  // table 이름은 parseAddColumn의 \w+ 만 통과하므로 그대로 넣어도 안전하다
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(results.map((r) => String(r.name).toLowerCase()));
}

async function applyMigration(db: D1Database, m: Migration): Promise<void> {
  const columns = new Map<string, Set<string>>();
  const stmts: D1PreparedStatement[] = [];
  for (const sql of splitSql(m.sql)) {
    const add = parseAddColumn(sql);
    if (add) {
      let cols = columns.get(add.table);
      if (!cols) {
        cols = await tableColumns(db, add.table);
        columns.set(add.table, cols);
      }
      const col = add.column.toLowerCase();
      if (cols.has(col)) continue; // 이미 있는 컬럼
      cols.add(col);
    }
    stmts.push(db.prepare(sql));
  }
  stmts.push(db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").bind(m.version, m.name));
  await db.batch(stmts);
}

/** 아직 적용하지 않은 마이그레이션을 버전 순서대로 적용하고, 이번에 적용한 버전 목록을 돌려준다. */
export async function migrate(db: D1Database, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  let applied = await appliedVersions(db);
  const done: number[] = [];
  for (const m of ordered) {
    if (applied.has(m.version)) continue;
    try {
      await applyMigration(db, m);
      done.push(m.version);
    } catch (e) {
      // 다른 Worker 인스턴스가 동시에 같은 버전을 적용했을 수 있다 → 기록을 다시 확인
      applied = await appliedVersions(db);
      if (!applied.has(m.version)) throw e;
    }
  }
  return done;
}
