#!/usr/bin/env node
/**
 * 끝에서 끝까지(E2E) 연기 테스트. `npm run e2e` 로 실행한다 (`npm test` 에는 포함되지 않음).
 *
 * 하는 일:
 *  1. 저장소 밖 임시 폴더에 격리된 wrangler 설정·.dev.vars(PIN 1234, Gemini 키 없음)·D1/R2 상태를 만들고
 *     Vite 개발 서버를 포트 5184(E2E_PORT)에 띄운다. 저장소 안에는 아무 파일도 만들지 않는다.
 *  2. API로 옷·코디·스크랩·위시리스트·여행·착용 기록·프로필 사진을 넣는다.
 *  3. 390×844(모바일)과 1440×900(데스크톱)에서 모든 화면을 열고 내비게이션을 눌러 본다.
 *     콘솔 오류, 페이지 오류, 5xx 응답, 가로 넘침이 하나라도 있으면 실패.
 *  4. 몇 가지 흐름을 실제로 눌러 본다: 콜라주 → 코디로 저장(대표 그림), 구매 링크 다시 찾기(직접 추가한 링크 유지),
 *     AI 성공 경로(Playwright page.route 로 계약서 모양의 가짜 응답), 모바일 피팅룸 고정 "피팅 시작" 바.
 *  5. 서버를 끄고 임시 폴더를 지운다 (E2E_KEEP=1 이면 남김). 스크린숏은 E2E_OUT(기본: 임시 폴더/shots).
 *
 * 외부 네트워크(Open-Meteo, Pretendard 글꼴 CDN)는 브라우저에서 가짜로 응답한다.
 */
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.E2E_PORT ?? 5184);
const BASE = `http://localhost:${PORT}`;
const KEEP = process.env.E2E_KEEP === "1";
const TMP = mkdtempSync(join(process.env.E2E_TMP ?? tmpdir(), "clothe-e2e-"));
const OUT = process.env.E2E_OUT ? resolve(process.env.E2E_OUT) : join(TMP, "shots");
mkdirSync(OUT, { recursive: true });

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

/* ───────────── 격리된 서버 ───────────── */

function writeIsolatedConfig() {
  const raw = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/\s\/\/ .*$/, ""))
    .join("\n");
  const cfg = JSON.parse(raw);
  delete cfg.$schema;
  cfg.main = join(ROOT, "worker/index.ts");
  for (const d of cfg.d1_databases ?? []) d.migrations_dir = join(ROOT, "migrations");
  const configPath = join(TMP, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  // 로컬 PIN 1234, Gemini 키 없음 (AI 성공 경로는 브라우저에서 가짜로)
  writeFileSync(join(TMP, ".dev.vars"), ["APP_PIN=1234", "SESSION_SECRET=e2e-session-secret-0123456789", "SHORTCUT_TOKEN=e2e-shortcut-token", "GEMINI_API_KEY=", ""].join("\n"));
  return configPath;
}

async function startServer() {
  const { createServer } = await import(join(ROOT, "node_modules/vite/dist/node/index.js"));
  const react = (await import(join(ROOT, "node_modules/@vitejs/plugin-react/dist/index.js"))).default;
  const tailwindcss = (await import(join(ROOT, "node_modules/@tailwindcss/vite/dist/index.mjs"))).default;
  const { cloudflare } = await import(join(ROOT, "node_modules/@cloudflare/vite-plugin/dist/index.mjs"));
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "warn",
    cacheDir: join(TMP, "vite-cache"),
    server: { port: PORT, strictPort: true },
    plugins: [react(), tailwindcss(), cloudflare({ configPath: writeIsolatedConfig(), persistState: { path: join(TMP, "state") } })],
  });
  await server.listen();
  return server;
}

/* ───────────── 시드 데이터 ───────────── */

