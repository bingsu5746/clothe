import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate, MIGRATIONS, parseAddColumn, splitSql, type Migration } from "../worker/lib/migrate";
import { FakeD1 } from "./helpers/env";

const d1 = (db: FakeD1) => db as unknown as D1Database;
const INIT_SQL = readFileSync("migrations/0001_init.sql", "utf8");

function columns(db: FakeD1, table: string): string[] {
  return db.rows<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name);
}

describe("splitSql / parseAddColumn", () => {
  it("0001은 전부 IF NOT EXISTS (운영 DB에서 아무것도 바꾸지 않음)", () => {
    const stmts = splitSql(INIT_SQL);
    expect(stmts.length).toBe(9);
    for (const s of stmts) expect(s).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  });

  it("0002는 CREATE ... IF NOT EXISTS 와 ALTER TABLE ADD COLUMN 만 쓴다", () => {
    for (const s of splitSql(readFileSync("migrations/0002_features.sql", "utf8"))) {
      expect(/^CREATE (TABLE|INDEX) IF NOT EXISTS /.test(s) || parseAddColumn(s) !== null, s).toBe(true);
    }
  });

  it("ADD COLUMN 문장에서 표/컬럼 이름을 뽑는다", () => {
    expect(parseAddColumn("ALTER TABLE wishlist ADD COLUMN validator_score INTEGER")).toEqual({ table: "wishlist", column: "validator_score" });
    expect(parseAddColumn('alter table "t" add "c" TEXT')).toEqual({ table: "t", column: "c" });
    expect(parseAddColumn("CREATE TABLE x (a)")).toBeNull();
  });

  it("MIGRATIONS 버전은 1부터 빈틈없이 이어진다", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });
});

describe("migrate", () => {
  it("빈 DB: 모든 버전을 적용하고 기록한다", async () => {
    const db = new FakeD1();
    expect(await migrate(d1(db))).toEqual([1, 2]);
    expect(db.rows("SELECT version, name FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1, name: "0001_init" },
      { version: 2, name: "0002_features" },
    ]);
    expect(columns(db, "outfit_logs")).toEqual(expect.arrayContaining(["selfie_key", "rating", "occasion_tags", "note"]));
    expect(columns(db, "wishlist")).toEqual(expect.arrayContaining(["validator_score", "validation", "recommended_links"]));
    for (const t of ["profile", "trips", "tryons"]) expect(columns(db, t).length).toBeGreaterThan(0);
  });

  it("두 번 실행해도 아무것도 다시 적용하지 않는다", async () => {
    const db = new FakeD1();
    await migrate(d1(db));
    expect(await migrate(d1(db))).toEqual([]);
    expect(db.rows("SELECT COUNT(*) AS n FROM schema_migrations")).toEqual([{ n: 2 }]);
  });

  it("운영 DB 시뮬레이션: 0001 표 + 데이터만 있고 schema_migrations가 없어도 데이터를 지키며 올라간다", async () => {
    const db = new FakeD1();
    db.exec(INIT_SQL);
    db.exec(`INSERT INTO items (id, name, category, wear_count) VALUES ('i1', '셔츠', 'top', 3);
             INSERT INTO wishlist (id, name) VALUES ('w1', '코트');
             INSERT INTO outfit_logs (id, worn_date, item_ids) VALUES ('l1', '2026-11-01', '["i1"]');
             INSERT INTO settings (key, value) VALUES ('location', '{"lat":37.5}');`);

    expect(await migrate(d1(db))).toEqual([1, 2]);
    expect(db.rows("SELECT id, name, wear_count FROM items")).toEqual([{ id: "i1", name: "셔츠", wear_count: 3 }]);
    expect(db.rows("SELECT id, validator_score, recommended_links FROM wishlist")).toEqual([{ id: "w1", validator_score: null, recommended_links: "[]" }]);
    expect(db.rows("SELECT id, selfie_key, occasion_tags FROM outfit_logs")).toEqual([{ id: "l1", selfie_key: null, occasion_tags: "[]" }]);
    expect(db.rows("SELECT value FROM settings")).toEqual([{ value: '{"lat":37.5}' }]);
  });

  it("컬럼 일부가 이미 있어도(수동 적용 등) 없는 것만 추가한다", async () => {
    const db = new FakeD1();
    db.exec(INIT_SQL);
    db.exec("ALTER TABLE wishlist ADD COLUMN validator_score INTEGER; ALTER TABLE outfit_logs ADD COLUMN note TEXT;");
    expect(await migrate(d1(db))).toEqual([1, 2]);
    expect(columns(db, "wishlist").filter((c) => c === "validator_score")).toHaveLength(1);
    expect(columns(db, "wishlist")).toContain("validation_key");
  });

  it("중간에 실패하면 그 버전 전체를 되돌리고 기록하지 않는다", async () => {
    const db = new FakeD1();
    const broken: Migration[] = [
      { version: 1, name: "ok", sql: "CREATE TABLE a (id TEXT);" },
      { version: 2, name: "broken", sql: "ALTER TABLE a ADD COLUMN x TEXT; INSERT INTO no_such_table VALUES (1);" },
    ];
    await expect(migrate(d1(db), broken)).rejects.toThrow();
    expect(db.rows("SELECT version FROM schema_migrations")).toEqual([{ version: 1 }]);
    expect(columns(db, "a")).toEqual(["id"]); // ADD COLUMN도 롤백됨

    // 고친 뒤 다시 실행하면 이어서 적용된다
    broken[1] = { version: 2, name: "fixed", sql: "ALTER TABLE a ADD COLUMN x TEXT;" };
    expect(await migrate(d1(db), broken)).toEqual([2]);
    expect(columns(db, "a")).toEqual(["id", "x"]);
  });

  it("다른 인스턴스가 동시에 같은 버전을 적용한 경우 오류 없이 넘어간다", async () => {
    const db = new FakeD1();
    const ms: Migration[] = [{ version: 1, name: "one", sql: "CREATE TABLE a (id TEXT);" }];
    // 다른 인스턴스가 먼저 끝낸 상황을 흉내: 표는 없는데(=문장은 성공) 버전 기록이 이미 있어 INSERT가 충돌
    const real = db.batch.bind(db);
    let first = true;
    db.batch = async (stmts) => {
      if (!first && stmts.some((s) => s.sql.startsWith("INSERT INTO schema_migrations"))) {
        db.exec("INSERT INTO schema_migrations (version, name) VALUES (1, 'one')");
      }
      first = false;
      return real(stmts);
    };
    expect(await migrate(d1(db), ms)).toEqual([]);
    expect(db.rows("SELECT version FROM schema_migrations")).toEqual([{ version: 1 }]);
  });
});
