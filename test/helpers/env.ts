import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Env } from "../../worker/env";
import { createSessionToken, SESSION_COOKIE } from "../../worker/lib/auth";

/**
 * 테스트용 D1 흉내: node:sqlite 메모리 DB 위에 D1의 prepare/bind/first/all/run/batch 만 구현.
 * batch는 D1처럼 트랜잭션으로 실행하고 실패하면 전부 되돌린다.
 */
class FakeStatement {
  constructor(private db: DatabaseSync, readonly sql: string, private params: SQLInputValue[] = []) {}

  bind(...params: unknown[]): FakeStatement {
    for (const p of params) {
      if (p === undefined) throw new Error(`D1_TYPE_ERROR: undefined is not supported (sql: ${this.sql})`);
      if (typeof p === "boolean" || (typeof p === "object" && p !== null)) throw new Error(`D1_TYPE_ERROR: unsupported bind value (sql: ${this.sql})`);
    }
    return new FakeStatement(this.db, this.sql, params as SQLInputValue[]);
  }

  /** `?1` 같은 번호 매개변수는 node:sqlite에서 이름 매개변수로 넘겨야 한다 */
  private args(): [Record<string, SQLInputValue>] | SQLInputValue[] {
    if (!/\?\d/.test(this.sql)) return this.params;
    const named: Record<string, SQLInputValue> = {};
    this.params.forEach((p, i) => (named[`?${i + 1}`] = p));
    return [named];
  }

  execute() {
    const stmt = this.db.prepare(this.sql);
    const a = this.args();
    const isRead = /^\s*(SELECT|PRAGMA|WITH)/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql);
    if (isRead) {
      const results = (stmt.all as (...x: unknown[]) => Record<string, unknown>[])(...a).map((r) => ({ ...r }));
      return { results, success: true, meta: { changes: 0 } };
    }
    const info = (stmt.run as (...x: unknown[]) => { changes: number | bigint })(...a);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  }

  async first<T>(): Promise<T | null> {
    return (this.execute().results[0] as T | undefined) ?? null;
  }
  async all<T>() {
    const r = this.execute();
    return { ...r, results: r.results as T[] };
  }
  async run() {
    return this.execute();
  }
}

export class FakeD1 {
  readonly raw = new DatabaseSync(":memory:");
  batches = 0;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.raw, sql);
  }

  async batch(stmts: FakeStatement[]) {
    this.batches++;
    this.raw.exec("BEGIN");
    try {
      const out = stmts.map((s) => s.execute());
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** 테스트에서 바로 조회할 때 */
  rows<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
}

interface Stored {
  data: Uint8Array;
  contentType: string;
}

/** 테스트용 R2 흉내 (메모리) */
export class FakeR2 {
  readonly objects = new Map<string, Stored>();

  async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    const data = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { data, contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream" });
  }

  async get(key: string, opts?: { onlyIf?: Headers }) {
    const o = this.objects.get(key);
    if (!o) return null;
    const httpEtag = `"etag-${key}-${o.data.length}"`;
    const base = { key, size: o.data.length, httpEtag, httpMetadata: { contentType: o.contentType } };
    if (opts?.onlyIf?.get("if-none-match") === httpEtag) return base; // 조건 불일치 → 본문 없는 객체
    return { ...base, body: new Blob([o.data]).stream(), arrayBuffer: async () => o.data.buffer.slice(o.data.byteOffset, o.data.byteOffset + o.data.byteLength) };
  }

  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
}

/** 16자 이상이어야 SESSION_SECRET으로 쓰인다 (worker/lib/auth.ts) */
export const TEST_SECRET = "test-secret-0123456789abcdef";

export interface TestEnv {
  env: Env;
  db: FakeD1;
  bucket: FakeR2;
}

export function makeEnv(overrides: Partial<Env> = {}): TestEnv {
  const db = new FakeD1();
  const bucket = new FakeR2();
  const env = {
    DB: db as unknown as D1Database,
    BUCKET: bucket as unknown as R2Bucket,
    ASSETS: {} as Fetcher,
    GEMINI_MODEL: "gemini-flash-latest",
    TRYON_PROVIDER: "",
    TRYON_MODEL: "",
    APP_PIN: "1234",
    SESSION_SECRET: TEST_SECRET,
    SHORTCUT_TOKEN: "shortcut-token",
    GEMINI_API_KEY: "",
    NAVER_CLIENT_ID: "",
    NAVER_CLIENT_SECRET: "",
    REPLICATE_API_TOKEN: "",
    ...overrides,
  } satisfies Env;
  return { env, db, bucket };
}

export async function sessionCookie(secret = TEST_SECRET): Promise<string> {
  return `${SESSION_COOKIE}=${await createSessionToken(secret)}`;
}

/** Gemini generateContent 응답 모양으로 감싼다 */
export function geminiReply(value: unknown): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] });
}
