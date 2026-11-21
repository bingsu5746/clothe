import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../worker/index";
import { resetSchemaCache } from "../worker/lib/schema";
import { geminiReply, makeEnv, sessionCookie, TEST_SECRET, type TestEnv } from "./helpers/env";

/**
 * 라우트 통합 테스트: 실제 Hono 앱 + 메모리 SQLite(D1 흉내) + 메모리 R2. 외부 API(fetch)는 전부 가짜.
 */
let t: TestEnv;
let cookie: string;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; res: Response }> {
  const init: RequestInit = { method, headers: { cookie, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] ??= "application/json";
  }
  const res = await app.request(`http://localhost/api${path}`, init, t.env);
  const text = await res.clone().text();
  let parsed: Json = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* 본문이 JSON이 아닌 응답 */
  }
  return { status: res.status, body: parsed, res };
}

const get = (p: string) => call("GET", p);
const post = (p: string, b?: unknown) => call("POST", p, b);
const patch = (p: string, b?: unknown) => call("PATCH", p, b);
const del = (p: string) => call("DELETE", p);

async function addItem(over: Json = {}): Promise<string> {
  const r = await post("/items", { name: "흰 셔츠", category: "top", ...over });
  expect(r.status).toBe(201);
  return r.body.id;
}

/** 형식별 실제 파일 머리(매직 바이트) + 채움 */
const MAGIC: Record<string, number[]> = {
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
};
function imageBytes(kind: keyof typeof MAGIC, size = 32): Uint8Array {
  const out = new Uint8Array(Math.max(size, MAGIC[kind].length)).fill(7);
  out.set(MAGIC[kind]);
  return out;
}

function putImage(key: string, bytes = 100, type = "image/webp") {
  return t.bucket.put(key, new Uint8Array(bytes).fill(7), { httpMetadata: { contentType: type } });
}

