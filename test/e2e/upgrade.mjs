#!/usr/bin/env node
/**
 * 운영 DB 업그레이드 경로 E2E (`npm run e2e` 의 두 번째 단계).
 *
 * 운영 D1에는 0001 스키마로 만든 실제 데이터가 있고, 배포 후 첫 요청 때 worker/lib/migrate.ts 가 2 → 3 버전을 올린다.
 * 이 경로를 FakeD1이 아닌 진짜 로컬 D1(workerd/miniflare)에서 확인한다.
 *  1. 격리된 임시 폴더에 0001_init.sql 만 적용한 D1 + 예전 데이터(착용일, 기록, 깨진 JSON, 콜라주 메모, 로그인 키, 위치) + R2 사진을 만든다.
 *  2. 서버(포트 5185, E2E_UPGRADE_PORT)를 띄우고 첫 요청을 동시에 여러 개 보낸다 → 5xx 없음, 버전 1·2·3이 한 번씩만 기록.
 *  3. 데이터 보존(기준 착용일, 콜라주 종류, 설정)과 착용·기록 수정·삭제, 대표 그림, 공유 사진 정리를 확인한다.
 *  4. 서버를 다시 띄워서 마이그레이션이 다시 돌지 않는지(멱등) 확인한다.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.E2E_PORT = process.env.E2E_UPGRADE_PORT ?? "5185";
const H = await import("./harness.mjs");
const { api, fail, ok, png } = H;

const STATE = join(H.TMP, "state");
const config = H.writeIsolatedConfig();
const wrangler = (args) =>
  execFileSync(join(H.ROOT, "node_modules/.bin/wrangler"), [...args, "--local", "--persist-to", STATE, "-c", config], { cwd: H.TMP, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/**
 * 서버가 떠 있는 동안에는 wrangler d1 execute 를 쓰지 않는다 (같은 SQLite 파일을 다른 프로세스가 쓰면 로컬 workerd 연결이 끊긴다).
 * 대신 D1 의 SQLite 파일을 읽기 전용으로 직접 연다.
 */
const sql = async (command) => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = join(STATE, "v3/d1/miniflare-D1DatabaseObject");
  const file = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  const db = new DatabaseSync(join(dir, file), { readOnly: true });
  try {
    return db.prepare(command).all().map((r) => ({ ...r }));
  } finally {
    db.close();
  }
};

const OLD_FAIL_TS = Date.now() - 60 * 60 * 1000;
const SEED = `
INSERT INTO items (id, name, category, colors, image_key, purchase_price, wear_count, last_worn_date, created_at, updated_at) VALUES
  ('i1', '흰 셔츠', 'top', '["화이트"]', 'img/i1.png', 30000, 5, '2026-10-01', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
  ('i2', '청바지', 'bottom', '["블루"]', 'img/i2.png', 50000, 3, '2026-09-15', '2026-01-02 00:00:00', '2026-01-02 00:00:00'),
  ('i3', '새 코트', 'outer', 'not json', NULL, NULL, 0, NULL, '2026-01-03 00:00:00', '2026-01-03 00:00:00'),
  ('i4', '로퍼', 'shoes', '[]', NULL, 120000, 2, '2026-11-01', '2026-01-04 00:00:00', '2026-01-04 00:00:00');
INSERT INTO outfit_logs (id, worn_date, item_ids, weather_summary) VALUES
  ('l1', '2026-10-01', '["i1","i2"]', '맑음 15°'),
  ('l2', '2026-10-20', '["i4"]', NULL),
  ('l3', '2026-08-01', 'broken', NULL);
INSERT INTO outfits (id, name, item_ids, source) VALUES ('o1', '예전 코디', '["i1","i2"]', 'manual');
INSERT INTO inspirations (id, image_key, source_url, note) VALUES
  ('p1', 'img/collage.png', NULL, '콜라주 보드에서 만든 코디'),
  ('p2', 'img/ref.png', 'https://www.pinterest.com/pin/1', '핀'),
  ('p3', 'img/shared.png', NULL, NULL);
INSERT INTO wishlist (id, name, category, image_key, reference_id) VALUES
  ('w1', '스크랩에서 온 니트', 'top', 'img/shared.png', 'p3'),
  ('w2', '사진 없는 가방', 'bag', NULL, NULL);
INSERT INTO ai_cache (key, value) VALUES ('tag:img/i1.png', '{"name":"셔츠","category":"top"}');
INSERT INTO settings (key, value) VALUES
  ('location', '{"lat":35.1,"lon":129.04,"name":"부산"}'),
  ('login_failures', '{"count":2,"first":${OLD_FAIL_TS}}'),
  ('broken', 'not-json');
`;

async function status(method, path) {
  const res = await fetch(`${H.BASE}/api${path}`, { method, headers: { cookie: H.sessionCookie(), origin: H.BASE } });
  await res.body?.cancel();
  return res.status;
}
const item = async (id) => api("GET", `/items/${id}`);
const expectEq = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return true;
  fail(`[upgrade] ${label}: ${JSON.stringify(actual)} (기대: ${JSON.stringify(expected)})`);
  return false;
};