/** 단색 PNG (API는 실제 이미지 바이트만 받는다) */
function png(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let cookie = "";
async function api(method, path, body) {
  const init = { method, headers: { cookie, origin: BASE } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const res = await fetch(`${BASE}/api${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function upload(color, w = 120, h = 160) {
  const form = new FormData();
  form.append("file", new File([png(w, h, color)], "a.png", { type: "image/png" }));
  return (await api("POST", "/images", form)).key;
}

async function seed() {
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "1234" }) });
  if (!login.ok) throw new Error(`로그인 실패 ${login.status}`);
  cookie = login.headers.get("set-cookie").split(";")[0];

  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const img = {};
  for (const [k, c] of Object.entries({ shirt: [240, 240, 236], slacks: [60, 60, 70], coat: [170, 120, 80], shoes: [30, 30, 30], person: [210, 190, 170], ref: [200, 180, 160], wish: [120, 140, 180] })) img[k] = await upload(c);

  const items = {
    shirt: await api("POST", "/items", { name: "흰 옥스퍼드 셔츠", category: "top", colors: ["화이트"], brand: "유니클로", purchase_price: 39000, image_key: img.shirt, season: ["spring", "fall"], warmth: 2 }),
    slacks: await api("POST", "/items", { name: "차콜 와이드 슬랙스", category: "bottom", colors: ["차콜"], purchase_price: 59000, image_key: img.slacks, warmth: 3 }),
    coat: await api("POST", "/items", { name: "카멜 울 코트", category: "outer", colors: ["카멜"], purchase_price: 289000, image_key: img.coat, warmth: 5 }),
    shoes: await api("POST", "/items", { name: "검정 더비 슈즈", category: "shoes", colors: ["블랙"], image_key: img.shoes }),
    nophoto: await api("POST", "/items", { name: "사진 없는 니트 (아주 긴 이름이 화면을 넘치지 않는지 확인하는 용도의 이름)", category: "top", colors: ["네이비"] }),
  };
  const outfit = await api("POST", "/outfits", { name: "출근룩", item_ids: [items.shirt.id, items.slacks.id, items.coat.id], tags: ["출근"] });
  await api("POST", "/items/wear", { item_ids: [items.shirt.id, items.slacks.id], date: today });
  await api("POST", "/logs", { item_ids: [items.coat.id], date: today, rating: 4, occasion_tags: ["데이트"], selfie_key: img.person, note: "따뜻했어요" }).catch(() => {});
  const photo = await api("POST", "/inspirations", { image_key: img.ref, source_url: "https://www.pinterest.com/pin/1", note: "핀터레스트" });
  const collage = await api("POST", "/inspirations", { image_key: img.ref, note: "콜라주 보드에서 만든 코디", kind: "collage" });
  const wish = await api("POST", "/wishlist", { name: "네이비 니트 베스트", category: "top", colors: ["네이비"], estimated_price: 79000, image_key: img.wish });
  await api("PATCH", `/wishlist/${wish.id}`, { recommended_links: [{ title: "내가 찾은 링크", url: "https://shop.example.com/knit" }] });
  await api("POST", "/wishlist", { name: "사진 없는 가방", category: "bag" });
  const start = new Date(Date.now() + 40 * 86400e3).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 43 * 86400e3).toISOString().slice(0, 10);
  const trip = await api("POST", "/trips", { destination: "도쿄", start_date: start, end_date: end, notes: "하루 2만 보 걷기", lat: 35.68, lon: 139.69, location_name: "도쿄" });
  await api("POST", `/trips/${trip.id}/checklist`, { label: "보조 배터리" });
  await api("PATCH", "/profile", { height_cm: 170, mannequin_images: [img.person] });
  return { img, items, outfit, photo, collage, wish, trip };
}

/* ───────────── 브라우저 ───────────── */

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return require(join(process.env.NODE_PATH?.split(":")[0] ?? "", "playwright"));
  }
}

const FORECAST = {
  current: { temperature_2m: 9.5 },
  daily: { time: ["2026-11-21"], temperature_2m_max: [14.2], temperature_2m_min: [2.1], precipitation_probability_max: [20], weather_code: [2] },
};

async function newContext(browser, viewport, label) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "ko-KR", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await context.addCookies([{ name: "clothe_session", value: cookie.split("=").slice(1).join("="), url: BASE }]);
  await context.route(/api\.open-meteo\.com/, (r) => r.fulfill({ json: FORECAST }));
  await context.route(/geocoding-api\.open-meteo\.com/, (r) => r.fulfill({ json: { results: [{ name: "성수동", admin1: "서울", country: "대한민국", latitude: 37.54, longitude: 127.05 }] } }));
  await context.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") fail(`[${label}] 콘솔 오류 (${page.url()}): ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => fail(`[${label}] 페이지 오류 (${page.url()}): ${e.message.slice(0, 300)}`));
  page.on("response", (res) => {
    if (res.status() >= 500) fail(`[${label}] ${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return { context, page };
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function checkOverflow(page, label, name) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (o.sw > o.cw + 1) {
    const culprits = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      return [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > cw + 1 && getComputedStyle(el).position !== "fixed")
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    });
    fail(`[${label}] 가로 넘침 ${name}: ${o.sw} > ${o.cw} (${culprits.join(", ")})`);
  }
}

async function visit(page, label, name, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await settle(page);
  const h1 = await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => null);
  if (!h1) fail(`[${label}] 제목(h1)이 없음: ${path}`);
  await checkOverflow(page, label, name);
  await page.screenshot({ path: join(OUT, `${label}-${name}.png`), fullPage: true });
}

async function screens(browser, viewport, label, s) {
  const { context, page } = await newContext(browser, viewport, label);
  const paths = {
    today: "/",
    closet: "/closet",
    "item-new": "/closet/new",
    item: `/closet/${s.items.shirt.id}`,
    "item-nophoto": `/closet/${s.items.nophoto.id}`,
    outfits: "/outfits",
    outfit: `/outfits/${s.outfit.id}`,
    calendar: "/outfits/calendar",
    ootd: "/outfits/ootd",
    inspo: "/inspo",
    "inspo-photo": `/inspo/${s.photo.id}`,
    "inspo-collage": `/inspo/${s.collage.id}`,
    wishlist: "/wishlist",
    wish: `/wishlist/${s.wish.id}`,
    travel: "/travel",
    trip: `/travel/${s.trip.id}`,
    profile: "/profile",
    color: "/profile/color",
    fitting: "/profile/fitting",
    settings: "/settings",
    more: "/more",
    "not-found": "/no-such-page",
  };
  for (const [name, path] of Object.entries(paths)) await visit(page, label, name, path);
  ok(`[${label}] 화면 ${Object.keys(paths).length}개`);

  // 내비게이션: 모바일 탭 바 + 더보기, 데스크톱 사이드바
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await settle(page);
  const navSel = viewport.width < 768 ? 'nav[aria-label="탭"] a' : 'nav[aria-label="주 메뉴"] a';
  const hrefs = await page.locator(navSel).evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  for (const href of hrefs) {
    await page.locator(`${navSel}[href="${href}"]`).click();
    await page.waitForURL((u) => u.pathname === href, { timeout: 5000 }).catch(() => fail(`[${label}] 내비게이션 ${href} 로 이동하지 않음`));
    await settle(page);
    await checkOverflow(page, label, `nav${href}`);
  }
  if (viewport.width < 768) {
    await page.goto(BASE + "/more", { waitUntil: "domcontentloaded" });
    await settle(page);
    const more = await page.locator("main a[href^='/']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    if (more.length < 3) fail(`[${label}] 더보기 링크가 너무 적음: ${more.join(",")}`);
    for (const href of more) {
      await page.goto(BASE + "/more", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.locator(`main a[href="${href}"]`).first().click();
      await page.waitForURL((u) => u.pathname === href, { timeout: 5000 }).catch(() => fail(`[${label}] 더보기 ${href} 로 이동하지 않음`));
    }
  }
  ok(`[${label}] 내비게이션 링크 ${hrefs.length}개`);
  await context.close();
}

/* ───────────── 흐름 ───────────── */

async function flowCollageCover(browser) {
  const label = "m-collage";
  const { context, page } = await newContext(browser, { width: 390, height: 844 }, label);
  await page.goto(BASE + "/profile/fitting", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: "옷장에서" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /흰 옥스퍼드 셔츠/ }).click();
  await page.getByRole("button", { name: /1벌 올리기/ }).click();
  await page.getByRole("button", { name: "코디로 저장" }).click();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/outfits") && r.request().method() === "POST", { timeout: 20000 }),
    page.getByRole("alertdialog").getByRole("button", { name: "저장" }).click(),
  ]);
  const outfit = await res.json();
  if (!outfit.cover_image_key) fail(`[${label}] 콜라주로 저장한 코디에 대표 그림이 없음`);
  else ok(`[${label}] 콜라주 → 코디로 저장 (대표 그림 ${outfit.cover_image_key})`);
  await page.screenshot({ path: join(OUT, `${label}-saved.png`), fullPage: true });
  await page.goto(BASE + `/outfits/${outfit.id}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  if (!(await page.getByRole("img", { name: /콜라주/ }).first().isVisible())) fail(`[${label}] 코디 상세에 대표 그림이 보이지 않음`);
  await page.screenshot({ path: join(OUT, `${label}-outfit.png`), fullPage: true });
  // 스크랩이 늘지 않았는지 (예전에는 콜라주가 스크랩으로 들어가 AI 분석을 불렀다)
  const insp = await api("GET", "/inspirations");
  if (insp.length !== 2) fail(`[${label}] 스크랩 수가 바뀜: ${insp.length}`);
  await context.close();
}

async function flowLinks(browser, s) {
  const label = "m-links";
  const { context, page } = await newContext(browser, { width: 390, height: 844 }, label);
  await page.goto(BASE + `/wishlist/${s.wish.id}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await Promise.all([page.waitForResponse((r) => r.url().includes(`/wishlist/${s.wish.id}/links`), { timeout: 20000 }), page.getByRole("button", { name: /다시 찾기|찾기/ }).first().click()]);
  await settle(page);
  if (!(await page.getByText("내가 찾은 링크").isVisible())) fail(`[${label}] 링크 다시 찾기 뒤 직접 추가한 링크가 사라짐`);
  const w = await api("GET", `/wishlist/${s.wish.id}`);
  if (!w.recommended_links.some((l) => l.source === "custom")) fail(`[${label}] 서버에서 직접 추가한 링크가 사라짐`);
  else ok(`[${label}] 구매 링크 다시 찾기: 직접 추가한 링크 유지`);
  await context.close();
}

async function flowAiMocks(browser, s) {
  const label = "m-ai";
  const { context, page } = await newContext(browser, { width: 390, height: 844 }, label);
  const status = { ai: { configured: true, model: "gemini-flash-latest" }, tryon: { available: true, provider: "gemini", model: "gemini-nano-banana-2.1", reason: null, setup_hint: null }, shopping: { naver_enabled: false }, shortcut: { configured: true } };
  await page.route("**/api/status", (r) => r.fulfill({ json: status }));
  await page.route("**/api/tryon/status", (r) => r.fulfill({ json: status.tryon }));
  const weather = { date: "2026-11-21", location_name: "서울", temp_min: 2, temp_max: 14, temp_now: 9, diurnal_range: 12, precip_probability: 20, weather_code: 2, description: "구름 조금" };
  await page.route("**/api/stylist/today", (r) =>
    r.fulfill({
      json: {
        weather,
        briefing: "일교차가 12도라 아침엔 코트를 걸치고 낮에는 벗어 들기 좋아요.",
        outfits: [{ title: "레이어드 출근룩", item_ids: [s.items.shirt.id, s.items.slacks.id, s.items.coat.id], reason: "탈착 가능한 아우터로 일교차 대비" }],
        dormant: [],
        profile_used: false,
      },
    }),
  );
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await settle(page);
  if (await page.getByText("AI 기능이 아직 연결되지 않았어요").isVisible()) fail(`[${label}] AI가 켜져 있는데 꺼짐 안내가 보임`);
  await page.getByRole("button", { name: "코디 추천받기" }).click();
  await page.getByText("레이어드 출근룩").first().waitFor({ timeout: 5000 }).then(
    () => ok(`[${label}] 오늘 코디 추천 (가짜 AI 응답)`),
    () => fail(`[${label}] 추천 결과가 보이지 않음`),
  );
  await checkOverflow(page, label, "today-result");
  await page.screenshot({ path: join(OUT, `${label}-today.png`), fullPage: true });

  // 스크랩 자동 분석: 사진은 분석, 콜라주는 부르지 않는다
  let analyzeCalls = 0;
  await page.route("**/api/inspirations/*/analyze*", (r) => {
    analyzeCalls++;
    return r.fulfill({ json: { ...s.photo, analysis: { summary: "미니멀 캐주얼", pieces: [{ category: "top", description: "흰 셔츠", colors: ["화이트"], matched_item_ids: [s.items.shirt.id], wishlist_id: null }, { category: "bag", description: "가죽 토트백", colors: ["브라운"], matched_item_ids: [], wishlist_id: null }] } } });
  });
  await page.goto(BASE + `/inspo/${s.collage.id}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  if (analyzeCalls !== 0) fail(`[${label}] 콜라주 스크랩을 열었더니 AI 분석을 불렀음`);
  await page.goto(BASE + `/inspo/${s.photo.id}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  if (analyzeCalls !== 1) fail(`[${label}] 사진 스크랩 자동 분석 횟수 ${analyzeCalls} (1이어야 함)`);
  else ok(`[${label}] 스크랩 자동 분석은 사진만 (콜라주는 안 부름)`);
  await page.screenshot({ path: join(OUT, `${label}-inspo.png`), fullPage: true });

  // 모바일 피팅룸: 옷 목록이 길어도 "피팅 시작"이 화면 안에 있다
  const job = { id: "job1", status: "queued", provider: "gemini", model: "gemini-nano-banana-2.1", person_image_key: s.img.person, garment_image_key: s.img.coat, garment_item_id: s.items.coat.id, garment_wish_id: null, category: "outer", result_image_key: null, error: null, created_at: "2026-11-21 00:00:00", updated_at: "2026-11-21 00:00:00" };
  await page.route("**/api/tryon", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 202, json: job }) : r.fulfill({ json: [] })));
  await page.route("**/api/tryon/job1", (r) => r.fulfill({ json: { ...job, status: "succeeded", result_image_key: s.img.person } }));
  await page.goto(BASE + "/profile/fitting", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: /카멜 울 코트/ }).click();
  const startBtn = page.getByRole("button", { name: "피팅 시작" }).filter({ visible: true }).first();
  if (!(await startBtn.isVisible())) fail(`[${label}] 모바일에서 피팅 시작 버튼이 보이지 않음`);
  else {
    const box = await startBtn.boundingBox();
    if (!box || box.y + box.height > 844) fail(`[${label}] 피팅 시작 버튼이 화면 아래에 있음 (y=${box?.y})`);
    else ok(`[${label}] 모바일 피팅 시작 고정 바 (y=${Math.round(box.y)})`);
  }
  await page.screenshot({ path: join(OUT, `${label}-fitting.png`) });
  await startBtn.click();
  await page.getByRole("img", { name: "가상 피팅 결과" }).first().waitFor({ timeout: 10000 }).then(
    () => ok(`[${label}] 가상 피팅 결과 (가짜 응답)`),
    () => fail(`[${label}] 가상 피팅 결과가 보이지 않음`),
  );
  await page.screenshot({ path: join(OUT, `${label}-fitting-done.png`), fullPage: true });
  await context.close();
}

/* ───────────── 실행 ───────────── */

let server;
let browser;
try {
  console.log(`E2E: 격리 상태 ${TMP}`);
  server = await startServer();
  const s = await seed();
  ok("시드 데이터");
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
  await screens(browser, { width: 390, height: 844 }, "m", s);
  await screens(browser, { width: 1440, height: 900 }, "d", s);
  await flowCollageCover(browser);
  await flowLinks(browser, s);
  await flowAiMocks(browser, s);
} catch (e) {
  fail(`실행 중 오류: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  console.log(`스크린숏: ${OUT}`);
  if (!KEEP && !process.env.E2E_OUT) rmSync(TMP, { recursive: true, force: true });
  else if (!KEEP) rmSync(join(TMP, "state"), { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nE2E 실패 ${failures.length}건`);
  process.exit(1);
}
console.log("\nE2E 통과");
process.exit(0);