/** URL 조각별로 가짜 응답을 정한다. 정하지 않은 주소를 부르면 테스트 실패. */
function route(routes: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    for (const [frag, fn] of Object.entries(routes)) if (String(url).includes(frag)) return fn(String(url), init);
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function geminiCalls() {
  return fetchMock.mock.calls.filter(([u]) => String(u).includes("generativelanguage"));
}

function promptOf(callIndex = 0): string {
  const body = JSON.parse(String(geminiCalls()[callIndex][1]?.body));
  return body.contents[0].parts.map((p: Json) => p.text ?? "").join("");
}

beforeEach(async () => {
  resetSchemaCache();
  t = makeEnv({ GEMINI_API_KEY: "g-key" });
  cookie = await sessionCookie();
  fetchMock = vi.fn(async (url: string) => {
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("인증 / 공통 오류 형식", () => {
  it("로그인 전에는 401, PIN이 맞으면 쿠키 발급", async () => {
    cookie = "";
    expect((await get("/items")).status).toBe(401);
    expect((await post("/auth/login", { pin: "0000" })).body).toEqual({ error: "PIN이 맞지 않아요" });
    expect((await post("/auth/login", { pin: { $ne: 1 } })).status).toBe(401);
    const ok = await post("/auth/login", { pin: "1234" });
    expect(ok.status).toBe(200);
    cookie = ok.res.headers.get("set-cookie")!.split(";")[0];
    expect((await get("/auth/me")).body).toEqual({ ok: true });
  });

  it("PIN 5번 틀리면 잠긴다", async () => {
    cookie = "";
    for (let i = 0; i < 5; i++) expect((await post("/auth/login", { pin: "x" })).status).toBe(401);
    expect((await post("/auth/login", { pin: "1234" })).status).toBe(429);
  });

  it("잘못된 JSON, 배열 본문, 너무 큰 본문, 없는 API는 모두 { error } 형식", async () => {
    for (const r of [
      await post("/items", "{not json"),
      await post("/items", "[1,2]"),
      await post("/items", JSON.stringify({ name: "x".repeat(70_000), category: "top" })),
      await get("/nope"),
      await get("/items/does-not-exist"),
      await get("/items/bad id!"),
    ]) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(typeof r.body.error).toBe("string");
    }
    expect((await post("/items", "{not json")).status).toBe(400);
    expect((await post("/items", JSON.stringify({ name: "x".repeat(70_000), category: "top" }))).status).toBe(413);
  });

  it("첫 요청에서 스키마 마이그레이션이 적용된다", async () => {
    await get("/items");
    expect(t.db.rows("SELECT version FROM schema_migrations ORDER BY version")).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  });
});

describe("옷장", () => {
  it("입력 검증", async () => {
    expect((await post("/items", { category: "top" })).body.error).toBe("이름을 입력해 주세요");
    expect((await post("/items", { name: "a" })).body.error).toBe("카테고리를 골라 주세요");
    expect((await post("/items", { name: "a", category: "hat" })).status).toBe(400);
    expect((await post("/items", { name: "a", category: "top", warmth: 9 })).status).toBe(400);
    expect((await post("/items", { name: "a", category: "top", colors: "red" })).status).toBe(400);
    expect((await post("/items", { name: "a", category: "top", season: ["monsoon"] })).status).toBe(400);
    expect((await post("/items", { name: "a", category: "top", image_key: "../../etc/passwd" })).status).toBe(400);
    expect((await post("/items", { name: "a", category: "top", purchase_price: -1 })).status).toBe(400);
  });

  it("CRUD: 기존 필드 모양 유지, 모르는 필드는 무시", async () => {
    const id = await addItem({ colors: ["화이트"], season: ["spring", "fall"], purchase_price: 59000, hacker: "x" });
    const one = (await get(`/items/${id}`)).body;
    expect(one).toMatchObject({ id, name: "흰 셔츠", category: "top", colors: ["화이트"], season: ["spring", "fall"], purchase_price: 59000, wear_count: 0, last_worn_date: null, brand: null });
    const p = await patch(`/items/${id}`, { name: "아이보리 셔츠", brand: "" });
    expect(p.body).toMatchObject({ name: "아이보리 셔츠", brand: null });
    expect((await patch(`/items/${id}`, { name: "" })).status).toBe(400);
    expect((await patch("/items/nope", { name: "x" })).status).toBe(404);
    expect((await get("/items")).body).toHaveLength(1);
    expect((await del(`/items/${id}`)).body).toEqual({ ok: true });
    expect((await get(`/items/${id}`)).status).toBe(404);
  });

  it("삭제할 때 R2 이미지를 지우되, 다른 곳에서 쓰는 이미지는 남긴다", async () => {
    await putImage("img/solo.webp");
    await putImage("img/shared.webp");
    const a = await addItem({ image_key: "img/solo.webp" });
    const b = await addItem({ image_key: "img/shared.webp" });
    await post("/wishlist", { name: "같은 사진", image_key: "img/shared.webp" });
    await del(`/items/${a}`);
    await del(`/items/${b}`);
    expect([...t.bucket.objects.keys()]).toEqual(["img/shared.webp"]);
    // 위시리스트까지 지우면 그때 사라진다
    const w = (await get("/wishlist")).body[0].id;
    await del(`/wishlist/${w}`);
    expect(t.bucket.objects.size).toBe(0);
  });

  it("사진을 바꾸면 예전 사진을 정리한다", async () => {
    await putImage("img/old.webp");
    await putImage("img/new.webp");
    const id = await addItem({ image_key: "img/old.webp" });
    await patch(`/items/${id}`, { image_key: "img/new.webp" });
    expect([...t.bucket.objects.keys()]).toEqual(["img/new.webp"]);
  });

  it("GET /items/dormant", async () => {
    const id = await addItem();
    t.db.exec(`UPDATE items SET created_at = '2026-01-01 00:00:00' WHERE id = '${id}'`);
    const r = await get("/items/dormant");
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ item_id: id, reasons: ["never_worn"] });
  });

  it("사진 태깅: Gemini 결과를 정리하고 이미지별로 캐시", async () => {
    await putImage("img/shirt.webp");
    route({ generativelanguage: () => geminiReply({ name: "네이비 셔츠", category: "TOP", sub_category: "셔츠", colors: ["네이비"], material: "면", fit: "오버핏", season: ["spring", "monsoon"], style_tags: ["캐주얼"], warmth: 9 }) });
    const r = await post("/items/analyze", { image_key: "img/shirt.webp" });
    expect(r.body).toMatchObject({ name: "네이비 셔츠", category: "top", season: ["spring"], warmth: 5 });
    await post("/items/analyze", { image_key: "img/shirt.webp" });
    expect(geminiCalls()).toHaveLength(1);
    expect((await post("/items/analyze", { image_key: "img/none.webp" })).status).toBe(404);
  });

  it("Gemini 키가 없으면 503, 한도 초과면 429, 5xx는 한 번 재시도", async () => {
    await putImage("img/a.webp");
    await putImage("img/b.webp");
    t.env.GEMINI_API_KEY = "";
    expect((await post("/items/analyze", { image_key: "img/a.webp" })).status).toBe(503);
    t.env.GEMINI_API_KEY = "k";
    route({ generativelanguage: () => Response.json({ error: { message: "quota" } }, { status: 429 }) });
    expect((await post("/items/analyze", { image_key: "img/a.webp" })).status).toBe(429);
    expect(geminiCalls()).toHaveLength(1); // 429는 재시도하지 않음

    fetchMock.mockReset();
    let n = 0;
    route({ generativelanguage: () => (++n === 1 ? new Response("oops", { status: 503 }) : geminiReply({ name: "티", category: "top" })) });
    expect((await post("/items/analyze", { image_key: "img/b.webp" })).status).toBe(200);
    expect(n).toBe(2);
  });
});

describe("착용 기록", () => {
  const wearOf = (id: string) => t.db.rows<{ wear_count: number; last_worn_date: string | null }>("SELECT wear_count, last_worn_date FROM items WHERE id = ?", id)[0];

  it("/items/wear: 같은 날 같은 조합을 다시 보내면 중복으로 세지 않는다", async () => {
    const a = await addItem();
    const b = await addItem({ name: "슬랙스", category: "bottom" });
    const first = await post("/items/wear", { item_ids: [a, b], date: "2026-11-10", weather_summary: "맑음" });
    expect(first.body).toMatchObject({ ok: true, duplicate: false });
    const again = await post("/items/wear", { item_ids: [b, a], date: "2026-11-10" });
    expect(again.body).toMatchObject({ ok: true, log_id: first.body.log_id, duplicate: true, worn_date: "2026-11-10" });
    expect(wearOf(a)).toEqual({ wear_count: 1, last_worn_date: "2026-11-10" });
    expect(t.db.rows("SELECT id FROM outfit_logs")).toHaveLength(1);

    // 같은 날 다른 조합: 기록은 새로 생기지만 이미 센 옷은 다시 세지 않는다
    const c = await addItem({ name: "코트", category: "outer" });
    await post("/items/wear", { item_ids: [a, c], date: "2026-11-10" });
    expect(wearOf(a).wear_count).toBe(1);
    expect(wearOf(c).wear_count).toBe(1);
    expect(t.db.rows("SELECT id FROM outfit_logs")).toHaveLength(2);
  });

  it("날짜를 안 보내면 한국 날짜로 기록한다 (23:59 / 00:01 KST 경계)", async () => {
    const a = await addItem();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-20T14:59:00Z")); // 11-20 23:59 KST
      const late = await post("/items/wear", { item_ids: [a] });
      expect(late.body.worn_date).toBe("2026-11-20");
      vi.setSystemTime(new Date("2026-11-20T15:01:00Z")); // 11-21 00:01 KST (UTC 로는 아직 11-20)
      const early = await post("/items/wear", { item_ids: [a] });
      expect(early.body.worn_date).toBe("2026-11-21");
      expect(early.body.duplicate).toBe(false);
      expect(early.body.items[0]).toMatchObject({ wear_count: 2, last_worn_date: "2026-11-21" });
      // 00:01 KST 에 "내일"(11-22)까지는 허용, 모레는 미래
      expect((await post("/items/wear", { item_ids: [a], date: "2026-11-23" })).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("/items/wear 검증: 빈 목록, 없는 옷, 잘못된 날짜, 미래 날짜", async () => {
    const a = await addItem();
    expect((await post("/items/wear", { item_ids: [] })).status).toBe(400);
    expect((await post("/items/wear", {})).status).toBe(400);
    expect((await post("/items/wear", { item_ids: [a, "ghost"] })).status).toBe(400);
    expect((await post("/items/wear", { item_ids: [a], date: "어제" })).status).toBe(400);
    expect((await post("/items/wear", { item_ids: [a], date: "2099-01-01" })).status).toBe(400);
    expect(wearOf(a).wear_count).toBe(0);
  });

  it("기록 추가 → 수정 → 삭제에 따라 횟수와 마지막 착용일이 맞게 바뀐다", async () => {
    const a = await addItem();
    const b = await addItem({ name: "슬랙스", category: "bottom" });
    const c = await addItem({ name: "니트", category: "top" });
    await putImage("img/selfie.webp");

    const older = await post("/logs", { item_ids: [a], date: "2026-11-01" });
    const log = await post("/logs", { item_ids: [a, b], date: "2026-11-10", selfie_key: "img/selfie.webp", rating: 4, occasion_tags: ["데이트"], note: "좋았음" });
    expect(log.status).toBe(201);
    expect(log.body).toMatchObject({ worn_date: "2026-11-10", item_ids: [a, b], selfie_key: "img/selfie.webp", rating: 4, occasion_tags: ["데이트"], duplicate: false });
    expect(wearOf(a)).toEqual({ wear_count: 2, last_worn_date: "2026-11-10" });

    // 옷 교체: b → c
    const edited = await patch(`/logs/${log.body.id}`, { item_ids: [a, c], rating: 5 });
    expect(edited.body).toMatchObject({ item_ids: [a, c], rating: 5, note: "좋았음" });
    expect(wearOf(a).wear_count).toBe(2);
    expect(wearOf(b)).toEqual({ wear_count: 0, last_worn_date: null });
    expect(wearOf(c)).toEqual({ wear_count: 1, last_worn_date: "2026-11-10" });

    // 달력 조회
    const month = await get("/logs?month=2026-11");
    expect(month.body.map((l: Json) => l.worn_date)).toEqual(["2026-11-10", "2026-11-01"]);
    expect((await get("/logs?month=2026-10")).body).toEqual([]);
    expect((await get("/logs?from=2026-11-05&to=2026-11-30")).body).toHaveLength(1);
    expect((await get("/logs?month=2026-13")).status).toBe(400);
    expect((await get("/logs?from=2026-11-05")).status).toBe(400);
    expect((await get(`/logs/${older.body.id}`)).body.item_ids).toEqual([a]);

    // 삭제: 횟수 되돌리고 마지막 착용일은 남은 기록으로, 셀카도 정리
    expect((await del(`/logs/${log.body.id}`)).body).toEqual({ ok: true });
    expect(wearOf(a)).toEqual({ wear_count: 1, last_worn_date: "2026-11-01" });
    expect(wearOf(c)).toEqual({ wear_count: 0, last_worn_date: null });
    expect(t.bucket.objects.has("img/selfie.webp")).toBe(false);
    expect((await del(`/logs/${log.body.id}`)).status).toBe(404);
  });

  it("직접 입력한 마지막 착용일은 기록을 넣었다 지워도 되돌아온다", async () => {
    const a = await addItem({ last_worn_date: "2026-03-01", wear_count: 2 });
    const log = await post("/logs", { item_ids: [a], date: "2026-11-01" });
    expect(wearOf(a)).toEqual({ wear_count: 3, last_worn_date: "2026-11-01" });
    await del(`/logs/${log.body.id}`);
    expect(wearOf(a)).toEqual({ wear_count: 2, last_worn_date: "2026-03-01" });
  });

  it("같은 조합 기록이 있으면 셀카/평점을 그 기록에 채운다", async () => {
    const a = await addItem();
    const first = await post("/items/wear", { item_ids: [a], date: "2026-11-10" });
    const second = await post("/logs", { item_ids: [a], date: "2026-11-10", selfie_key: "img/s.webp", rating: 3 });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.log_id, duplicate: true, selfie_key: "img/s.webp", rating: 3 });
    expect(wearOf(a).wear_count).toBe(1);
  });

  it("기록 검증: 평점 범위, 태그 형식", async () => {
    const a = await addItem();
    expect((await post("/logs", { item_ids: [a], rating: 6 })).status).toBe(400);
    expect((await post("/logs", { item_ids: [a], occasion_tags: "데이트" })).status).toBe(400);
    expect((await post("/logs", { item_ids: [a], selfie_key: "http://evil" })).status).toBe(400);
    const ok = await post("/logs", { item_ids: [a] });
    expect((await patch(`/logs/${ok.body.id}`, { item_ids: [] })).status).toBe(400);
    expect((await patch(`/logs/${ok.body.id}`, { item_ids: ["ghost"] })).status).toBe(400);
  });
});

describe("이미지 제공", () => {
  it("ETag와 304, 긴 캐시, 잘못된 경로는 404", async () => {
    await putImage("img/a.webp");
    const first = await get("/images/img/a.webp");
    expect(first.status).toBe(200);
    expect(first.res.headers.get("content-type")).toBe("image/webp");
    expect(first.res.headers.get("cache-control")).toContain("immutable");
    const etag = first.res.headers.get("etag")!;
    const second = await call("GET", "/images/img/a.webp", undefined, { "if-none-match": etag });
    expect(second.status).toBe(304);
    expect(await second.res.text()).toBe("");
    expect((await get("/images/img/none.webp")).status).toBe(404);
    expect((await get("/images/secrets/a.webp")).status).toBe(404);
  });

  it("업로드: 형식과 크기 검사", async () => {
    const send = (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return app.request("http://localhost/api/images", { method: "POST", body: form, headers: { cookie } }, t.env);
    };
    const ok = await send(new File([imageBytes("webp")], "a.webp", { type: "image/webp" }));
    expect(ok.status).toBe(201);
    const { key } = (await ok.json()) as { key: string };
    expect(key).toMatch(/^img\/[0-9a-f-]+\.webp$/);
    expect(t.bucket.objects.has(key)).toBe(true);
    expect((await send(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).status).toBe(415);
    expect((await send(new File([], "a.webp", { type: "image/webp" }))).status).toBe(400);
    expect((await post("/images", { file: "x" })).status).toBe(400);
  });

  it("업로드: 주장한 형식을 믿지 않고 매직 바이트로 확인한다 (HTML을 image/png로 위장 불가)", async () => {
    const send = (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return app.request("http://localhost/api/images", { method: "POST", body: form, headers: { cookie } }, t.env);
    };
    expect((await send(new File(["<html><script>alert(1)</script></html>"], "a.png", { type: "image/png" }))).status).toBe(415);
    expect((await send(new File([new Uint8Array(10)], "a.webp", { type: "image/webp" }))).status).toBe(415);
    // PNG 바이트를 webp라고 보내면 거절 (형식 불일치)
    expect((await send(new File([imageBytes("png")], "a.webp", { type: "image/webp" }))).status).toBe(415);
    const jpg = await send(new File([imageBytes("jpeg")], "a.jpg", { type: "image/jpeg" }));
    expect(jpg.status).toBe(201);
    expect(t.bucket.objects.size).toBe(1);
  });

  it("이미지 응답에는 nosniff + sandbox CSP, API 응답에는 no-store와 보안 헤더", async () => {
    await putImage("img/a.webp");
    const img = await get("/images/img/a.webp");
    expect(img.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.res.headers.get("content-security-policy")).toContain("sandbox");
    expect(img.res.headers.get("cache-control")).toContain("immutable");
    const api = await get("/items");
    expect(api.res.headers.get("cache-control")).toBe("no-store");
    expect(api.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api.res.headers.get("referrer-policy")).toBe("no-referrer");
    const err = await get("/nope");
    expect(err.status).toBe(404);
    expect(err.res.headers.get("cache-control")).toBe("no-store");
  });

  it("서명 주소는 로그인 없이 열리고, 서명이 틀리면 403", async () => {
    await putImage("img/a.webp");
    const { signedImagePath } = await import("../worker/lib/auth");
    const path = await signedImagePath(TEST_SECRET, "img/a.webp");
    cookie = "";
    const ok = await app.request(`http://localhost${path}`, {}, t.env);
    expect(ok.status).toBe(200);
    const bad = await app.request(`http://localhost${path.replace("img/a.webp", "img/b.webp")}`, {}, t.env);
    expect(bad.status).toBe(403);
  });
});

describe("설정", () => {
  it("저장/조회, 로그인 관련 키와 이상한 키는 거절", async () => {
    expect((await call("PUT", "/settings/location", { lat: 37.5, name: "서울" })).body).toEqual({ ok: true });
    expect((await get("/settings")).body).toEqual({ location: { lat: 37.5, name: "서울" } });
    expect((await call("PUT", "/settings/login_failures", { count: 0 })).status).toBe(400);
    expect((await call("PUT", "/settings/Bad-Key", 1)).status).toBe(400);
    expect((await call("PUT", "/settings/x", "{oops")).status).toBe(400);
    t.db.exec("INSERT INTO settings (key, value) VALUES ('broken', '{nope')");
    expect((await get("/settings")).body).toEqual({ location: { lat: 37.5, name: "서울" } });
  });
});

describe("프로필 / 진단", () => {
  const colorRaw = {
    season: "autumn", sub_tone: "뮤트", undertone: "warm", summary: "차분한 웜톤", skin_hex: "#000000", hair_hex: "#3B2A20", eye_hex: "#4A3526",
    best_colors: [{ hex: "#8B5A2B", name: "카멜" }, { hex: "#556B2F", name: "올리브" }], worst_colors: [{ hex: "#FF00FF", name: "마젠타" }], tips: ["골드 액세서리"], confidence: "medium", caveat: "",
  };

  it("빈 프로필 → 저장 → 검증", async () => {
    expect((await get("/profile")).body).toMatchObject({ height_cm: null, mannequin_images: [], color_analysis: null, personal_color: null, version: 0 });
    const r = await call("PUT", "/profile", { height_cm: 172, weight_kg: 64.5, mannequin_images: ["img/m1.webp"] });
    expect(r.body).toMatchObject({ height_cm: 172, weight_kg: 64.5, mannequin_images: ["img/m1.webp"], version: 1 });
    expect((await patch("/profile", { height_cm: 10 })).status).toBe(400);
    expect((await patch("/profile", { mannequin_images: ["http://x"] })).status).toBe(400);
    expect((await patch("/profile", { weight_kg: null })).body.weight_kg).toBeNull();
  });

  it("퍼스널 컬러: 측정값을 프롬프트에 넣고, 같은 사진은 다시 부르지 않는다", async () => {
    await putImage("img/face.webp");
    expect((await post("/profile/analyze-color", {})).status).toBe(400);
    route({ generativelanguage: () => geminiReply(colorRaw) });
    const r = await post("/profile/analyze-color", { image_key: "img/face.webp", samples: { skin: "#e8c4a0", hair: "not-a-color" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ personal_color: "가을 웜 뮤트", face_image_key: "img/face.webp", cached: false, color_analysis_stale: false });
    expect(r.body.color_analysis).toMatchObject({ season: "autumn", skin_hex: "#E8C4A0", hair_hex: "#3B2A20", hex_source: "client", image_key: "img/face.webp" });
    expect(r.body.best_colors).toEqual([{ hex: "#8B5A2B", name: "카멜" }, { hex: "#556B2F", name: "올리브" }]);
    expect(promptOf()).toContain("피부 #E8C4A0");
    expect(promptOf()).not.toContain("not-a-color");
    const v1 = r.body.version;

    const again = await post("/profile/analyze-color", {});
    expect(again.body).toMatchObject({ cached: true, version: v1 });
    expect(geminiCalls()).toHaveLength(1);
    const forced = await post("/profile/analyze-color", { force: true });
    expect(forced.body.version).toBe(v1 + 1);
    expect(geminiCalls()).toHaveLength(2);

    // 얼굴 사진을 바꾸면 stale 표시
    await putImage("img/face2.webp");
    expect((await patch("/profile", { face_image_key: "img/face2.webp" })).body.color_analysis_stale).toBe(true);
    expect(t.bucket.objects.has("img/face.webp")).toBe(false); // 예전 사진 정리
    expect((await del("/profile/analysis/color")).body.color_analysis).toBeNull();
  });

  it("체형: 결과 저장, 해석 못 하면 502", async () => {
    await putImage("img/body.webp");
    route({ generativelanguage: () => geminiReply({ body_type: "straight", proportions: "어깨와 골반이 비슷", features: ["허리 위치 높음"], fit_tips: ["정사이즈"], avoid: ["과한 프릴"], confidence: "high", caveat: "" }) });
    await patch("/profile", { height_cm: 165 });
    const r = await post("/profile/analyze-body", { image_key: "img/body.webp" });
    expect(r.body).toMatchObject({ body_type: "straight", body_image_key: "img/body.webp" });
    expect(r.body.body_analysis.body_type_label).toBe("스트레이트");
    expect(promptOf()).toContain("키 165cm");

    await putImage("img/body2.webp");
    fetchMock.mockReset();
    route({ generativelanguage: () => geminiReply({ body_type: "unknown" }) });
    expect((await post("/profile/analyze-body", { image_key: "img/body2.webp" })).status).toBe(502);
    expect((await get("/profile")).body.body_type).toBe("straight"); // 실패해도 기존 결과 유지
  });
});

describe("스타일리스트", () => {
  async function wardrobe() {
    const top = await addItem();
    const bottom = await addItem({ name: "슬랙스", category: "bottom" });
    const old = await addItem({ name: "묵은 자켓", category: "outer" });
    t.db.exec(`UPDATE items SET created_at = '2026-01-01 00:00:00' WHERE id = '${old}'`);
    return { top, bottom, old };
  }

  it("today: 기존 요청/응답 모양 유지 + 장롱템/프로필 반영 + 캐시", async () => {
    const { top, bottom, old } = await wardrobe();
    t.db.exec(`INSERT INTO profile (id, color_analysis, version) VALUES ('me', '${JSON.stringify({ season: "winter", sub_tone: "딥", undertone: "cool", best_colors: [{ hex: "#000080", name: "네이비" }], image_key: "img/f.webp", analyzed_at: "t" })}', 2)`);
    route({ generativelanguage: () => geminiReply({ briefing: "쌀쌀해요", outfits: [{ title: "출근", item_ids: [top, bottom, old, "ghost"], reason: "r" }, { title: "없는 옷뿐", item_ids: ["ghost"], reason: "" }] }) });
    const weather = { date: "2026-11-15", location_name: "서울", temp_min: 2, temp_max: 14, temp_now: 9, diurnal_range: 12, precip_probability: 10, weather_code: 3, description: "흐림" };
    const r = await post("/stylist/today", { weather, keywords: "출근" });
    expect(r.status).toBe(200);
    expect(r.body.weather).toEqual(weather);
    expect(r.body.briefing).toBe("쌀쌀해요");
    expect(r.body.outfits).toEqual([{ title: "출근", item_ids: [top, bottom, old], reason: "r" }]);
    expect(r.body.dormant.map((d: Json) => d.item_id)).toEqual([old]);
    expect(r.body.profile_used).toBe(true);
    const prompt = promptOf();
    expect(prompt).toContain("장롱템");
    expect(prompt).toContain(`id=${old} | 묵은 자켓`);
    expect(prompt).toContain("겨울 쿨 딥");
    expect(prompt).toContain("일교차 12°C");

    await post("/stylist/today", { weather, keywords: "출근" });
    expect(geminiCalls()).toHaveLength(1);
    await post("/stylist/today", { weather, keywords: "출근", refresh: true });
    expect(geminiCalls()).toHaveLength(2);
    // 프로필이 바뀌면 캐시가 무효화된다
    t.db.exec("UPDATE profile SET version = 3");
    await post("/stylist/today", { weather, keywords: "출근" });
    expect(geminiCalls()).toHaveLength(3);
  });

  it("today: 옷이 부족하면 400, 본문 없이도 동작", async () => {
    expect((await post("/stylist/today", {})).status).toBe(400);
    const { top, bottom } = await wardrobe();
    route({ generativelanguage: () => geminiReply({ briefing: "b", outfits: [{ title: "t", item_ids: [top, bottom], reason: "r" }] }) });
    const r = await call("POST", "/stylist/today");
    expect(r.body).toMatchObject({ weather: null, profile_used: false });
    expect((await post("/stylist/today", { keywords: 5 })).status).toBe(400);
  });

  it("similar: 사진/설명 중 하나는 필요, 사진은 Gemini에 같이 전달", async () => {
    const { top, bottom } = await wardrobe();
    await putImage("img/partner.webp");
    expect((await post("/stylist/similar", {})).status).toBe(400);
    expect((await post("/stylist/similar", { partner_description: "x", mode: "twins" })).status).toBe(400);
    route({ generativelanguage: () => geminiReply({ partner_summary: "베이지 톤", outfits: [{ title: "톤온톤", item_ids: [top, bottom], reason: "색을 맞춤" }] }) });
    const r = await post("/stylist/similar", { partner_image_key: "img/partner.webp", partner_description: "베이지 트렌치", mode: "couple" });
    expect(r.body).toEqual({ mode: "couple", partner_summary: "베이지 톤", outfits: [{ title: "톤온톤", item_ids: [top, bottom], reason: "색을 맞춤" }], cached: false });
    const sent = JSON.parse(String(geminiCalls()[0][1]?.body));
    expect(sent.contents[0].parts[0].inlineData.mimeType).toBe("image/webp");
    expect(promptOf()).toContain("커플룩");
    expect((await post("/stylist/similar", { partner_image_key: "img/partner.webp", partner_description: "베이지 트렌치", mode: "couple" })).body.cached).toBe(true);
    expect(geminiCalls()).toHaveLength(1);
  });

  it("weather/geocode 검증", async () => {
    expect((await get("/stylist/weather?lat=abc&lon=1")).status).toBe(400);
    expect((await get("/stylist/weather?lat=95&lon=1")).status).toBe(400);
    expect((await get("/stylist/geocode?q=")).body).toEqual([]);
    route({ "geocoding-api": () => Response.json({ results: [{ name: "서울", latitude: 37.5, longitude: 127, country: "대한민국" }] }) });
    expect((await get("/stylist/geocode?q=서울")).body).toEqual([{ name: "서울", latitude: 37.5, longitude: 127, country: "대한민국" }]);
  });
});

describe("위시리스트 / 판독 / 쇼핑", () => {
  it("CRUD와 새 필드", async () => {
    const w = await post("/wishlist", { name: "카멜 코트", category: "outer", colors: ["카멜"], estimated_price: 250000 });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ name: "카멜 코트", status: "wanted", validator_score: null, validation: null, recommended_links: [] });
    expect((await post("/wishlist", {})).body.name).toBe("이름 없는 옷");
    expect((await patch(`/wishlist/${w.body.id}`, { status: "gone" })).status).toBe(400);
    expect((await patch(`/wishlist/${w.body.id}`, { recommended_links: [{ title: "내 링크", url: "https://shop.example.com/1" }, { url: "javascript:1" }] })).body.recommended_links).toEqual([
      { title: "내 링크", url: "https://shop.example.com/1", source: "custom", price: null, image_url: null, mall: null },
    ]);
    expect((await post("/wishlist/from-url", { url: "http://localhost/x" })).status).toBe(400);
    expect((await get("/wishlist/nope")).status).toBe(404);
  });

  it("판독: 점수 계산·저장·캐시, combos와 공유, 옷장이 바뀌면 stale", async () => {
    const top = await addItem();
    const bottom = await addItem({ name: "슬랙스", category: "bottom" });
    const w = (await post("/wishlist", { name: "카멜 코트", category: "outer" })).body.id;
    route({
      generativelanguage: () =>
        geminiReply({
          verdict: "활용도가 높아요", similar: [{ item_id: top, level: "similar" }], duplicate_comment: "비슷한 톤의 상의가 있어요",
          outfits: [{ title: "a", item_ids: ["NEW", top, bottom], reason: "r" }, { title: "b", item_ids: ["NEW", bottom], reason: "r" }, { title: "c", item_ids: [top, bottom], reason: "NEW 없음" }],
          synergy_comment: "기본 아이템과 잘 맞아요", color_level: "best", color_comment: "x", body_level: "great", body_comment: "x",
        }),
    });
    const r = await post(`/wishlist/${w}/validate`);
    expect(r.status).toBe(200);
    // 프로필 없음 → (22 + 20) / 70 = 60
    expect(r.body).toMatchObject({ score: 60, label: "추천", cached: false, stale: false });
    expect(r.body.breakdown.duplicate).toMatchObject({ score: 22, max: 30, similar: [{ item_id: top, level: "similar" }] });
    expect(r.body.breakdown.synergy).toMatchObject({ score: 20, new_outfit_count: 2 });
    expect(r.body.breakdown.personal_color).toMatchObject({ available: false, score: null });
    expect(r.body.breakdown.personal_color.comment).toContain("프로필 없음");
    expect(promptOf()).toContain("프로필이 없으니");

    const saved = (await get(`/wishlist/${w}`)).body;
    expect(saved.validator_score).toBe(60);
    expect(saved.validator_comment).toContain("새 코디 2개");
    expect(saved.validation).toMatchObject({ score: 60, stale: false });

    expect((await post(`/wishlist/${w}/validate`)).body.cached).toBe(true);
    const combos = await post(`/wishlist/${w}/combos`);
    expect(combos.body).toMatchObject({ verdict: "활용도가 높아요", similar_item_ids: [top] });
    expect(combos.body.outfits).toHaveLength(2);
    expect(geminiCalls()).toHaveLength(1); // 판독 1번으로 combos까지

    await addItem({ name: "새 옷" });
    expect((await get(`/wishlist/${w}`)).body.validation.stale).toBe(true);
    expect((await get("/wishlist")).body[0].validation.stale).toBe(true);
    expect((await post(`/wishlist/${w}/validate`)).body.cached).toBe(false);
    expect(geminiCalls()).toHaveLength(2);
  });

  it("판독: 프로필이 있으면 색/핏 점수가 들어간다", async () => {
    const top = await addItem();
    const w = (await post("/wishlist", { name: "코트" })).body.id;
    t.db.exec(`INSERT INTO profile (id, color_analysis, version) VALUES ('me', '${JSON.stringify({ season: "summer", best_colors: [{ hex: "#AABBCC", name: "소라" }], image_key: "img/f.webp" })}', 1)`);
    route({ generativelanguage: () => geminiReply({ verdict: "v", similar: [], outfits: [{ title: "a", item_ids: ["NEW", top], reason: "" }], color_level: "worst", color_comment: "워스트 컬러", body_level: "great", body_comment: "?" }) });
    const r = await post(`/wishlist/${w}/validate`);
    expect(r.body.breakdown.personal_color).toMatchObject({ available: true, score: 0, level: "worst", comment: "워스트 컬러" });
    expect(r.body.breakdown.body_fit.available).toBe(false);
    expect(r.body.score).toBe(Math.round(((30 + 10 + 0) / 85) * 100));
    expect(promptOf()).toContain("여름 쿨");
  });

  it("combos: 예전 응답 모양 그대로", async () => {
    const top = await addItem();
    const bottom = await addItem({ name: "슬랙스", category: "bottom" });
    const w = (await post("/wishlist", { name: "코트" })).body.id;
    route({ generativelanguage: () => geminiReply({ verdict: "v", similar_item_ids: [top, "NEW", "ghost"], outfits: [{ title: "a", item_ids: ["NEW", top, bottom], reason: "r" }, { title: "b", item_ids: [top, bottom], reason: "" }] }) });
    const r = await post(`/wishlist/${w}/combos`);
    expect(r.body).toEqual({ verdict: "v", similar_item_ids: [top], outfits: [{ title: "a", item_ids: ["NEW", top, bottom], reason: "r" }] });
    await post(`/wishlist/${w}/combos`);
    expect(geminiCalls()).toHaveLength(1);
    await post(`/wishlist/${w}/combos?force=true`);
    expect(geminiCalls()).toHaveLength(2);
  });

  it("샀어요 → 옷장으로", async () => {
    const w = (await post("/wishlist", { name: "코트", category: "outer", estimated_price: 100000 })).body.id;
    const r = await post(`/wishlist/${w}/bought`, { purchase_price: 89000 });
    expect(r.status).toBe(201);
    expect(r.body.item).toMatchObject({ name: "코트", category: "outer", purchase_price: 89000 });
    expect((await call("POST", `/wishlist/${w}/bought`)).body).toEqual({ item_id: r.body.item_id });
    expect((await get(`/wishlist/${w}`)).body).toMatchObject({ status: "bought", bought_item_id: r.body.item_id });
  });

  it("쇼핑 검색: 키가 없으면 링크만", async () => {
    const r = await get("/shopping/search?q=" + encodeURIComponent("울 코트"));
    expect(r.body).toMatchObject({ query: "울 코트", source: "links", naver_enabled: false, results: [] });
    expect(r.body.links).toHaveLength(3);
    expect(r.body.notice).toContain("NAVER_CLIENT_ID");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await get("/shopping/search")).status).toBe(400);
    expect((await get("/shopping/search?q=a&limit=999")).status).toBe(400);
    expect((await get("/shopping/status")).body).toEqual({ naver_enabled: false });
  });

  it("쇼핑 검색: 네이버 키가 있으면 문서대로 호출하고, 실패하면 링크로 대체", async () => {
    t.env.NAVER_CLIENT_ID = "cid";
    t.env.NAVER_CLIENT_SECRET = "csecret";
    route({ "openapi.naver.com": () => Response.json({ total: 1, items: [{ title: "<b>울</b> 코트", link: "https://smartstore.naver.com/a/1", image: "https://img/1.jpg", lprice: "99000", mallName: "몰", productId: "9" }] }) });
    const r = await get("/shopping/search?q=" + encodeURIComponent("울 코트") + "&limit=5");
    expect(r.body).toMatchObject({ source: "naver", naver_enabled: true, notice: null });
    expect(r.body.results).toEqual([{ title: "울 코트", url: "https://smartstore.naver.com/a/1", image_url: "https://img/1.jpg", price: 99000, mall: "몰", brand: null, category: [], product_id: "9" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("https://openapi.naver.com/v1/search/shop.json?query=");
    expect(url).toContain("display=5");
    expect(init?.headers).toMatchObject({ "X-Naver-Client-Id": "cid", "X-Naver-Client-Secret": "csecret" });

    fetchMock.mockReset();
    route({ "openapi.naver.com": () => Response.json({ errorMessage: "NID AUTH Result Invalid", errorCode: "024" }, { status: 401 }) });
    const bad = await get("/shopping/search?q=x");
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ source: "links", results: [] });
    expect(bad.body.notice).toContain("네이버 API 키");
    expect(bad.body.links).toHaveLength(3);
  });

  it("위시리스트 구매 링크 저장", async () => {
    const w = (await post("/wishlist", { name: "울 코트", colors: ["카멜"] })).body.id;
    const r = await call("POST", `/wishlist/${w}/links`);
    expect(r.body.query).toBe("카멜 울 코트");
    expect(r.body.recommended_links.map((l: Json) => l.source)).toEqual(["naver_search", "musinsa_search", "29cm_search"]);
    expect((await get(`/wishlist/${w}`)).body.recommended_links).toHaveLength(3);
  });
});

describe("OOTD 셀카 매칭", () => {
  it("후보를 돌려주고 캐시한다. 헷갈리는 piece는 옷 사진으로 한 번 더 확인", async () => {
    await putImage("img/selfie.webp");
    await putImage("img/a.webp");
    await putImage("img/b.webp");
    const a = await addItem({ name: "흰 티", image_key: "img/a.webp" });
    const b = await addItem({ name: "아이보리 티", image_key: "img/b.webp" });
    const c = await addItem({ name: "청바지", category: "bottom" });
    let n = 0;
    route({
      generativelanguage: () =>
        ++n === 1
          ? geminiReply({ summary: "캐주얼", pieces: [{ category: "top", description: "밝은 티셔츠", candidates: [{ item_id: a, confidence: 0.6 }, { item_id: b, confidence: 0.55 }, { item_id: "ghost", confidence: 1 }] }, { category: "bottom", description: "청바지", candidates: [{ item_id: c, confidence: 0.95 }] }] })
          : geminiReply({ picks: [{ piece: 0, item_id: b, confidence: 0.9 }] }),
    });
    const r = await post("/ootd/analyze", { image_key: "img/selfie.webp" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ image_key: "img/selfie.webp", summary: "캐주얼", verified: true, cached: false });
    expect(r.body.pieces[0].candidates).toEqual([{ item_id: b, confidence: 0.9 }, { item_id: a, confidence: 0.4 }]);
    expect(r.body.suggested_item_ids).toEqual([b, c]);
    expect(n).toBe(2);
    const verifyBody = JSON.parse(String(geminiCalls()[1][1]?.body));
    expect(verifyBody.contents[0].parts.filter((p: Json) => p.inlineData)).toHaveLength(3); // 셀카 + 후보 2장

    const again = await post("/ootd/analyze", { image_key: "img/selfie.webp" });
    expect(again.body).toMatchObject({ cached: true, verified: true, suggested_item_ids: [b, c] });
    expect(n).toBe(2);

    // 확인 → 기록 저장
    const log = await post("/logs", { item_ids: r.body.suggested_item_ids, selfie_key: "img/selfie.webp", date: "2026-11-14" });
    expect(log.status).toBe(201);
    expect(t.db.rows("SELECT wear_count FROM items WHERE id = ?", b)).toEqual([{ wear_count: 1 }]);
  });

  it("verify=false면 한 번만 부르고, 2단계가 실패해도 1단계 결과를 쓴다", async () => {
    await putImage("img/selfie.webp");
    await putImage("img/a.webp");
    await putImage("img/b.webp");
    const a = await addItem({ image_key: "img/a.webp" });
    const b = await addItem({ image_key: "img/b.webp" });
    const first = geminiReply({ summary: "s", pieces: [{ category: "top", description: "티", candidates: [{ item_id: a, confidence: 0.6 }, { item_id: b, confidence: 0.5 }] }] });
    let n = 0;
    route({ generativelanguage: () => (++n === 1 ? first.clone() : Response.json({ error: { message: "quota" } }, { status: 429 })) });
    const r = await post("/ootd/analyze", { image_key: "img/selfie.webp" });
    expect(r.body).toMatchObject({ verified: false, suggested_item_ids: [a] });

    n = 0;
    const r2 = await post("/ootd/analyze", { image_key: "img/selfie.webp", force: true, verify: false });
    expect(r2.body.verified).toBe(false);
    expect(n).toBe(1);
  });

  it("검증: 사진 필요, 옷장 필요, 옷을 못 찾으면 422", async () => {
    expect((await post("/ootd/analyze", {})).status).toBe(400);
    expect((await post("/ootd/analyze", { image_key: "img/s.webp" })).status).toBe(400);
    await addItem();
    await putImage("img/s.webp");
    route({ generativelanguage: () => geminiReply({ summary: "", pieces: [] }) });
    expect((await post("/ootd/analyze", { image_key: "img/s.webp" })).status).toBe(422);
  });
});

describe("여행 짐 싸기", () => {
  const today = new Date().toISOString().slice(0, 10);
  const plus = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);

  it("CRUD와 검증", async () => {
    expect((await post("/trips", { start_date: plus(1), end_date: plus(3) })).body.error).toBe("여행지를 입력해 주세요");
    expect((await post("/trips", { destination: "도쿄", start_date: plus(3), end_date: plus(1) })).status).toBe(400);
    expect((await post("/trips", { destination: "도쿄", start_date: plus(1), end_date: plus(60) })).status).toBe(400);
    expect((await post("/trips", { destination: "도쿄", start_date: "내일", end_date: plus(2) })).status).toBe(400);
    const r = await post("/trips", { destination: "도쿄", start_date: plus(1), end_date: plus(3), notes: "하루 2만 보" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "도쿄 여행", destination: "도쿄", plan: null, checklist: [], lat: null });
    expect((await patch(`/trips/${r.body.id}`, { name: "겨울 도쿄", end_date: plus(4) })).body).toMatchObject({ name: "겨울 도쿄", end_date: plus(4) });
    expect((await get("/trips")).body).toHaveLength(1);
    expect((await del(`/trips/${r.body.id}`)).body).toEqual({ ok: true });
    expect((await get(`/trips/${r.body.id}`)).status).toBe(404);
  });

  it("계획 생성: 지오코딩 + 예보 + Gemini → 캡슐/일차별/체크리스트, 캐시, 챙김 표시", async () => {
    const top = await addItem();
    const bottom = await addItem({ name: "슬랙스", category: "bottom" });
    const trip = (await post("/trips", { destination: "도쿄", start_date: plus(1), end_date: plus(2), notes: "많이 걸음" })).body;
    route({
      "geocoding-api": () => Response.json({ results: [{ name: "도쿄", latitude: 35.68, longitude: 139.69, country: "일본" }] }),
      "api.open-meteo.com": () => Response.json({ daily: { time: [plus(1), plus(2)], temperature_2m_max: [13, 12], temperature_2m_min: [5, 4], precipitation_probability_max: [0, 60], weather_code: [0, 61] } }),
      generativelanguage: () => geminiReply({ summary: "가볍게", capsule_item_ids: [top], days: [{ day: 1, item_ids: [top, bottom], note: "맑음" }, { day: 2, item_ids: [top, "ghost"], note: "비" }], extras: ["충전기", "우산"], tips: ["돌려 입기"] }),
    });
    const r = await post(`/trips/${trip.id}/plan`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cached: false, lat: 35.68, lon: 139.69, location_name: "도쿄, 일본" });
    expect(r.body.plan.weather).toMatchObject({ status: "forecast" });
    expect(r.body.plan.weather.days[1]).toMatchObject({ date: plus(2), temp_min: 4, temp_max: 12, precip_probability: 60, description: "약한 비" });
    expect(r.body.plan.capsule_item_ids).toEqual([top, bottom]);
    expect(r.body.plan.days).toEqual([{ day: 1, date: plus(1), item_ids: [top, bottom], note: "맑음" }, { day: 2, date: plus(2), item_ids: [top], note: "비" }]);
    expect(r.body.checklist.map((e: Json) => [e.kind, e.label, e.packed])).toEqual([["item", "흰 셔츠", false], ["item", "슬랙스", false], ["extra", "충전기", false], ["extra", "우산", false]]);
    expect(promptOf()).toContain(`1일차 (${plus(1)}): 최저 5°C / 최고 13°C`);
    const forecastUrl = String(fetchMock.mock.calls.find(([u]) => String(u).includes("//api.open-meteo.com"))![0]);
    expect(forecastUrl).toContain(`start_date=${plus(1)}`);

    expect((await post(`/trips/${trip.id}/plan`)).body.cached).toBe(true);
    expect(geminiCalls()).toHaveLength(1);

    // 체크리스트
    const first = r.body.checklist[0].id;
    const packed = await patch(`/trips/${trip.id}/checklist/${first}`, { packed: true });
    expect(packed.body.checklist[0].packed).toBe(true);
    expect((await patch(`/trips/${trip.id}/checklist/${first}`, { label: "다른 이름" })).status).toBe(400);
    const added = await post(`/trips/${trip.id}/checklist`, { label: "여권" });
    expect(added.status).toBe(201);
    const passport = added.body.checklist.at(-1);
    expect(passport).toMatchObject({ kind: "extra", label: "여권", source: "user", packed: false });
    expect((await post(`/trips/${trip.id}/checklist`, { label: "여권" })).status).toBe(409);
    expect((await post(`/trips/${trip.id}/checklist`, {})).status).toBe(400);
    expect((await patch(`/trips/${trip.id}/checklist/nope`, { packed: true })).status).toBe(404);

    // 다시 생성해도 챙김 표시와 직접 추가한 준비물은 남는다
    const again = await post(`/trips/${trip.id}/plan`, { force: true });
    expect(again.body.cached).toBe(false);
    expect(again.body.checklist.find((e: Json) => e.id === first).packed).toBe(true);
    expect(again.body.checklist.some((e: Json) => e.label === "여권")).toBe(true);

    // 빠르게 연달아 체크(동시 요청): 예전에는 모두 같은 옛 목록을 읽고 덮어써서 마지막 체크만 남았다
    const ids = again.body.checklist.map((e: Json) => e.id);
    await call("PUT", `/trips/${trip.id}/checklist`, { packed: false });
    // 실제 D1 처럼 읽기와 쓰기 사이에 다른 요청이 끼어들 수 있게: 여행을 읽은 뒤 잠깐 쉰다
    const db = t.env.DB as unknown as { prepare: (sql: string) => object };
    const realPrepare = db.prepare.bind(db);
    type Stmt = { bind: (...a: unknown[]) => Stmt; first: () => Promise<unknown> };
    const slow = (st: Stmt): Stmt =>
      new Proxy(st, {
        get(target, prop) {
          if (prop === "bind") return (...a: unknown[]) => slow(target.bind(...a));
          if (prop === "first") return async () => (await target.first().then(async (r) => (await new Promise((w) => setTimeout(w, 5)), r)));
          const v = (target as unknown as Record<string | symbol, unknown>)[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    db.prepare = (sql: string) => (/^SELECT \* FROM trips WHERE id/.test(sql) ? slow(realPrepare(sql) as Stmt) : realPrepare(sql));
    const burst = await Promise.all(ids.map((eid: string) => patch(`/trips/${trip.id}/checklist/${eid}`, { packed: true })));
    db.prepare = realPrepare;
    expect(burst.map((x) => x.status)).toEqual(ids.map(() => 200));
    expect((await get(`/trips/${trip.id}`)).body.checklist.every((e: Json) => e.packed)).toBe(true);

    // 계획을 다시 만드는 동안(AI 대기) 체크한 것도 남는다
    await call("PUT", `/trips/${trip.id}/checklist`, { packed: false });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    route({
      "geocoding-api": () => Response.json({ results: [] }),
      "api.open-meteo.com": () => Response.json({ daily: { time: [], temperature_2m_max: [], temperature_2m_min: [] } }),
      generativelanguage: async () => {
        await gate;
        return geminiReply({ summary: "다시", capsule_item_ids: [top, bottom], days: [{ day: 1, item_ids: [top, bottom], note: "" }], extras: ["충전기"], tips: [] });
      },
    });
    const regen = post(`/trips/${trip.id}/plan`, { force: true });
    await new Promise((r) => setTimeout(r, 20));
    expect((await patch(`/trips/${trip.id}/checklist/${first}`, { packed: true })).status).toBe(200);
    release();
    const regenerated = await regen;
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.checklist.find((e: Json) => e.id === first).packed).toBe(true);

    const all = await call("PUT", `/trips/${trip.id}/checklist`, { packed: true });
    expect(all.body.checklist.every((e: Json) => e.packed)).toBe(true);
    const removed = await del(`/trips/${trip.id}/checklist/${passport.id}`);
    expect(removed.body.checklist.some((e: Json) => e.label === "여권")).toBe(false);
  });

  it("예보 범위 밖이면 예보를 부르지 않고 '예보 없음'으로 계획한다 (숫자를 지어내지 않음)", async () => {
    const top = await addItem();
    const bottom = await addItem({ name: "슬랙스", category: "bottom" });
    const trip = (await post("/trips", { destination: "파리", start_date: plus(60), end_date: plus(61), lat: 48.85, lon: 2.35 })).body;
    route({ generativelanguage: () => geminiReply({ summary: "계절 기준", capsule_item_ids: [top, bottom], days: [{ day: 1, item_ids: [top, bottom], note: "" }], extras: [], tips: [] }) });
    const r = await post(`/trips/${trip.id}/plan`);
    expect(r.body.plan.weather).toMatchObject({ status: "unavailable", days: [] });
    expect(r.body.plan.weather.message).toContain("예보");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("open-meteo"))).toBe(false);
    expect(promptOf()).toContain("예보 없음");
    expect(promptOf()).not.toMatch(/최저 -?\d/);
    expect(r.body.plan.days[1]).toEqual({ day: 2, date: plus(61), item_ids: [], note: "" });
  });

  it("예보 서버가 실패해도 계획은 만들고 이유를 알려 준다", async () => {
    const top = await addItem();
    const bottom = await addItem({ name: "슬랙스", category: "bottom" });
    const trip = (await post("/trips", { destination: "부산", start_date: plus(1), end_date: plus(1), lat: 35.1, lon: 129 })).body;
    route({
      "api.open-meteo.com": () => Response.json({ error: true, reason: "out of range" }, { status: 400 }),
      generativelanguage: () => geminiReply({ summary: "s", capsule_item_ids: [top, bottom], days: [{ day: 1, item_ids: [top, bottom], note: "" }], extras: [], tips: [] }),
    });
    const r = await post(`/trips/${trip.id}/plan`);
    expect(r.status).toBe(200);
    expect(r.body.plan.weather.status).toBe("unavailable");
    expect(r.body.plan.weather.message).toContain("400");
  });

  it("옷이 부족하면 400", async () => {
    const trip = (await post("/trips", { destination: "제주", start_date: plus(1), end_date: plus(2) })).body;
    expect((await post(`/trips/${trip.id}/plan`)).status).toBe(400);
    expect((await post("/trips/nope/plan")).status).toBe(404);
  });
});

describe("가상 피팅", () => {
  it("설정이 없으면 status가 이유를 알려 주고 시작은 503", async () => {
    const s = await get("/tryon/status");
    expect(s.body).toMatchObject({ available: false, provider: null });
    expect(s.body.reason).toContain("꺼져");
    expect(s.body.setup_hint).toContain("콜라주");
    const r = await post("/tryon", { garment_image_key: "img/g.webp", person_image_key: "img/p.webp" });
    expect(r.status).toBe(503);
    expect((await get("/tryon")).body).toEqual([]);
  });

  it("Replicate: 시작 → 폴링 → 결과를 R2에 복사", async () => {
    t.env.REPLICATE_API_TOKEN = "r8_token";
    await putImage("img/person.webp");
    await putImage("img/shirt.webp");
    const shirt = await addItem({ image_key: "img/shirt.webp", colors: ["화이트"] });
    await patch("/profile", { mannequin_images: ["img/person.webp"] });
    let polls = 0;
    route({
      "api.replicate.com/v1/predictions/pred1": () => Response.json(++polls === 1 ? { id: "pred1", status: "processing", output: null } : { id: "pred1", status: "succeeded", output: "https://replicate.delivery/out/result.png" }),
      "api.replicate.com/v1/predictions": () => Response.json({ id: "pred1", status: "starting", output: null, error: null }, { status: 201 }),
      "replicate.delivery": () => new Response(imageBytes("png", 40), { headers: { "content-type": "image/png" } }),
    });
    expect((await get("/tryon/status")).body).toMatchObject({ available: true, provider: "replicate" });

    const start = await post("/tryon", { item_id: shirt });
    expect(start.status).toBe(202);
    expect(start.body).toMatchObject({ status: "processing", provider: "replicate", person_image_key: "img/person.webp", garment_image_key: "img/shirt.webp", garment_item_id: shirt, category: "top", result_image_key: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.replicate.com/v1/predictions");
    expect(init?.headers).toMatchObject({ authorization: "Bearer r8_token" });
    const sent = JSON.parse(String(init?.body));
    expect(sent.version).toMatch(/^cuuupid\/idm-vton:[0-9a-f]{64}$/);
    expect(sent.input).toMatchObject({ category: "upper_body", crop: true, garment_des: "화이트 흰 셔츠" });
    expect(sent.input.human_img).toMatch(/^data:image\/webp;base64,/);

    expect((await get(`/tryon/${start.body.id}`)).body.status).toBe("processing");
    const done = await get(`/tryon/${start.body.id}`);
    expect(done.body).toMatchObject({ status: "succeeded", result_image_key: `tryon/${start.body.id}.png`, error: null });
    expect(t.bucket.objects.get(`tryon/${start.body.id}.png`)?.data.length).toBe(40);
    const download = fetchMock.mock.calls.find(([u]) => String(u).includes("replicate.delivery"))!;
    expect(download[1]?.headers).toMatchObject({ authorization: "Bearer r8_token" });
    expect((await get(`/images/tryon/${start.body.id}.png`)).status).toBe(200);

    // 끝난 작업은 다시 조회해도 Replicate를 부르지 않는다
    const before = fetchMock.mock.calls.length;
    await get(`/tryon/${start.body.id}`);
    expect(fetchMock.mock.calls.length).toBe(before);

    // 삭제: 결과만 지우고 옷/마네킹 사진은 남긴다
    await del(`/tryon/${start.body.id}`);
    expect([...t.bucket.objects.keys()].sort()).toEqual(["img/person.webp", "img/shirt.webp"]);
  });

  it("Replicate: 실패 상태와 지원하지 않는 종류", async () => {
    t.env.REPLICATE_API_TOKEN = "r8_token";
    await putImage("img/person.webp");
    await putImage("img/g.webp");
    const shoes = await addItem({ name: "스니커즈", category: "shoes", image_key: "img/g.webp" });
    expect((await post("/tryon", { item_id: shoes, person_image_key: "img/person.webp" })).status).toBe(400);
    expect((await post("/tryon", { person_image_key: "img/person.webp" })).status).toBe(400);
    expect((await post("/tryon", { garment_image_key: "img/g.webp" })).body.error).toContain("전신 사진");
    const noPhoto = await addItem({ name: "사진 없음" });
    expect((await post("/tryon", { item_id: noPhoto, person_image_key: "img/person.webp" })).status).toBe(400);

    route({
      "api.replicate.com/v1/predictions/p2": () => Response.json({ id: "p2", status: "failed", error: "NSFW content detected" }),
      "api.replicate.com/v1/predictions": () => Response.json({ id: "p2", status: "starting" }, { status: 201 }),
    });
    const start = await post("/tryon", { garment_image_key: "img/g.webp", person_image_key: "img/person.webp", category: "bottom" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).input.category).toBe("lower_body");
    const r = await get(`/tryon/${start.body.id}`);
    expect(r.body.status).toBe("failed");
    expect(r.body.error).toContain("NSFW");

    fetchMock.mockReset();
    route({ "api.replicate.com/v1/predictions": () => Response.json({ detail: "Unauthenticated" }, { status: 401 }) });
    const bad = await post("/tryon", { garment_image_key: "img/g.webp", person_image_key: "img/person.webp" });
    expect(bad.status).toBe(502);
    expect(bad.body.error).toContain("REPLICATE_API_TOKEN");
    expect((await get("/tryon")).body).toHaveLength(1); // 만들지 못한 요청은 기록에 남기지 않는다
  });

  it("Gemini: 시작은 바로 202, 첫 폴링에서 생성하고 실패는 기록에 남긴다", async () => {
    t.env.TRYON_PROVIDER = "gemini";
    await putImage("img/person.webp");
    await putImage("img/g.webp");
    const w = (await post("/wishlist", { name: "울 코트", category: "outer", image_key: "img/g.webp" })).body.id;
    route({ "v1/models/gemini-nano-banana-2.1:generateContent": () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQIDBAU=" } }] } }] }) });

    const start = await post("/tryon", { wish_id: w, person_image_key: "img/person.webp" });
    expect(start.status).toBe(202);
    expect(start.body).toMatchObject({ status: "queued", provider: "gemini", model: "gemini-nano-banana-2.1", garment_wish_id: w, category: "outer" });
    expect(fetchMock).not.toHaveBeenCalled();

    const done = await get(`/tryon/${start.body.id}`);
    expect(done.body).toMatchObject({ status: "succeeded", result_image_key: `tryon/${start.body.id}.png` });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1/models/gemini-nano-banana-2.1:generateContent");
    const parts = JSON.parse(String(init?.body)).contents[0].parts;
    expect(parts.map((p: Json) => Object.keys(p)[0])).toEqual(["inline_data", "inline_data", "text"]);
    expect(parts[2].text).toContain("울 코트");

    fetchMock.mockReset();
    route({ generateContent: () => Response.json({ error: { message: "billing required" } }, { status: 429 }) });
    const second = await post("/tryon", { wish_id: w, person_image_key: "img/person.webp" });
    const failed = await get(`/tryon/${second.body.id}`);
    expect(failed.body.status).toBe("failed");
    expect(failed.body.error).toContain("결제");
    expect((await get("/tryon")).body).toHaveLength(2);
  });
});

describe("가상 피팅: 쇼핑몰 사진만 있는 위시리스트 옷", () => {
  it("사진을 R2로 가져와 위시리스트에도 저장하고 피팅을 시작한다, 못 가져오면 422로 이유를 알린다", async () => {
    t.env.TRYON_PROVIDER = "gemini";
    await putImage("img/person.webp");
    const w = (await post("/wishlist", { name: "니트", category: "top", image_url: "https://shop.example.com/knit.jpg" })).body.id;
    route({ "shop.example.com/knit.jpg": () => new Response(imageBytes("jpeg", 64), { headers: { "content-type": "image/jpeg" } }) });
    const start = await post("/tryon", { wish_id: w, person_image_key: "img/person.webp" });
    expect(start.status).toBe(202);
    expect(start.body.garment_image_key).toMatch(/^img\/.+\.jpeg$/);
    expect((await get(`/wishlist/${w}`)).body.image_key).toBe(start.body.garment_image_key);

    const w2 = (await post("/wishlist", { name: "코트", category: "outer", image_url: "https://shop.example.com/blocked.jpg" })).body.id;
    route({ "shop.example.com/blocked.jpg": () => new Response("no", { status: 403 }) });
    const blocked = await post("/tryon", { wish_id: w2, person_image_key: "img/person.webp" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toContain("가져오지 못했어요");
  });
});

describe("스크랩 / 단축어", () => {
  it("스크랩 분석: 없는 id 제거, piece를 위시리스트로", async () => {
    await putImage("img/ref.webp");
    const top = await addItem();
    const insp = await post("/inspirations", { image_key: "img/ref.webp", note: "핀터레스트" });
    expect(insp.status).toBe(201);
    expect((await post("/inspirations", {})).status).toBe(400);
    route({ generativelanguage: () => geminiReply({ summary: "미니멀", pieces: [{ category: "top", description: "흰 셔츠", colors: ["화이트"], matched_item_ids: [top, "ghost"] }, { category: "hat?", description: "버킷햇", colors: [], matched_item_ids: [] }] }) });
    const a = await post(`/inspirations/${insp.body.id}/analyze`);
    expect(a.body.analysis.pieces).toEqual([
      { category: "top", description: "흰 셔츠", colors: ["화이트"], matched_item_ids: [top], wishlist_id: null },
      { category: "accessory", description: "버킷햇", colors: [], matched_item_ids: [], wishlist_id: null },
    ]);
    await post(`/inspirations/${insp.body.id}/analyze`);
    expect(geminiCalls()).toHaveLength(1);
    const w = await post(`/inspirations/${insp.body.id}/pieces/1/wishlist`);
    expect(w.status).toBe(201);
    expect((await post(`/inspirations/${insp.body.id}/pieces/1/wishlist`)).body).toEqual(w.body);
    expect((await post(`/inspirations/${insp.body.id}/pieces/7/wishlist`)).status).toBe(400);
    // 스크랩을 지워도 위시리스트가 쓰는 사진은 남는다
    await del(`/inspirations/${insp.body.id}`);
    expect(t.bucket.objects.has("img/ref.webp")).toBe(true);
  });

  it("단축어: 토큰 검사, 이미지 → 스크랩", async () => {
    cookie = "";
    const send = (headers: Record<string, string>, body: BodyInit) => app.request("http://localhost/api/webhook/shortcut", { method: "POST", headers, body }, t.env);
    expect((await send({ "content-type": "application/json" }, "{}")).status).toBe(401);
    const ok = await send({ "x-shortcut-token": "shortcut-token", "content-type": "image/jpeg" }, imageBytes("jpeg", 20));
    expect(await ok.json()).toMatchObject({ ok: true, type: "inspiration" });
    expect((await send({ "x-shortcut-token": "shortcut-token", "content-type": "application/json" }, JSON.stringify({ url: "http://127.0.0.1/x" }))).status).toBe(400);
    expect((await send({ "x-shortcut-token": "shortcut-token", "content-type": "application/json" }, "[]")).status).toBe(400);
  });
});

describe("검수 1회차 추가", () => {
  it("GET /status: 켜짐/꺼짐만 알려 주고 시크릿 값은 내려주지 않는다", async () => {
    t = makeEnv({ GEMINI_API_KEY: "g-secret-value", NAVER_CLIENT_ID: "nid", NAVER_CLIENT_SECRET: "nsecret-value", REPLICATE_API_TOKEN: "" });
    const r = await get("/status");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ai: { configured: true, model: "gemini-flash-latest" }, shopping: { naver_enabled: true }, shortcut: { configured: true }, tryon: { available: false } });
    const text = JSON.stringify(r.body);
    for (const secret of ["g-secret-value", "nsecret-value", "nid", "shortcut-token", TEST_SECRET]) expect(text).not.toContain(secret);
    t = makeEnv({ SHORTCUT_TOKEN: "" });
    expect((await get("/status")).body).toMatchObject({ ai: { configured: false }, shortcut: { configured: false }, shopping: { naver_enabled: false } });
    cookie = "";
    expect((await get("/status")).status).toBe(401);
  });

  it("구매 링크 다시 찾기: 직접 추가한 링크는 남기고 검색 링크만 바꾼다", async () => {
    const w = (await post("/wishlist", { name: "울 코트" })).body.id;
    await patch(`/wishlist/${w}`, { recommended_links: [{ title: "내 링크", url: "https://shop.example.com/mine" }, { title: "예전 검색", url: "https://old.example.com/s", source: "naver_search" }] });
    const r = await post(`/wishlist/${w}/links`, { query: "울 코트" });
    expect(r.status).toBe(200);
    const sources = r.body.recommended_links.map((l: Json) => l.source);
    expect(sources).toEqual(["naver_search", "musinsa_search", "29cm_search", "custom"]);
    expect(r.body.recommended_links.some((l: Json) => l.url === "https://old.example.com/s")).toBe(false);
    expect((await get(`/wishlist/${w}`)).body.recommended_links.find((l: Json) => l.source === "custom").url).toBe("https://shop.example.com/mine");
  });

  it("코디 대표 사진: 저장·변경·삭제 때 안 쓰는 그림만 정리한다", async () => {
    const top = await addItem();
    await putImage("img/cover1.webp");
    await putImage("img/cover2.webp");
    const o = await post("/outfits", { item_ids: [top], cover_image_key: "img/cover1.webp" });
    expect(o.status).toBe(201);
    expect(o.body.cover_image_key).toBe("img/cover1.webp");
    expect((await post("/outfits", { item_ids: [top], cover_image_key: "javascript:1" })).status).toBe(400);
    const p = await patch(`/outfits/${o.body.id}`, { cover_image_key: "img/cover2.webp" });
    expect(p.body.cover_image_key).toBe("img/cover2.webp");
    expect(t.bucket.objects.has("img/cover1.webp")).toBe(false);
    expect((await patch("/outfits/nope", { name: "x" })).status).toBe(404);
    await del(`/outfits/${o.body.id}`);
    expect(t.bucket.objects.has("img/cover2.webp")).toBe(false);
    // 코디가 쓰는 그림은 옷을 지워도 남는다
    await putImage("img/shared.webp");
    const item = await addItem({ image_key: "img/shared.webp" });
    await post("/outfits", { item_ids: [top], cover_image_key: "img/shared.webp" });
    await del(`/items/${item}`);
    expect(t.bucket.objects.has("img/shared.webp")).toBe(true);
  });

  it("스크랩 kind: 기본 photo, collage도 받는다", async () => {
    await putImage("img/k.webp");
    expect((await post("/inspirations", { image_key: "img/k.webp" })).body.kind).toBe("photo");
    expect((await post("/inspirations", { image_key: "img/k.webp", kind: "collage" })).body.kind).toBe("collage");
    expect((await post("/inspirations", { image_key: "img/k.webp", kind: "x" })).status).toBe(400);
  });

  it("체형 진단은 진단한 사진을 body_image_key로 저장한다", async () => {
    await putImage("img/body.webp");
    route({ generativelanguage: () => geminiReply({ body_type: "wave", proportions: "p", features: [], fit_tips: [], avoid: [], confidence: "high", caveat: "" }) });
    const r = await post("/profile/analyze-body", { image_key: "img/body.webp" });
    expect(r.status).toBe(200);
    expect(r.body.body_image_key).toBe("img/body.webp");
    expect(r.body.body_analysis.image_key).toBe("img/body.webp");
  });

  it("단축어 target=closet: 상품 링크를 옷장에 바로 등록 (카테고리 추정, AI 실패해도 저장)", async () => {
    cookie = "";
    const html = `<meta property="og:title" content="코튼 와이드 팬츠"><meta property="og:image" content="https://shop.example.com/i.jpg"><meta property="product:price:amount" content="49000">`;
    route({
      "shop.example.com/p": () => new Response(html, { headers: { "content-type": "text/html" } }),
      "shop.example.com/i.jpg": () => new Response(imageBytes("jpeg", 40), { headers: { "content-type": "image/jpeg" } }),
      generativelanguage: () => new Response("{}", { status: 500 }),
    });
    const res = await app.request(
      "http://localhost/api/webhook/shortcut",
      { method: "POST", headers: { "x-shortcut-token": "shortcut-token", "content-type": "application/json" }, body: JSON.stringify({ url: "https://shop.example.com/p/1", target: "closet" }) },
      t.env,
    );
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({ ok: true, type: "item" });
    cookie = await sessionCookie();
    const item = (await get(`/items/${body.id}`)).body;
    expect(item).toMatchObject({ name: "코튼 와이드 팬츠", category: "bottom", purchase_price: 49000, original_shop_url: "https://shop.example.com/p/1" });
    expect(item.image_key).toMatch(/^img\//);
  });
});

describe("검수 2회차 추가", () => {
  it("단축어: 이미지 주소 + target=wishlist 는 위시리스트로 (target 이 없으면 스크랩)", async () => {
    cookie = "";
    route({ "img.example.com/a.jpg": () => new Response(imageBytes("jpeg", 40), { headers: { "content-type": "image/jpeg" } }) });
    const send = (body: Json) =>
      app.request("http://localhost/api/webhook/shortcut", { method: "POST", headers: { "x-shortcut-token": "shortcut-token", "content-type": "application/json" }, body: JSON.stringify(body) }, t.env);
    const w = (await (await send({ url: "https://img.example.com/a.jpg", target: "wishlist", note: "봄 니트" })).json()) as Json;
    expect(w).toMatchObject({ ok: true, type: "wishlist" });
    const i = (await (await send({ url: "https://img.example.com/a.jpg" })).json()) as Json;
    expect(i).toMatchObject({ ok: true, type: "inspiration" });
    cookie = await sessionCookie();
    expect((await get(`/wishlist/${w.id}`)).body).toMatchObject({ name: "봄 니트", image_url: "https://img.example.com/a.jpg" });
    expect((await get(`/wishlist/${w.id}`)).body.image_key).toMatch(/^img\//);
  });

  it("단축어: 토큰이 틀리면 target=closet 도 저장하지 않는다", async () => {
    cookie = "";
    const r = await app.request(
      "http://localhost/api/webhook/shortcut",
      { method: "POST", headers: { "x-shortcut-token": "wrong", "content-type": "application/json" }, body: JSON.stringify({ url: "https://shop.example.com/p/1", target: "closet" }) },
      t.env,
    );
    expect(r.status).toBe(401);
    cookie = await sessionCookie();
    expect((await get("/items")).body).toEqual([]);
  });
});

describe("쿼리 수 (N+1 방지)", () => {
  it("위시리스트 20개 조회에 쿼리가 늘어나지 않는다", async () => {
    for (let i = 0; i < 20; i++) await post("/wishlist", { name: `옷 ${i}` });
    const spy = vi.spyOn(t.db, "prepare");
    await get("/wishlist");
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