let server;
try {
  console.log(`E2E 업그레이드: 격리 상태 ${H.TMP}`);
  mkdirSync(STATE, { recursive: true });
  // 1. 0001 스키마 + 예전 데이터 + R2 사진
  wrangler(["d1", "execute", "clothe-db", "--yes", "--file", join(H.ROOT, "migrations/0001_init.sql")]);
  const seedFile = join(H.TMP, "seed.sql");
  writeFileSync(seedFile, SEED);
  wrangler(["d1", "execute", "clothe-db", "--yes", "--file", seedFile]);
  const pngFile = join(H.TMP, "a.png");
  writeFileSync(pngFile, png(8, 8, [200, 100, 50]));
  for (const k of ["i1", "i2", "collage", "ref", "shared"]) wrangler(["r2", "object", "put", `clothe-images/img/${k}.png`, "--file", pngFile, "--content-type", "image/png"]);
  const tables = (await sql("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);
  if (tables.includes("schema_migrations") || tables.includes("profile")) fail(`[upgrade] 시작 상태가 0001 이 아님: ${tables.join(",")}`);
  else ok(`[upgrade] 0001 스키마 + 예전 데이터 (${tables.join(", ")})`);

  // 2. 첫 요청을 동시에 (로그인, 인증 확인, 상태, 이미지)
  server = await H.startServer();
  const first = await Promise.all([
    ...Array.from({ length: 6 }, () => fetch(`${H.BASE}/api/auth/me`)),
    ...Array.from({ length: 4 }, () => fetch(`${H.BASE}/api/status`)),
    ...Array.from({ length: 4 }, () => fetch(`${H.BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "0000" }) })),
  ]);
  const codes = first.map((r) => r.status);
  await Promise.all(first.map((r) => r.body?.cancel()));
  if (codes.some((c) => c >= 500)) fail(`[upgrade] 동시 첫 요청에 5xx: ${codes.join(",")}`);
  else ok(`[upgrade] 동시 첫 요청 ${codes.length}개 (${[...new Set(codes)].join("/")})`);
  // 틀린 PIN 4번 + 예전 실패 기록(1시간 전, 만료) → 잠기지 않고 로그인 가능
  await H.login();

  const versions = await sql("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
  if (expectEq("schema_migrations", versions.map((v) => v.version), [1, 2, 3])) ok(`[upgrade] 버전 ${versions.map((v) => v.name).join(", ")} 한 번씩 기록`);
  const cols = async (t) => (await sql(`PRAGMA table_info(${t})`)).map((r) => r.name);
  for (const [t, c] of [["items", "base_last_worn_date"], ["outfit_logs", "selfie_key"], ["outfits", "cover_image_key"], ["inspirations", "kind"], ["wishlist", "recommended_links"]]) {
    if (!(await cols(t)).includes(c)) fail(`[upgrade] ${t}.${c} 컬럼이 없음`);
  }

  // 3. 데이터 보존
  const base = Object.fromEntries((await sql("SELECT id, base_last_worn_date AS b FROM items")).map((r) => [r.id, r.b]));
  if (expectEq("기준 착용일 (기록으로 설명되는 i1 은 NULL, 아닌 i2/i4 는 보존)", base, { i1: null, i2: "2026-09-15", i3: null, i4: "2026-11-01" })) ok("[upgrade] 예전 마지막 착용일 → 기준값 보존");
  const insp = await api("GET", "/inspirations");
  if (expectEq("스크랩 종류", Object.fromEntries(insp.map((p) => [p.id, p.kind]).sort()), { p1: "collage", p2: "photo", p3: "photo" })) ok("[upgrade] 예전 콜라주 스크랩 → kind=collage");
  const settings = await api("GET", "/settings");
  if (expectEq("설정 (login_* 숨김, 깨진 값 건너뜀)", settings, { location: { lat: 35.1, lon: 129.04, name: "부산" } })) ok("[upgrade] 설정·위치 보존, 로그인 키 숨김");
  const items = await api("GET", "/items");
  expectEq("옷 수", items.length, 4);
  expectEq("깨진 colors JSON", (await item("i3")).colors, []);
  const logs = await api("GET", "/logs");
  expectEq("기록 (깨진 item_ids 는 빈 목록)", logs.map((l) => [l.id, l.item_ids.length]), [["l2", 1], ["l1", 2], ["l3", 0]]);
  expectEq("예전 코디 대표 그림", (await api("GET", "/outfits/o1")).cover_image_key, null);
  expectEq("위시리스트 링크 기본값", (await api("GET", "/wishlist/w2")).recommended_links, []);

  // 착용 → 기록 고치기 → 지우기
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const wear = await api("POST", "/items/wear", { item_ids: ["i2"], date: today });
  expectEq("착용 +1 (i2)", [wear.items[0].wear_count, wear.items[0].last_worn_date], [4, today]);
  const again = await api("POST", "/items/wear", { item_ids: ["i2"], date: today });
  expectEq("같은 날 같은 조합", [again.duplicate, (await item("i2")).wear_count], [true, 4]);
  const log = await api("POST", "/logs", { item_ids: ["i4"], date: "2026-11-10" });
  expectEq("기록 추가 (i4)", [(await item("i4")).wear_count, (await item("i4")).last_worn_date], [3, "2026-11-10"]);
  await api("PATCH", `/logs/${log.id}`, { date: "2026-10-25" });
  expectEq("기록 날짜 고침 → 기준값 11-01 유지", [(await item("i4")).wear_count, (await item("i4")).last_worn_date], [3, "2026-11-01"]);
  await api("DELETE", `/logs/${log.id}`);
  expectEq("기록 삭제 (i4)", [(await item("i4")).wear_count, (await item("i4")).last_worn_date], [2, "2026-11-01"]);
  await api("DELETE", "/logs/l1");
  expectEq("예전 기록 삭제 (i1: 기준값 없음)", [(await item("i1")).wear_count, (await item("i1")).last_worn_date], [4, null]);
  expectEq("예전 기록 삭제 (i2: 오늘 기록 남음)", [(await item("i2")).wear_count, (await item("i2")).last_worn_date], [3, today]);
  await api("PATCH", "/items/i3", { last_worn_date: "2026-07-07" });
  expectEq("직접 입력한 착용일", (await item("i3")).last_worn_date, "2026-07-07");
  ok("[upgrade] 착용·기록 고치기·지우기 (착용 횟수, 마지막 착용일)");

  // 대표 그림 바꾸기/지우기 → 안 쓰는 그림만 R2에서 삭제
  const coverA = await H.upload([10, 20, 30]);
  const coverB = await H.upload([30, 20, 10]);
  await api("PATCH", "/outfits/o1", { cover_image_key: coverA });
  await api("PATCH", "/outfits/o1", { cover_image_key: coverB });
  expectEq("바뀐 예전 대표 그림 삭제", await status("GET", `/images/${coverA}`), 404);
  const o2 = await api("POST", "/outfits", { name: "같은 그림", item_ids: ["i1"], cover_image_key: coverB });
  await api("DELETE", "/outfits/o1");
  expectEq("다른 코디가 쓰는 대표 그림은 남김", await status("GET", `/images/${coverB}`), 200);
  await api("DELETE", `/outfits/${o2.id}`);
  expectEq("아무도 안 쓰는 대표 그림 삭제", await status("GET", `/images/${coverB}`), 404);
  // 스크랩과 위시리스트가 같이 쓰는 사진
  await api("DELETE", "/inspirations/p3");
  expectEq("위시리스트가 쓰는 스크랩 사진은 남김", await status("GET", "/images/img/shared.png"), 200);
  await api("DELETE", "/wishlist/w1");
  expectEq("마지막으로 쓰던 위시리스트를 지우면 삭제", await status("GET", "/images/img/shared.png"), 404);
  await api("DELETE", "/inspirations/p1");
  expectEq("콜라주 스크랩 삭제 → 그림 삭제", await status("GET", "/images/img/collage.png"), 404);
  const made = await api("POST", "/inspirations", { image_key: (await H.upload([1, 2, 3])), kind: "collage" });
  expectEq("새 콜라주 스크랩", made.kind, "collage");
  ok("[upgrade] 대표 그림·공유 사진 정리 (쓰는 곳이 남아 있으면 지우지 않음)");

  // 4. 다시 시작 → 마이그레이션 재실행 없음
  await server.close();
  server = await H.startServer();
  const again1 = await Promise.all(Array.from({ length: 5 }, () => fetch(`${H.BASE}/api/auth/me`, { headers: { cookie: H.sessionCookie() } })));
  if (again1.some((r) => r.status !== 200)) fail(`[upgrade] 다시 시작한 뒤 인증 실패: ${again1.map((r) => r.status).join(",")}`);
  await Promise.all(again1.map((r) => r.body?.cancel()));
  const after = await sql("SELECT version, applied_at FROM schema_migrations ORDER BY version");
  if (expectEq("다시 시작한 뒤 schema_migrations", after, versions.map((v) => ({ version: v.version, applied_at: v.applied_at })))) ok("[upgrade] 다시 시작해도 마이그레이션은 그대로 (멱등)");
  expectEq("다시 시작한 뒤 데이터", (await api("GET", "/items")).length, 4);
} catch (e) {
  fail(`[upgrade] 실행 중 오류: ${e instanceof Error ? e.stack : e}${e?.stderr ? `\n${e.stderr}` : ""}`);
} finally {
  await server?.close().catch(() => {});
  H.cleanup();
}

if (H.failures.length) {
  console.error(`\nE2E 업그레이드 실패 ${H.failures.length}건`);
  process.exit(1);
}
console.log("\nE2E 업그레이드 통과");
process.exit(0);
