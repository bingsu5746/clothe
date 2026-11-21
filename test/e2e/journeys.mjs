#!/usr/bin/env node
/**
 * 실제 사용 흐름(사용자 여정) E2E. `npm run e2e` 의 세 번째 단계 (포트 5186, E2E_PORT).
 * iPhone(390×844, 터치, 밤이라 다크 테마)에서 주인이 실제로 쓰는 순서대로 누르고, 결과(서버 값·화면 값)를 확인한다.
 *
 *  a. 배포 직후 첫 실행 → PIN 로그인 → 빈 앱 → 사진으로 첫 옷(AI 키 없음) / 쇼핑몰 링크로 옷(로컬 가짜 쇼핑몰) → 옷장에 보임
 *  b. 옷 6벌 이상 → 오늘 추천(가짜 AI) → 저장 → 입기 → 착용 횟수·CPW 게이지가 새로고침 없이 어디서나 갱신
 *  c. iOS 단축어 웹훅(curl 과 같은 요청: 토큰 헤더 + 사진 / 쇼핑몰 링크 / target=closet) → 앱에 보임
 *  d. 스크랩 사진 → 분석(가짜) → 없는 옷 위시리스트로 → 판독(가짜) → 링크 → "샀어요" → 옷장에 가격과 함께, 위시리스트 상태
 *  e. OOTD 셀카 → 분석(가짜) → 확인 → 달력 → 날짜 고치기 → 지우기 → 착용 횟수 원래대로
 *  f. 여행 만들기 → 계획(가짜) → 체크리스트 → 다시 계획해도 체크 유지
 *  g. 프로필 키·몸무게 → 퍼스널 컬러(화이트밸런스, 색 찍기) → 결과(가짜) → 체형 진단(가짜)
 *  h. 콜라주 보드 → 코디로 저장(대표 그림) → 코디 목록/상세
 *  i. 설정 테마 바꾸기 → 새로고침해도 유지(깜빡임 없음) → 로그아웃 → 로그인
 *  + 모든 글 입력칸: 여러 단어 한국어(키보드 입력, IME 조합 이벤트) → 서버까지 갔다가 다시 보이는지, 숫자 칸은 이상한 글자 거절
 *
 * AI 성공 경로는 page.route 로 계약서(docs/api-contract.md) 모양의 가짜 응답을 준다. 서버가 저장해 두는 AI 결과(스크랩 분석)는
 * Gemini 를 부른 뒤와 같은 상태가 되도록 격리된 로컬 D1 파일에 직접 써 넣는다 (앱 코드에는 가짜가 없다).
 * 쇼핑몰은 로컬 HTTP 서버(127.0.0.1)로 흉내 낸다. 서버는 사설 주소를 막으므로(SSRF 방어) /etc/hosts 에
 * `127.0.0.1 shop.clothe-e2e.test` 가 있어야 하고, 쓸 수 있으면 이 스크립트가 넣었다가 끝나면 지운다. 못 넣으면 링크 단계는 건너뛴다.
 */
import http from "node:http";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BASE, OUT, TMP, api, cleanup, fail, failures, loadPlaywright, login as apiLogin, note, ok, png, settle, startServer, upload } from "./harness.mjs";

const PIN = "1234";
const SHOP_HOST = "shop.clothe-e2e.test";
const SHOP_PORT = Number(process.env.E2E_SHOP_PORT ?? 5187);
const SHOP = `http://${SHOP_HOST}:${SHOP_PORT}`;
const TOKEN = "e2e-shortcut-token";
const PHONE = { width: 390, height: 844 };

/* ───────────── 도구 ───────────── */

let hostsAdded = false;
function ensureHosts() {
  try {
    const hosts = readFileSync("/etc/hosts", "utf8");
    if (hosts.includes(SHOP_HOST)) return true;
    writeFileSync("/etc/hosts", `${hosts.replace(/\n?$/, "\n")}127.0.0.1 ${SHOP_HOST}\n`);
    hostsAdded = true;
    return true;
  } catch {
    return false;
  }
}
function restoreHosts() {
  if (!hostsAdded) return;
  try {
    writeFileSync("/etc/hosts", readFileSync("/etc/hosts", "utf8").split("\n").filter((l) => !l.includes(SHOP_HOST)).join("\n"));
  } catch {
    /* 무시 */
  }
}

/** 가짜 쇼핑몰: /p/<id> 상품 페이지(OpenGraph + JSON-LD), /img/<id>.png 상품 사진 */
const PRODUCTS = {
  coat: { name: "Levi's 울 블렌드 싱글 코트", brand: "LEVI'S", price: 189000, color: [120, 90, 60], crumbs: ["홈", "아우터", "코트"] },
  knit: { name: "라운드넥 캐시미어 니트", brand: "무신사 스탠다드", price: 59900, color: [200, 60, 60], crumbs: ["홈", "상의", "니트"] },
  jeans: { name: "와이드 데님 팬츠", brand: "29CM", price: 79000, color: [40, 60, 120], crumbs: ["홈", "하의", "데님"] },
};
function startShop() {
  const server = http.createServer((req, res) => {
    const m = req.url.match(/^\/(p|img)\/(\w+)/);
    const p = m && PRODUCTS[m[2]];
    if (!p) {
      res.writeHead(404).end();
      return;
    }
    if (m[1] === "img") {
      res.writeHead(200, { "content-type": "image/png" }).end(png(90, 120, p.color));
      return;
    }
    const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, brand: { name: p.brand }, image: [`/img/${m[2]}.png`], offers: { price: String(p.price), priceCurrency: "KRW" } };
    const crumbs = { "@type": "BreadcrumbList", itemListElement: p.crumbs.map((name, i) => ({ "@type": "ListItem", position: i + 1, name })) };
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
      `<!doctype html><html><head><title>${p.name} | 쇼핑몰</title><meta property="og:title" content="${p.name}"><meta property="og:image" content="/img/${m[2]}.png">` +
        `<script type="application/ld+json">${JSON.stringify(ld)}</script><script type="application/ld+json">${JSON.stringify(crumbs)}</script></head><body>상품</body></html>`,
    );
  });
  return new Promise((resolve) => server.listen(SHOP_PORT, "127.0.0.1", () => resolve(server)));
}

/** 격리된 로컬 D1 파일 (Gemini 를 부른 뒤 서버에 저장되는 결과를 흉내 낼 때만) */
function d1() {
  const dir = join(TMP, "state/v3/d1/miniflare-D1DatabaseObject");
  const f = readdirSync(dir).find((x) => x.endsWith(".sqlite") && x !== "metadata.sqlite");
  return new DatabaseSync(join(dir, f));
}

const FORECAST = {
  current: { temperature_2m: 6.5 },
  daily: { time: ["2026-11-21"], temperature_2m_max: [13.2], temperature_2m_min: [1.1], precipitation_probability_max: [10], weather_code: [1] },
};

/** iPhone: 390×844, 터치, 모바일, 밤이라 다크. 쿠키 없이 시작 (로그인은 화면에서) */
async function phone(browser, label, { colorScheme = "dark" } = {}) {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme });
  await context.route(/api\.open-meteo\.com/, (r) => r.fulfill({ json: FORECAST }));
  await context.route(/geocoding-api\.open-meteo\.com/, (r) =>
    r.fulfill({ json: { results: [{ name: "도쿄", admin1: "도쿄도", country: "일본", latitude: 35.68, longitude: 139.69 }, { name: "성수동", admin1: "서울", country: "대한민국", latitude: 37.54, longitude: 127.05 }] } }),
  );
  await context.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) fail(`[${label}] 콘솔 오류 (${page.url()}): ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => fail(`[${label}] 페이지 오류 (${page.url()}): ${e.message.slice(0, 300)}`));
  page.on("response", (res) => {
    if (res.status() >= 500) fail(`[${label}] ${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return { context, page };
}

async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await settle(page);
}

/** 화면에서 PIN 입력 → 들어가기 */
async function uiLogin(page) {
  await go(page, "/");
  const pin = page.getByLabel("PIN");
  await pin.waitFor({ timeout: 10000 });
  await pin.tap();
  await page.keyboard.type(PIN);
  await page.keyboard.press("Enter");
  await page.locator('nav[aria-label="탭"]').waitFor({ timeout: 10000 });
}

/** 칸에 손가락으로 누르고 지운 뒤 키보드로 친다 */
async function typeInto(page, locator, text) {
  await locator.tap();
  await locator.press("ControlOrMeta+a");
  await locator.press("Backspace");
  await page.keyboard.type(text);
}

/**
 * 한국어 IME 입력 (Chrome DevTools Protocol 의 진짜 조합 이벤트): 글자마다 자모를 하나씩 조합(compositionupdate)하다가 확정한다.
 * enter=true 면 마지막 글자를 조합하는 중에 Enter 를 누른다 — macOS/iPad 키보드처럼 "조합 중 Enter(isComposing=true, keyCode 229)
 * → 확정 → Enter 한 번 더" 가 순서대로 온다. 예전 태그 입력칸은 이때 마지막 글자가 다시 남아 태그가 하나 더 생겼다.
 */
async function imeType(page, locator, text, { enter = false } = {}) {
  await locator.tap();
  const cdp = await page.context().newCDPSession(page);
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!/[가-힣]/.test(ch)) {
      await page.keyboard.insertText(ch);
      continue;
    }
    let cur = "";
    for (const j of ch.normalize("NFD")) {
      cur = (cur + j).normalize("NFC");
      await cdp.send("Input.imeSetComposition", { text: cur, selectionStart: cur.length, selectionEnd: cur.length });
    }
    if (enter && i === chars.length - 1) await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send("Input.insertText", { text: ch });
  }
  await cdp.detach();
  if (enter) await page.keyboard.press("Enter"); // 확정 뒤의 진짜 Enter (keydown + keypress: 폼 제출도 일어남)
}

const expectText = async (page, label, text, what, timeout = 6000) =>
  page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => (fail(`[${label}] ${what}: "${text}" 가 보이지 않음 (${page.url()})`), false),
    );

const shot = (page, name) => page.screenshot({ path: join(OUT, `j-${name}.png`), fullPage: true }).catch(() => {});

/** 가짜 AI 상태 (키가 있는 것처럼) */
const AI_ON = {
  ai: { configured: true, model: "gemini-flash-latest" },
  tryon: { available: false, provider: null, model: null, reason: "꺼짐", setup_hint: null },
  shopping: { naver_enabled: false },
  shortcut: { configured: true },
};
async function aiOn(page) {
  await page.route("**/api/status", (r) => r.fulfill({ json: AI_ON }));
}

const step = async (label, fn) => {
  const before = failures.length;
  try {
    await fn();
  } catch (e) {
    fail(`[${label}] 실행 중 오류: ${e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" / ") : e}`);
  }
  if (failures.length === before) ok(`[${label}] 통과`);
};

/* ───────────── a. 첫 실행 → 첫 옷 ───────────── */

async function journeyFirstLaunch(browser, shopOk) {
  const label = "a-첫실행";
  const { context, page } = await phone(browser, label);
  await uiLogin(page);
  if (!(await page.evaluate(() => document.documentElement.dataset.theme === "dark"))) fail(`[${label}] 밤(시스템 다크)인데 앱이 다크가 아님`);
  await page.getByRole("link", { name: "옷장" }).first().tap();
  await expectText(page, label, "옷장이 비어 있어요", "빈 옷장 안내");
  await page.getByRole("link", { name: "첫 옷 등록하기" }).tap();
  await page.waitForURL(/\/closet\/new$/);
  await settle(page);
  // AI 키가 없으면 안내가 보이고, 사진만 올라간다
  await expectText(page, label, "AI", "AI 꺼짐 안내");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /사진 고르기/ }).tap()]);
  const analyzeCalls = [];
  page.on("request", (r) => r.url().includes("/api/items/analyze") && analyzeCalls.push(r.url()));
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/images") && r.status() === 201, { timeout: 15000 }), chooser.setFiles({ name: "shirt.png", mimeType: "image/png", buffer: png(300, 400, [235, 235, 230]) })]);
  await settle(page);
  if (analyzeCalls.length) fail(`[${label}] AI 키가 없는데 AI 분석을 불렀음`);
  const name = page.getByLabel("이름");
  await typeInto(page, name, "흰 옥스퍼드 셔츠 레귤러핏");
  await page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: "상의" }).tap();
  const price = page.getByLabel("구매 가격 (원)");
  await typeInto(page, price, "4만9천원 49000abc");
  const shown = await price.inputValue();
  // 숫자만 남는다: "49000 49000" → "4949000"? 사용자가 친 숫자 그대로(4,9,4,9,0,0,0) → 4,949,000
  if (!/^[\d,]+$/.test(shown)) fail(`[${label}] 가격 칸에 숫자가 아닌 글자가 남음: "${shown}"`);
  await typeInto(page, price, "49000");
  if ((await price.inputValue()) !== "49,000") fail(`[${label}] 가격 칸 표시가 "${await price.inputValue()}" (49,000 이어야 함)`);
  await typeInto(page, page.getByLabel("메모"), "출근할 때 자주 입는 셔츠, 다림질 필요");
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/items") && r.request().method() === "POST", { timeout: 10000 }),
    page.getByRole("button", { name: "옷장에 넣기" }).tap(),
  ]);
  const item = await created.json();
  if (created.status() !== 201) fail(`[${label}] 옷 등록 실패 ${created.status()} ${JSON.stringify(item)}`);
  if (item.name !== "흰 옥스퍼드 셔츠 레귤러핏" || item.purchase_price !== 49000 || item.category !== "top" || !item.image_key || item.notes !== "출근할 때 자주 입는 셔츠, 다림질 필요")
    fail(`[${label}] 서버에 저장된 값이 다름: ${JSON.stringify({ name: item.name, price: item.purchase_price, cat: item.category, img: item.image_key, notes: item.notes })}`);
  await page.waitForURL((u) => u.pathname === "/closet", { timeout: 5000 }).catch(() => fail(`[${label}] 등록 뒤 옷장으로 돌아가지 않음 (${page.url()})`));
  await expectText(page, label, "흰 옥스퍼드 셔츠 레귤러핏", "옷장 목록에 새 옷");
  await expectText(page, label, "1벌", "옷장 벌 수");

  // 쇼핑몰 링크로
  if (shopOk) {
    await page.getByRole("link", { name: "옷 등록" }).tap();
    await page.waitForURL(/\/closet\/new$/);
    const urlBox = page.getByPlaceholder("https://").first();
    await typeInto(page, urlBox, `${SHOP}/p/coat`);
    const [imp] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/items/import-url"), { timeout: 20000 }), page.getByRole("button", { name: "가져오기" }).tap()]);
    const p = await imp.json();
    if (imp.status() !== 200) fail(`[${label}] 링크 가져오기 실패 ${imp.status()} ${JSON.stringify(p)}`);
    await settle(page);
    const nameVal = await page.getByLabel("이름").inputValue();
    if (nameVal !== PRODUCTS.coat.name) fail(`[${label}] 링크로 가져온 이름이 "${nameVal}" (${PRODUCTS.coat.name} 이어야 함)`);
    if ((await page.getByLabel("브랜드").inputValue()) !== PRODUCTS.coat.brand) fail(`[${label}] 브랜드가 "${await page.getByLabel("브랜드").inputValue()}"`);
    if ((await page.getByLabel("구매 가격 (원)").inputValue()) !== "189,000") fail(`[${label}] 가격이 "${await page.getByLabel("구매 가격 (원)").inputValue()}"`);
    const outerPressed = await page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: "아우터" }).getAttribute("aria-pressed");
    if (outerPressed !== "true") fail(`[${label}] 카테고리가 아우터로 잡히지 않음 (aria-pressed=${outerPressed})`);
    if (!(await page.getByRole("img", { name: PRODUCTS.coat.name }).first().isVisible())) fail(`[${label}] 가져온 상품 사진이 보이지 않음`);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/items") && r.request().method() === "POST"),
      page.getByRole("button", { name: "옷장에 넣기" }).tap(),
    ]);
    const coat = await res.json();
    if (coat.original_shop_url !== `${SHOP}/p/coat` || coat.purchase_price !== 189000 || coat.category !== "outer") fail(`[${label}] 링크로 등록한 옷 값이 다름 ${JSON.stringify(coat)}`);
    await page.waitForURL((u) => u.pathname === "/closet");
    await expectText(page, label, PRODUCTS.coat.name, "옷장 목록에 링크로 넣은 옷");
    await expectText(page, label, "2벌", "옷장 벌 수");
  } else note(`[${label}] /etc/hosts 를 쓸 수 없어 쇼핑몰 링크 단계는 건너뜀`);
  await shot(page, "a-closet");
  await context.close();
}

/* ───────────── b. 옷 6벌 → 오늘 추천 → 저장 → 입기 → 어디서나 갱신 ───────────── */

async function seedCloset() {
  const defs = [
    ["차콜 와이드 슬랙스", "bottom", 59000, [60, 60, 70], 3],
    ["검정 더비 슈즈", "shoes", 120000, [30, 30, 30], 3],
    ["네이비 케이블 니트", "top", 69000, [30, 40, 90], 4],
    ["베이지 트렌치 코트", "outer", 239000, [200, 180, 140], 3],
    ["연청 스트레이트 데님", "bottom", 49000, [120, 150, 190], 2],
    ["흰 스니커즈", "shoes", 89000, [250, 250, 250], 2],
  ];
  const out = {};
  for (const [name, category, purchase_price, color, warmth] of defs) {
    const image_key = await upload(color);
    const it = await api("POST", "/items", { name, category, purchase_price, image_key, warmth, colors: ["기본"] });
    out[name] = it;
  }
  return out;
}

async function journeyTodayWear(browser, seeded) {
  const label = "b-오늘추천";
  const items = await api("GET", "/items");
  if (items.length < 6) fail(`[${label}] 옷이 ${items.length}벌 (6벌 이상이어야 함)`);
  const shirt = items.find((i) => i.name.startsWith("흰 옥스퍼드"));
  const slacks = seeded["차콜 와이드 슬랙스"];
  const coat = seeded["베이지 트렌치 코트"];
  const shoes = seeded["검정 더비 슈즈"];
  const ids = [shirt.id, slacks.id, coat.id, shoes.id];
  const { context, page } = await phone(browser, label);
  await context.addCookies([{ name: "clothe_session", value: (await sessionValue()), url: BASE }]);
  await aiOn(page);
  let todayBody = null;
  await page.route("**/api/stylist/today", async (r) => {
    todayBody = r.request().postDataJSON();
    await r.fulfill({
      json: {
        weather: { date: "2026-11-21", location_name: "서울", temp_min: 1, temp_max: 13, temp_now: 6, diurnal_range: 12, precip_probability: 10, weather_code: 1, description: "대체로 맑음" },
        briefing: "일교차가 12도예요. 아침엔 트렌치 코트를 걸치고 낮에는 벗어 들기 좋아요.",
        outfits: [
          { title: "레이어드 출근룩", item_ids: ids, reason: "탈착 가능한 아우터로 일교차 대비" },
          { title: "주말 데님룩", item_ids: [seeded["네이비 케이블 니트"].id, seeded["연청 스트레이트 데님"].id, seeded["흰 스니커즈"].id], reason: "편하게 많이 걷는 날" },
        ],
        dormant: [],
        profile_used: false,
      },
    });
  });
  await go(page, "/");
  const kw = page.getByLabel("오늘의 상황");
  await typeInto(page, kw, "한강 피크닉, 많이 걸어요");
  await page.getByRole("button", { name: "출근" }).tap();
  if ((await kw.inputValue()) !== "한강 피크닉, 많이 걸어요, 출근") fail(`[${label}] 상황 칩을 눌렀더니 입력이 "${await kw.inputValue()}"`);
  await page.getByRole("button", { name: "코디 추천받기" }).tap();
  await expectText(page, label, "레이어드 출근룩", "추천 결과");
  if (todayBody?.keywords !== "한강 피크닉, 많이 걸어요, 출근") fail(`[${label}] 서버로 보낸 상황이 "${todayBody?.keywords}"`);
  const card = cardOf(page.locator("section").filter({ has: page.getByRole("heading", { name: "오늘의 추천", exact: true }) }).last(), "레이어드 출근룩");
  const [saved] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/outfits") && r.request().method() === "POST"), card.getByRole("button", { name: "저장", exact: true }).tap()]);
  const outfit = await saved.json();
  if (!sameSet(outfit.item_ids, ids) || outfit.source !== "ai") fail(`[${label}] 저장한 코디가 다름 ${JSON.stringify(outfit)}`);
  if (!(await card.getByRole("button", { name: "저장됨" }).isVisible())) fail(`[${label}] 저장 버튼이 "저장됨"으로 바뀌지 않음`);
  const [worn] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/items/wear")), card.getByRole("button", { name: "오늘 입을래요" }).tap()]);
  const wr = await worn.json();
  if (wr.duplicate || wr.items?.length !== 4) fail(`[${label}] 착용 기록 응답 이상 ${JSON.stringify(wr).slice(0, 200)}`);
  await expectText(page, label, "오늘 입은 걸로 기록했어요", "착용 토스트");
  // 같은 코디를 저장한 코디 카드에서 또 입기 → 같은 날 같은 조합 = 횟수 그대로
  const savedCard = cardOf(page.locator("section").filter({ has: page.getByRole("heading", { name: "저장한 코디" }) }).last(), "레이어드 출근룩");
  await savedCard.getByRole("button", { name: "오늘 입을래요" }).tap();
  await expectText(page, label, "그날 같은 조합이 이미 기록돼 있어요", "같은 날 두 번 입기 안내");
  // 새로고침 없이: 옷장 카드 → 상세 게이지
  await page.locator('nav[aria-label="탭"]').getByRole("link", { name: "옷장" }).tap();
  await page.waitForURL((u) => u.pathname === "/closet");
  await page.getByRole("heading", { level: 1, name: "옷장" }).waitFor();
  await settle(page);
  const coatCard = page.locator(`a[href="/closet/${coat.id}"]`);
  const coatText = await coatCard.innerText();
  if (!coatText.includes("1회 착용") || !coatText.includes("회당 239,000원")) fail(`[${label}] 옷장 카드가 갱신되지 않음: ${coatText.replace(/\n/g, " ")}`);
  const shirtText = await page.locator(`a[href="/closet/${shirt.id}"]`).innerText();
  if (!shirtText.includes("1회 착용") || !shirtText.includes("회당 49,000원")) fail(`[${label}] 셔츠 카드: ${shirtText.replace(/\n/g, " ")}`);
  await coatCard.tap();
  await page.waitForURL(/\/closet\/[\w-]+$/);
  await settle(page);
  const gauge = page.getByRole("meter", { name: "뽕 뽑기 게이지" });
  if ((await gauge.getAttribute("aria-valuenow")) !== "1") fail(`[${label}] 게이지 값 ${await gauge.getAttribute("aria-valuenow")} (1이어야 함)`);
  await expectText(page, label, "29번 더 입으면 회당 7,967원", "게이지 문구 (239000/30 = 7966.67 → 7,967원)");
  // 상세에서 "오늘 입었어요" → 같은 날 이미 입음: 횟수 그대로(낙관적 +1 이 되돌아와야 함)
  await page.getByRole("button", { name: "오늘 입었어요" }).tap();
  await page.waitForResponse((r) => r.url().endsWith("/api/items/wear"));
  await settle(page);
  if ((await gauge.getAttribute("aria-valuenow")) !== "1") fail(`[${label}] 같은 날 다시 입었는데 게이지가 ${await gauge.getAttribute("aria-valuenow")}`);
  const server = (await api("GET", "/items")).find((i) => i.id === coat.id);
  if (server.wear_count !== 1 || !server.last_worn_date) fail(`[${label}] 서버 값 wear_count=${server.wear_count} last=${server.last_worn_date}`);
  await shot(page, "b-gauge");
  await context.close();
}

/** 제목(heading)이 있는 가장 가까운 카드: 그 제목을 담고 버튼이 있는 가장 안쪽 조상 */
const cardOf = (scope, title) => scope.getByRole("heading", { name: title }).first().locator("xpath=ancestor::*[.//button][1]");
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
async function sessionValue() {
  const { sessionCookie } = await import("./harness.mjs");
  return sessionCookie().split("=").slice(1).join("=");
}

/* ───────────── c. iOS 단축어 웹훅 ───────────── */

async function shortcut(body, headers = {}) {
  const res = await fetch(`${BASE}/api/webhook/shortcut`, { method: "POST", headers: { "x-shortcut-token": TOKEN, ...headers }, body });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function journeyShortcut(browser, shopOk) {
  const label = "c-단축어";
  const { context, page } = await phone(browser, label);
  await context.addCookies([{ name: "clothe_session", value: await sessionValue(), url: BASE }]);
  await go(page, "/closet");
  const before = (await api("GET", "/items")).length;
  // 토큰 없으면 401
  const bad = await fetch(`${BASE}/api/webhook/shortcut`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${SHOP}/p/knit` }) });
  if (bad.status !== 401) fail(`[${label}] 토큰 없이 ${bad.status} (401이어야 함)`);
  // 사진 → 옷장 (curl -F file=@photo.jpg -F target=closet -F note=...)
  const form = new FormData();
  form.append("file", new File([png(200, 260, [10, 120, 60])], "IMG_0001.png", { type: "image/png" }));
  form.append("target", "closet");
  form.append("note", "초록 반팔 티셔츠");
  const r1 = await shortcut(form);
  if (r1.status !== 200 || r1.data.type !== "item") fail(`[${label}] 사진→옷장 ${r1.status} ${JSON.stringify(r1.data)}`);
  // 사진 바이트 그대로 → 스크랩 (curl --data-binary @photo -H 'content-type: image/png')
  const r2 = await shortcut(png(120, 160, [200, 150, 100]), { "content-type": "image/png" });
  if (r2.status !== 200 || r2.data.type !== "inspiration") fail(`[${label}] 사진→스크랩 ${r2.status} ${JSON.stringify(r2.data)}`);
  if (shopOk) {
    // 쇼핑몰 링크 → 위시리스트 (본문이 링크 글자뿐인 공유 시트)
    const r3 = await shortcut(`이 니트 어때? ${SHOP}/p/knit`, { "content-type": "text/plain" });
    if (r3.status !== 200 || r3.data.type !== "wishlist") fail(`[${label}] 링크→위시리스트 ${r3.status} ${JSON.stringify(r3.data)}`);
    // 쇼핑몰 링크 → 옷장 (JSON)
    const r4 = await shortcut(JSON.stringify({ url: `${SHOP}/p/jeans`, target: "closet" }), { "content-type": "application/json" });
    if (r4.status !== 200 || r4.data.type !== "item") fail(`[${label}] 링크→옷장 ${r4.status} ${JSON.stringify(r4.data)}`);
    const jeans = (await api("GET", "/items")).find((i) => i.id === r4.data.id);
    if (!jeans || jeans.name !== PRODUCTS.jeans.name || jeans.purchase_price !== 79000 || jeans.category !== "bottom" || !jeans.image_key || jeans.brand !== "29CM")
      fail(`[${label}] 링크로 넣은 옷 값: ${JSON.stringify(jeans)}`);
    const wish = (await api("GET", "/wishlist")).find((w) => w.id === r3.data.id);
    if (!wish || wish.estimated_price !== 59900 || wish.category !== "top" || !wish.image_key) fail(`[${label}] 위시리스트 값: ${JSON.stringify(wish)}`);
  }
  const after = (await api("GET", "/items")).length;
  if (after !== before + (shopOk ? 2 : 1)) fail(`[${label}] 옷 수 ${before} → ${after}`);
  // 앱으로 잠깐(5초 넘게) 나갔다가 돌아오면 새로고침 없이 보인다
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(5300);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectText(page, label, "초록 반팔 티셔츠", "단축어로 넣은 옷이 앱으로 돌아오면 보임");
  if (shopOk) await expectText(page, label, PRODUCTS.jeans.name, "단축어 링크로 넣은 옷");
  const card = await page.getByRole("link", { name: /초록 반팔 티셔츠/ }).innerText().catch(() => "");
  if (!card.includes("초록 반팔 티셔츠")) fail(`[${label}] 카드 글자 ${card}`);
  await shot(page, "c-closet");
  await go(page, "/inspo");
  if ((await page.locator("main img").count()) < 1) fail(`[${label}] 스크랩에 단축어 사진이 보이지 않음`);
  await context.close();
}

/* ───────────── d. 스크랩 → 위시리스트 → 판독 → 링크 → 샀어요 ───────────── */

async function journeyScrapToCloset(browser) {
  const label = "d-스크랩";
  const items = await api("GET", "/items");
  const shirt = items.find((i) => i.name.startsWith("흰 옥스퍼드"));
  const slacks = items.find((i) => i.name === "차콜 와이드 슬랙스");
  const { context, page } = await phone(browser, label);
  await context.addCookies([{ name: "clothe_session", value: await sessionValue(), url: BASE }]);
  await aiOn(page);
  const analysis = {
    summary: "깔끔한 미니멀 캐주얼. 흰 셔츠에 니트 베스트를 겹쳐 입은 코디",
    pieces: [
      { category: "top", description: "흰 셔츠", colors: ["화이트"], matched_item_ids: [shirt.id], wishlist_id: null },
      { category: "top", description: "네이비 니트 베스트", colors: ["네이비"], matched_item_ids: [], wishlist_id: null },
      { category: "bag", description: "브라운 가죽 토트백", colors: ["브라운"], matched_item_ids: [], wishlist_id: null },
    ],
  };
  let analyzeCalls = 0;
  await page.route("**/api/inspirations/*/analyze*", async (r) => {
    analyzeCalls++;
    const id = r.request().url().match(/inspirations\/([\w-]+)\/analyze/)[1];
    // Gemini 를 부른 뒤 서버가 저장하는 것과 같은 상태로 (계약서: 분석 결과는 DB 에 저장)
    const db = d1();
    db.prepare("UPDATE inspirations SET analysis = ? WHERE id = ?").run(JSON.stringify(analysis), id);
    db.close();
    const insp = await api("GET", `/inspirations/${id}`);
    await r.fulfill({ json: insp });
  });
  await go(page, "/inspo");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /사진 추가|사진 올리기|사진 고르기/ }).first().tap()]);
  await chooser.setFiles({ name: "pin.png", mimeType: "image/png", buffer: png(300, 400, [180, 170, 160]) });
  await page.waitForURL(/\/inspo\/[\w-]+$/, { timeout: 15000 });
  await expectText(page, label, "깔끔한 미니멀 캐주얼", "자동 분석 결과");
  if (analyzeCalls !== 1) fail(`[${label}] 자동 분석 ${analyzeCalls}번 (1번이어야 함)`);
  const inspId = page.url().split("/").pop();
  await page.getByRole("button", { name: "옷장에 없는 2벌 모두 위시리스트에 담기" }).tap();
  await expectText(page, label, "옷장에 없는 2벌을 위시리스트에 담았어요", "모두 담기 토스트");
  const wishes = (await api("GET", "/wishlist")).filter((w) => w.reference_id === inspId);
  if (wishes.length !== 2) fail(`[${label}] 위시리스트에 ${wishes.length}벌 (2벌이어야 함)`);
  const vest = wishes.find((w) => w.name === "네이비 니트 베스트");
  if (!vest) return fail(`[${label}] "네이비 니트 베스트" 위시리스트 항목 없음 ${JSON.stringify(wishes.map((w) => w.name))}`);
  if ((await page.getByRole("link", { name: /위시리스트에 있어요/ }).count()) !== 2) fail(`[${label}] 담은 뒤 "위시리스트에 있어요" 링크가 2개가 아님`);
  // 다시 열어도 (서버 저장) 담긴 상태
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  if ((await page.getByRole("link", { name: /위시리스트에 있어요/ }).count()) !== 2) fail(`[${label}] 새로고침 뒤 담긴 표시가 사라짐`);
  if (analyzeCalls !== 1) fail(`[${label}] 새로고침했더니 분석을 다시 부름 (${analyzeCalls})`);

  // 위시리스트 → 판독 (가짜): 프로필 없음 → 컬러·체형 빼고 비율로
  const validation = {
    score: 60,
    label: "추천",
    verdict: "가지고 있는 흰 셔츠·슬랙스와 잘 어울려요. 비슷한 니트가 하나 있어요.",
    breakdown: {
      duplicate: { score: 22, max: 30, available: true, comment: "비슷한 니트가 1벌 있어요", similar: [{ item_id: items.find((i) => i.name === "네이비 케이블 니트").id, level: "similar" }] },
      synergy: { score: 20, max: 40, available: true, comment: "새 코디 2개", new_outfit_count: 2, outfits: [{ title: "니트 베스트 레이어드", item_ids: ["NEW", shirt.id, slacks.id], reason: "셔츠 위에 겹쳐 입기" }, { title: "주말 베스트룩", item_ids: ["NEW", shirt.id], reason: "가볍게" }] },
      personal_color: { score: null, max: 15, available: false, comment: "진단 전이에요 — 퍼스널 컬러 진단을 하면 점수에 반영돼요.", level: null },
      body_fit: { score: null, max: 15, available: false, comment: "진단 전이에요 — 체형 진단을 하면 점수에 반영돼요.", level: null },
    },
    validated_at: new Date().toISOString(),
    stale: false,
  };
  await page.route("**/api/wishlist/*/validate*", async (r) => {
    const db = d1();
    db.prepare("UPDATE wishlist SET validation = ?, validator_score = ?, validator_comment = ? WHERE id = ?").run(JSON.stringify(validation), 60, validation.verdict, vest.id);
    db.close();
    await r.fulfill({ json: { ...validation, cached: false } });
  });
  await page.getByRole("link", { name: /위시리스트에 있어요/ }).nth(0).tap();
  await page.waitForURL(new RegExp(`/wishlist/${vest.id}$`));
  await settle(page);
  await page.getByRole("button", { name: /판독/ }).first().tap();
  await expectText(page, label, "42 ÷ 70 × 100 ≈ 60점", "점수 계산식이 내역과 맞음");
  await expectText(page, label, "진단하지 않은 2개 항목", "빠진 항목 안내");
  if (!(await page.getByRole("img", { name: "구매 추천 점수 60점 (100점 만점)" }).isVisible())) fail(`[${label}] 점수 링이 60점이 아님`);
  const parts = await page.locator("ul").filter({ hasText: "매칭 시너지" }).innerText();
  if (!parts.includes("22") || !parts.includes("20")) fail(`[${label}] 점수 내역에 22·20 이 없음: ${parts.replace(/\n/g, " ")}`);

  // 이름·예상 가격 고치기 (칸을 벗어나지 않고 "샀어요"를 눌러도 저장)
  const nameBox = page.getByLabel("이름", { exact: true });
  await typeInto(page, nameBox, "네이비 울 니트 베스트");
  const priceBox = page.getByLabel("예상 가격 (원)");
  await typeInto(page, priceBox, "79,000원");
  await priceBox.blur();
  await page.waitForResponse((r) => r.url().endsWith(`/api/wishlist/${vest.id}`) && r.request().method() === "PATCH");
  await settle(page);
  let w = await api("GET", `/wishlist/${vest.id}`);
  if (w.name !== "네이비 울 니트 베스트" || w.estimated_price !== 79000) fail(`[${label}] 칸을 벗어난 뒤 서버 값 name=${w.name} price=${w.estimated_price}`);

  // 구매 링크: 검색 링크 찾기 + 직접 추가 (프롬프트 두 번, 한국어 이름)
  await page.getByRole("button", { name: /^찾기$|다시 찾기/ }).tap();
  await expectText(page, label, "무신사에서", "검색 링크");
  await page.getByRole("button", { name: "링크 직접 추가" }).tap();
  const dlg = page.getByRole("alertdialog");
  await dlg.getByRole("textbox").waitFor();
  await page.keyboard.type("musinsa.com/products/12345");
  await dlg.getByRole("button", { name: "다음" }).tap();
  await page.getByRole("alertdialog").getByRole("textbox").waitFor();
  const titleBox = page.getByRole("alertdialog").getByRole("textbox");
  if ((await titleBox.inputValue()) !== "musinsa.com") fail(`[${label}] 링크 이름 기본값 "${await titleBox.inputValue()}"`);
  await titleBox.press("ControlOrMeta+a");
  await page.keyboard.type("무신사 단독 할인 링크");
  await page.keyboard.press("Enter");
  await expectText(page, label, "링크를 저장했어요", "직접 링크 저장");
  w = await api("GET", `/wishlist/${vest.id}`);
  const custom = w.recommended_links.find((l) => l.source === "custom");
  if (!custom || custom.title !== "무신사 단독 할인 링크" || custom.url !== "https://musinsa.com/products/12345") fail(`[${label}] 직접 추가 링크 ${JSON.stringify(custom)}`);
  if (!w.validation || w.validation.score !== 60) fail(`[${label}] 판독 결과가 서버에 없음`);

  // 샀어요 → 가격 묻기 → 옷장으로
  await page.getByRole("button", { name: "샀어요" }).tap();
  const priceIn = page.getByRole("alertdialog").getByRole("textbox");
  await priceIn.waitFor();
  if ((await priceIn.inputValue()) !== "79000") fail(`[${label}] 산 가격 기본값 "${await priceIn.inputValue()}"`);
  await priceIn.press("ControlOrMeta+a");
  await page.keyboard.type("71,100원");
  const [bought] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/bought")), page.getByRole("alertdialog").getByRole("button", { name: "옷장으로" }).tap()]);
  const { item_id } = await bought.json();
  await page.waitForURL(new RegExp(`/closet/${item_id}$`), { timeout: 10000 });
  await settle(page);
  const item = (await api("GET", "/items")).find((i) => i.id === item_id);
  if (!item || item.purchase_price !== 71100 || item.name !== "네이비 울 니트 베스트" || item.category !== "top") fail(`[${label}] 옷장에 들어간 옷 ${JSON.stringify(item)}`);
  if ((await page.getByLabel("구매 가격 (원)").inputValue()) !== "71,100") fail(`[${label}] 옷 화면의 가격 "${await page.getByLabel("구매 가격 (원)").inputValue()}"`);
  w = await api("GET", `/wishlist/${vest.id}`);
  if (w.status !== "bought" || w.bought_item_id !== item_id) fail(`[${label}] 위시리스트 상태 ${w.status} ${w.bought_item_id}`);
  await go(page, "/wishlist");
  await shot(page, "d-wishlist");
  await go(page, `/wishlist/${vest.id}`);
  if (!(await page.getByRole("link", { name: "옷장에서 보기" }).isVisible())) fail(`[${label}] 산 위시리스트에 "옷장에서 보기"가 없음`);
  await expectText(page, label, "샀어요", "상태 표시");
  await context.close();
}

/* ───────────── e. OOTD 셀카 → 확인 → 달력 → 날짜 고치기 → 지우기 ───────────── */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

async function journeyOotd(browser) {
  const label = "e-OOTD";
  const all = await api("GET", "/items");
  const pick = (n) => all.find((i) => i.name.startsWith(n));
  const A = pick("흰 옥스퍼드"); // 오늘 이미 입음
  const B = pick("네이비 케이블 니트");
  const C = pick("흰 스니커즈");
  const before = Object.fromEntries([A, B, C].map((i) => [i.id, { wear_count: i.wear_count, last_worn_date: i.last_worn_date }]));
  const today = kstToday();
  const yesterday = kstAdd(today, -1);
  const { context, page } = await phone(browser, label);
  await context.addCookies([{ name: "clothe_session", value: await sessionValue(), url: BASE }]);
  await aiOn(page);
  await page.route("**/api/ootd/analyze", async (r) => {
    const { image_key } = r.request().postDataJSON();
    await r.fulfill({
      json: {
        image_key,
        summary: "흰 셔츠에 네이비 니트를 어깨에 두르고 흰 스니커즈",
        pieces: [
          { category: "top", description: "흰 셔츠", candidates: [{ item_id: A.id, confidence: 0.92 }] },
          { category: "top", description: "네이비 니트", candidates: [{ item_id: B.id, confidence: 0.81 }] },
          { category: "shoes", description: "흰 운동화", candidates: [{ item_id: C.id, confidence: 0.4 }] },
        ],
        suggested_item_ids: [A.id, B.id],
        verified: false,
        analyzed_at: new Date().toISOString(),
        cached: false,
      },
    });
  });
  await go(page, "/outfits/ootd");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /사진 고르기/ }).tap()]);
  await chooser.setFiles({ name: "mirror.png", mimeType: "image/png", buffer: png(300, 500, [90, 90, 100]) });
  await expectText(page, label, "흰 셔츠에 네이비 니트", "셀카 분석 결과", 15000);
  const tileC = page.getByRole("button", { name: `${C.name}, 확신 40%` });
  if ((await tileC.getAttribute("aria-pressed")) !== "false") fail(`[${label}] 확신 낮은 후보가 미리 골라져 있음`);
  await tileC.tap();
  await page.getByLabel("날짜").fill(yesterday);
  await page.getByRole("radiogroup", { name: "만족도" }).getByRole("radio", { name: "4점" }).tap();
  await page.getByRole("button", { name: "데이트" }).tap();
  const tagBox = page.getByLabel("상황 직접 입력");
  await imeType(page, tagBox, "한강 산책", { enter: true });
  await settle(page);
  if ((await tagBox.inputValue()) !== "") fail(`[${label}] 태그를 Enter 로 넣은 뒤 입력칸에 "${await tagBox.inputValue()}" 가 남음 (한글 조합 Enter)`);
  await imeType(page, page.getByLabel("메모"), "생각보다 추웠어요 내일은 코트");
  await page.getByLabel("메모").blur();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/logs") && r.request().method() === "POST"), page.getByRole("button", { name: "3벌 착용 기록하기" }).tap()]);
  const log = await res.json();
  if (res.status() !== 201 && res.status() !== 200) fail(`[${label}] 기록 저장 ${res.status()} ${JSON.stringify(log)}`);
  if (log.worn_date !== yesterday || !sameSet(log.item_ids, [A.id, B.id, C.id]) || log.rating !== 4 || !log.selfie_key) fail(`[${label}] 저장된 기록 ${JSON.stringify(log)}`);
  if (JSON.stringify(log.occasion_tags) !== JSON.stringify(["데이트", "한강 산책"])) fail(`[${label}] 상황 태그 ${JSON.stringify(log.occasion_tags)} (["데이트","한강 산책"] 이어야 함)`);
  if (log.note !== "생각보다 추웠어요 내일은 코트") fail(`[${label}] 메모 "${log.note}"`);
  const after1 = Object.fromEntries((await api("GET", "/items")).map((i) => [i.id, i]));
  const expect = (id, count, last, when) => {
    const it = after1[id] ?? null;
    if (!it || it.wear_count !== count || it.last_worn_date !== last) fail(`[${label}] ${when}: ${it?.name} wear_count=${it?.wear_count} last=${it?.last_worn_date} (기대 ${count}, ${last})`);
  };
  expect(A.id, before[A.id].wear_count + 1, today, "어제 기록 추가");
  expect(B.id, before[B.id].wear_count + 1, yesterday, "어제 기록 추가");
  expect(C.id, before[C.id].wear_count + 1, yesterday, "어제 기록 추가");
  // 달력으로 이동, 그 날짜가 선택됨
  await page.waitForURL(/\/outfits\/calendar\?month=.*&day=/, { timeout: 10000 });
  await settle(page);
  await expectText(page, label, "생각보다 추웠어요 내일은 코트", "달력 기록 메모");
  // 옷 화면(새로고침 없이)에서도 횟수 반영
  // 날짜 고치기: 어제 → 오늘 (셔츠는 오늘 이미 다른 기록이 있어서 하루 한 번 규칙으로 -1)
  await page.getByRole("button", { name: "기록 고치기" }).first().tap();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await sheet.getByLabel("날짜").fill(today);
  const memo = sheet.getByLabel("메모");
  await typeInto(page, memo, "날짜를 오늘로 고침, 메모도 수정");
  await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/logs/${log.id}`) && r.request().method() === "PATCH"), sheet.getByRole("button", { name: /저장/ }).tap()]);
  await settle(page);
  const after2 = Object.fromEntries((await api("GET", "/items")).map((i) => [i.id, i]));
  Object.assign(after1, after2);
  expect(A.id, before[A.id].wear_count, today, "날짜를 오늘로 고침");
  expect(B.id, before[B.id].wear_count + 1, today, "날짜를 오늘로 고침");
  expect(C.id, before[C.id].wear_count + 1, today, "날짜를 오늘로 고침");
  const edited = (await api("GET", `/logs?month=${today.slice(0, 7)}`)).find((l) => l.id === log.id);
  if (!edited || edited.note !== "날짜를 오늘로 고침, 메모도 수정" || edited.worn_date !== today) fail(`[${label}] 고친 기록 ${JSON.stringify(edited)}`);
  // 옷장 카드가 새로고침 없이 바뀌었는지
  await page.locator('nav[aria-label="탭"]').getByRole("link", { name: "옷장" }).tap();
  await page.getByRole("heading", { level: 1, name: "옷장" }).waitFor();
  await settle(page);
  const cardB = await page.locator(`a[href="/closet/${B.id}"]`).innerText();
  if (!cardB.includes(`${before[B.id].wear_count + 1}회 착용`)) fail(`[${label}] 옷장 카드(니트)가 갱신되지 않음: ${cardB.replace(/\n/g, " ")}`);
  // 지우기 → 원래대로
  await go(page, `/outfits/calendar?month=${today.slice(0, 7)}&day=${today}`);
  const rows = page.getByRole("button", { name: "기록 지우기" });
  const n = await rows.count();
  let deleted = false;
  for (let i = 0; i < n && !deleted; i++) {
    const row = rows.nth(i).locator("xpath=ancestor::*[.//img or .//p][1]");
    if (!(await row.innerText()).includes("날짜를 오늘로 고침")) continue;
    await rows.nth(i).tap();
    await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/logs/${log.id}`) && r.request().method() === "DELETE"), page.getByRole("alertdialog").getByRole("button", { name: "삭제" }).tap()]);
    deleted = true;
  }
  if (!deleted) {
    // 이 날짜의 기록이 하나면 위 찾기 없이 첫 번째
    await rows.last().tap();
    await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/logs/`) && r.request().method() === "DELETE"), page.getByRole("alertdialog").getByRole("button", { name: "삭제" }).tap()]);
  }
  await settle(page);
  const after3 = Object.fromEntries((await api("GET", "/items")).map((i) => [i.id, i]));
  Object.assign(after1, after3);
  for (const it of [A, B, C]) expect(it.id, before[it.id].wear_count, before[it.id].last_worn_date, "기록 삭제 뒤 원래대로");
  if ((await api("GET", `/logs?month=${today.slice(0, 7)}`)).some((l) => l.id === log.id)) fail(`[${label}] 지운 기록이 남아 있음`);
  await shot(page, "e-calendar");
  await context.close();
}

/* ───────────── f. 여행 → 계획 → 체크리스트 → 다시 계획 ───────────── */

async function journeyTrip(browser) {
  const label = "f-여행";
  const items = await api("GET", "/items");
  const byName = (n) => items.find((i) => i.name.startsWith(n));
  const capsule1 = [byName("흰 옥스퍼드"), byName("차콜 와이드"), byName("베이지 트렌치"), byName("흰 스니커즈")];
  const capsule2 = [...capsule1, byName("네이비 케이블 니트")];
  const { context, page } = await phone(browser, label);
  await context.addCookies([{ name: "clothe_session", value: await sessionValue(), url: BASE }]);
  await aiOn(page);
  let planCalls = 0;
  let planDelay = 0;
  // 서버가 Gemini 결과로 계획을 저장하는 것과 같은 상태로: 계획 + 체크리스트(이전 챙김 표시·직접 추가한 준비물 유지)
  await page.route("**/api/trips/*/plan*", async (r) => {
    planCalls++;
    const id = r.request().url().match(/trips\/([\w-]+)\/plan/)[1];
    if (planDelay) await new Promise((w) => setTimeout(w, planDelay));
    const trip = await api("GET", `/trips/${id}`);
    const caps = planCalls === 1 ? capsule1 : capsule2;
    const dates = [];
    for (let d = trip.start_date; d <= trip.end_date; d = kstAdd(d, 1)) dates.push(d);
    const plan = {
      summary: "많이 걷는 일정이라 편한 신발 위주로, 상·하의를 돌려 입어요.",
      capsule_item_ids: caps.map((i) => i.id),
      days: dates.map((date, i) => ({ day: i + 1, date, item_ids: i % 2 ? [caps[0].id, caps[1].id, caps[3].id] : [caps[0].id, caps[1].id, caps[2].id], note: i ? "" : "도착일" })),
      tips: ["트렌치는 비행기에서 입고 타기"],
      weather: { status: "unavailable", message: "여행 날짜가 일기예보 범위(오늘부터 약 2주) 밖이라 예보가 없어요. 계절과 메모를 기준으로 계획했어요.", location_name: "도쿄, 일본", days: [] },
      generated_at: new Date().toISOString(),
    };
    const prevItems = new Map(trip.checklist.filter((e) => e.kind === "item").map((e) => [e.item_id, e]));
    const checklist = [
      ...caps.map((i) => prevItems.get(i.id) ?? { id: crypto.randomUUID(), kind: "item", item_id: i.id, label: i.name, packed: false, source: "plan" }),
      ...trip.checklist.filter((e) => e.kind === "extra"),
    ];
    if (!checklist.some((e) => e.label === "여권")) checklist.push({ id: crypto.randomUUID(), kind: "extra", item_id: null, label: "여권", packed: false, source: "ai" });
    const db = d1();
    db.prepare("UPDATE trips SET plan = ?, checklist = ? WHERE id = ?").run(JSON.stringify(plan), JSON.stringify(checklist), id);
    db.close();
    await r.fulfill({ json: { ...(await api("GET", `/trips/${id}`)), cached: false } });
  });
  await go(page, "/travel");
  await page.getByRole("button", { name: "여행 추가", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "새 여행" });
  await sheet.waitFor();
  await imeType(page, sheet.getByLabel("여행지"), "도쿄 시부야");
  const start = kstAdd(kstToday(), 40);
  const end = kstAdd(start, 3);
  await sheet.getByLabel("출발").fill(start);
  await sheet.getByLabel("돌아오는 날").fill(end);
  await expectText(page, label, "3박 4일", "기간 표시");
  await sheet.getByRole("button", { name: "하루 2만 보 걷기" }).tap();
  const notes = sheet.getByLabel("일정 메모", { exact: true }).last();
  await notes.tap();
  await page.keyboard.press("End");
  await imeType(page, notes, ", 둘째 날 결혼식");
  const [created] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/trips") && r.request().method() === "POST"), sheet.getByRole("button", { name: "여행 만들기" }).tap()]);
  const trip = await created.json();
  if (trip.destination !== "도쿄 시부야" || trip.notes !== "하루 2만 보 걷기, 둘째 날 결혼식" || trip.start_date !== start || trip.end_date !== end) fail(`[${label}] 만든 여행 ${JSON.stringify({ d: trip.destination, n: trip.notes, s: trip.start_date, e: trip.end_date })}`);
  if (!page.url().includes(`/travel/${trip.id}`)) await go(page, `/travel/${trip.id}`);
  await page.getByRole("button", { name: "계획 만들기" }).tap();
  await expectText(page, label, "많이 걷는 일정이라", "계획 요약");
  await expectText(page, label, "예보가 없어요", "예보 범위 밖 안내");
  const boxes = page.getByRole("checkbox");
  if ((await boxes.count()) !== 5) fail(`[${label}] 체크리스트 ${await boxes.count()}개 (옷 4 + 여권 = 5)`);
  // 빠르게 연달아 세 개 체크 (기다리지 않음)
  const names = [capsule1[0].name, capsule1[1].name, "여권"];
  for (const n of names) await page.getByRole("checkbox", { name: new RegExp(`^${n}`) }).tap({ noWaitAfter: true });
  await page.waitForTimeout(1500);
  await settle(page);
  let server = await api("GET", `/trips/${trip.id}`);
  const packedNames = server.checklist.filter((e) => e.packed).map((e) => e.label).sort();
  if (JSON.stringify(packedNames) !== JSON.stringify([...names].sort())) fail(`[${label}] 연달아 체크한 뒤 서버의 챙김 ${JSON.stringify(packedNames)}`);
  for (const n of names) if ((await page.getByRole("checkbox", { name: new RegExp(`^${n}`) }).getAttribute("aria-checked")) !== "true") fail(`[${label}] 화면에서 "${n}" 체크가 풀림`);
  // 직접 추가 (한글 조합 중 Enter)
  const add = page.getByLabel("준비물 추가");
  await imeType(page, add, "보조 배터리", { enter: true });
  await page.waitForResponse((r) => r.url().endsWith(`/api/trips/${trip.id}/checklist`) && r.request().method() === "POST").catch(() => {});
  await settle(page);
  server = await api("GET", `/trips/${trip.id}`);
  const userExtras = server.checklist.filter((e) => e.source === "user").map((e) => e.label);
  if (JSON.stringify(userExtras) !== JSON.stringify(["보조 배터리"])) fail(`[${label}] 직접 추가한 준비물 ${JSON.stringify(userExtras)}`);
  if ((await add.inputValue()) !== "") fail(`[${label}] 추가 뒤 입력칸에 "${await add.inputValue()}" 가 남음`);
  await page.getByRole("checkbox", { name: /^보조 배터리/ }).tap();
  await page.waitForResponse((r) => r.url().includes("/checklist/") && r.request().method() === "PATCH");
  // 다시 계획: 계획하는 동안 하나 더 체크
  planDelay = 1500;
  await page.getByRole("button", { name: "최신 예보로 다시 계획" }).tap();
  await page.getByRole("alertdialog").getByRole("button", { name: "다시 만들기" }).tap();
  await page.waitForTimeout(300);
  await page.getByRole("checkbox", { name: new RegExp(`^${capsule1[3].name}`) }).tap();
  await expectText(page, label, "계획을 새로 만들었어요", "다시 계획 토스트", 10000);
  await settle(page);
  server = await api("GET", `/trips/${trip.id}`);
  const want = [...names, "보조 배터리", capsule1[3].name].sort();
  const got = server.checklist.filter((e) => e.packed).map((e) => e.label).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`[${label}] 다시 계획한 뒤 챙김 ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`);
  if (!server.checklist.some((e) => e.label === capsule2[4].name && !e.packed)) fail(`[${label}] 새 계획의 옷(니트)이 체크리스트에 없음`);
  for (const n of want) if ((await page.getByRole("checkbox", { name: new RegExp(`^${n}`) }).getAttribute("aria-checked")) !== "true") fail(`[${label}] 다시 계획한 뒤 화면에서 "${n}" 체크가 풀림`);
  const progress = page.getByRole("progressbar", { name: "짐 챙긴 정도" });
  if ((await progress.getAttribute("aria-valuenow")) !== "5" || (await progress.getAttribute("aria-valuemax")) !== "7") fail(`[${label}] 진행 막대 ${await progress.getAttribute("aria-valuenow")}/${await progress.getAttribute("aria-valuemax")} (5/7)`);
  // 모두 챙김 → 모두 해제
  await page.getByRole("button", { name: "모두 챙김" }).tap();
  await page.waitForResponse((r) => r.url().endsWith(`/checklist`) && r.request().method() === "PUT");
  server = await api("GET", `/trips/${trip.id}`);
  if (!server.checklist.every((e) => e.packed)) fail(`[${label}] 모두 챙김이 서버에 반영되지 않음`);
  await shot(page, "f-trip");
  await context.close();
}

/* ───────────── g. 프로필 → 퍼스널 컬러(화이트밸런스·색 찍기) → 체형 ───────────── */

async function journeyProfile(browser) {
  const label = "g-프로필";
  const { context, page } = await phone(browser, label);
  await context.addCookies([{ name: "clothe_session", value: await sessionValue(), url: BASE }]);
  await aiOn(page);
  await go(page, "/profile");
  const h = page.getByLabel("키 (cm)");
  const w = page.getByLabel("몸무게 (kg)");
  // 이상한 글자는 거절 (저장 안 함, 안내)
  await typeInto(page, h, "백칠십");
  await w.tap();
  await expectText(page, label, "숫자로 입력해 주세요", "키에 글자를 넣으면 안내");
  if ((await api("GET", "/profile")).height_cm !== null) fail(`[${label}] 글자를 넣었는데 키가 저장됨`);
  await typeInto(page, h, "170.5");
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/profile") && r.request().method() === "PATCH"), w.tap()]);
  // 몸무게: 칸을 벗어나지 않고 다른 화면으로 (iOS 는 버튼을 눌러도 입력칸 blur 가 안 올 수 있다 → 화면이 사라질 때 저장)
  await typeInto(page, w, "62,5");
  const patched = page.waitForResponse((r) => r.url().endsWith("/api/profile") && r.request().method() === "PATCH", { timeout: 5000 }).catch(() => null);
  await page.evaluate(() => {
    history.pushState({}, "", "/closet");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await patched;
  await settle(page);
  let prof = await api("GET", "/profile");
  if (prof.height_cm !== 170.5) fail(`[${label}] 키 ${prof.height_cm} (170.5)`);
  if (prof.weight_kg !== 62.5) fail(`[${label}] 칸을 벗어나지 않고 화면을 떠났더니 몸무게가 저장되지 않음 (${prof.weight_kg})`);
  await go(page, "/profile");
  // 입력하다가 홈 화면으로 나가기(앱이 백그라운드로): blur 없이도 저장돼야 한다 (iOS 는 백그라운드 앱을 언제든 종료)
  await typeInto(page, page.getByLabel("몸무게 (kg)"), "63");
  const bg = page.waitForResponse((r) => r.url().endsWith("/api/profile") && r.request().method() === "PATCH", { timeout: 4000 }).catch(() => null);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  if (!(await bg)) fail(`[${label}] 입력 중 앱을 나갔는데 몸무게를 저장하지 않음`);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  if ((await api("GET", "/profile")).weight_kg !== 63) fail(`[${label}] 백그라운드 저장 뒤 몸무게 ${(await api("GET", "/profile")).weight_kg}`);
  await typeInto(page, page.getByLabel("몸무게 (kg)"), "62.5");
  await page.getByLabel("키 (cm)").tap();
  await page.waitForResponse((r) => r.url().endsWith("/api/profile") && r.request().method() === "PATCH");
  await go(page, "/profile");
  if ((await page.getByLabel("키 (cm)").inputValue()) !== "170.5" || (await page.getByLabel("몸무게 (kg)").inputValue()) !== "62.5") fail(`[${label}] 다시 열었을 때 키/몸무게 표시가 다름`);

  // 퍼스널 컬러: 노란 조명 사진 → 자동(그레이 월드) → 흰색 기준점 → 피부·머리·눈 찍기 → 진단(가짜)
  let colorBody = null;
  await page.route("**/api/profile/analyze-color", async (r) => {
    colorBody = r.request().postDataJSON();
    const analysis = {
      season: "autumn", sub_tone: "뮤트", label: "가을 웜 뮤트", undertone: "warm", summary: "차분하고 부드러운 웜톤이에요.",
      skin_hex: colorBody.samples?.skin ?? null, hair_hex: colorBody.samples?.hair ?? null, eye_hex: colorBody.samples?.eye ?? null, hex_source: "client",
      best_colors: [{ hex: "#8B6B4A", name: "카멜" }, { hex: "#6B7B4A", name: "올리브" }], worst_colors: [{ hex: "#FF00AA", name: "형광 핑크" }],
      tips: ["채도가 낮은 흙빛 색"], confidence: "medium", caveat: "사진 한 장 기준이에요.", image_key: colorBody.image_key, analyzed_at: new Date().toISOString(),
    };
    const db = d1();
    db.prepare("INSERT INTO profile (id, color_analysis, face_image_key) VALUES ('me', ?, ?) ON CONFLICT(id) DO UPDATE SET color_analysis = excluded.color_analysis, face_image_key = excluded.face_image_key").run(JSON.stringify(analysis), colorBody.image_key);
    db.close();
    await r.fulfill({ json: await api("GET", "/profile") });
  });
  await page.getByRole("link", { name: /진단|퍼스널 컬러/ }).first().tap();
  await page.waitForURL(/\/profile\/color$/);
  // 노란 조명: 위쪽 흰 벽(255,240,200), 가운데 얼굴(220,170,120), 아래 머리(60,45,30)
  const W = 200, H = 260;
  const face = (() => {
    const rows = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rows.push(y < 60 ? [255, 240, 200] : y > 200 ? [60, 45, 30] : x > 90 && x < 110 && y > 120 && y < 130 ? [70, 50, 40] : [220, 170, 120]);
    return rows;
  })();
  const buf = await page.evaluate(({ px, W, H }) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(W, H);
    px.forEach((p, i) => img.data.set([...p, 255], i * 4));
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  }, { px: face, W, H });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /사진 고르기/ }).tap()]);
  await chooser.setFiles({ name: "face.png", mimeType: "image/png", buffer: Buffer.from(buf, "base64") });
  const app = page.getByRole("application");
  await app.waitFor({ timeout: 10000 });
  const gainsAuto = await page.getByText(/^R×/).innerText();
  if (!/B×1\.[1-9]/.test(gainsAuto)) fail(`[${label}] 노란 사진인데 자동 보정에서 파랑을 올리지 않음 (${gainsAuto})`);
  await page.getByRole("radio", { name: "흰색 기준" }).tap();
  await expectText(page, label, "사진에서 흰색이었던 곳을 눌러 주세요", "흰색 기준 안내");
  const box = await app.boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  let p = at(0.5, 0.1);
  await page.touchscreen.tap(p.x, p.y);
  const gainsWhite = await page.getByText(/^R×/).innerText();
  // 흰 벽(255,240,200) 을 흰색으로: B 이득이 가장 크다
  const g = gainsWhite.match(/R×([\d.]+) G×([\d.]+) B×([\d.]+)/).slice(1).map(Number);
  if (!(g[2] > g[1] && g[1] >= g[0])) fail(`[${label}] 흰색 기준점 보정값이 이상함 (${gainsWhite})`);
  // 피부 → (자동으로 머리로) → 눈
  p = at(0.3, 0.6);
  await page.touchscreen.tap(p.x, p.y);
  p = at(0.5, 0.9);
  await page.touchscreen.tap(p.x, p.y);
  p = at(0.5, 0.48);
  await page.touchscreen.tap(p.x, p.y);
  const chips = await page.getByRole("radiogroup", { name: "찍을 부위" }).innerText();
  const hexes = chips.match(/#[0-9A-F]{6}/gi) ?? [];
  if (hexes.length !== 3) fail(`[${label}] 찍은 색이 3개가 아님: ${chips.replace(/\n/g, " ")}`);
  // 키보드: 화살표로 옮기면 위치와 색을 화면 읽기 프로그램에 알려 준다
  await page.getByRole("radio", { name: /피부/ }).tap();
  await app.focus();
  const announce = page.getByTestId("tap-announce");
  const a0 = await announce.innerText();
  await page.keyboard.press("ArrowRight");
  const a1 = await announce.innerText();
  if (!/^피부 위치 가로 31%, 세로 60%, 색 #[0-9A-F]{6}$/i.test(a1) || a1 === a0) fail(`[${label}] 화살표로 옮겼을 때 알림 "${a0}" → "${a1}"`);
  if ((await announce.getAttribute("aria-live")) !== "polite") fail(`[${label}] 색 찍기 알림이 aria-live 가 아님`);
  await page.getByRole("button", { name: "이 색으로 진단하기" }).tap();
  await page.waitForURL(/\/profile$/, { timeout: 15000 });
  if (!colorBody?.image_key || Object.keys(colorBody.samples ?? {}).sort().join() !== "eye,hair,skin") fail(`[${label}] 진단 요청에 찍은 색이 없음 ${JSON.stringify(colorBody)}`);
  else if (!Object.values(colorBody.samples).every((x) => /^#[0-9A-F]{6}$/i.test(x))) fail(`[${label}] 찍은 색 형식 ${JSON.stringify(colorBody.samples)}`);
  await expectText(page, label, "가을 웜 뮤트", "진단 결과 표시");
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  await expectText(page, label, "가을 웜 뮤트", "새로고침 뒤에도 진단 결과");

  // 체형: 전신 사진 → 진단(가짜)
  let bodyCalls = 0;
  await page.route("**/api/profile/analyze-body", async (r) => {
    bodyCalls++;
    const { image_key } = r.request().postDataJSON();
    const analysis = { body_type: "wave", body_type_label: "웨이브", proportions: "하체 쪽에 무게감", features: ["어깨가 얇음"], fit_tips: ["허리를 높게 잡는 하이웨이스트"], avoid: ["박시한 롱 기장"], confidence: "medium", caveat: "자세에 따라 달라요.", image_key, analyzed_at: new Date().toISOString() };
    const db = d1();
    db.prepare("UPDATE profile SET body_analysis = ?, body_image_key = ? WHERE id = 'me'").run(JSON.stringify(analysis), image_key);
    db.close();
    await r.fulfill({ json: await api("GET", "/profile") });
  });
  const [ch2] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "전신 사진 추가" }).tap()]);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/profile") && r.request().method() === "PATCH", { timeout: 15000 }), ch2.setFiles({ name: "body.png", mimeType: "image/png", buffer: png(200, 400, [200, 190, 180]) })]);
  await settle(page);
  await page.getByRole("button", { name: "진단하기" }).tap();
  await expectText(page, label, "하이웨이스트", "체형 진단 핏 가이드");
  prof = await api("GET", "/profile");
  if (prof.body_type !== "wave" || bodyCalls !== 1 || prof.mannequin_images.length !== 1) fail(`[${label}] 체형 결과 ${prof.body_type} 호출 ${bodyCalls} 전신 ${prof.mannequin_images.length}`);
  await shot(page, "g-profile");
  await context.close();
}

/* ───────────── 실행 ───────────── */

let server;
let browser;
let shop;
try {
  console.log(`E2E 여정: 격리 상태 ${TMP}`);
  const shopOk = ensureHosts();
  shop = await startShop();
  server = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
  await step("a-첫실행", () => journeyFirstLaunch(browser, shopOk));
  await apiLogin();
  const seeded = await seedCloset();
  if (!process.env.J || process.env.J.includes("b")) await step("b-오늘추천", () => journeyTodayWear(browser, seeded));
  if (!process.env.J || process.env.J.includes("c")) await step("c-단축어", () => journeyShortcut(browser, shopOk));
  if (!process.env.J || process.env.J.includes("d")) await step("d-스크랩", () => journeyScrapToCloset(browser));
  if (!process.env.J || process.env.J.includes("e")) await step("e-OOTD", () => journeyOotd(browser));
  if (!process.env.J || process.env.J.includes("f")) await step("f-여행", () => journeyTrip(browser));
  if (!process.env.J || process.env.J.includes("g")) await step("g-프로필", () => journeyProfile(browser));
} catch (e) {
  fail(`실행 중 오류: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  shop?.close();
  restoreHosts();
  console.log(`스크린숏: ${OUT}`);
  cleanup();
}

if (failures.length) {
  console.error(`\nE2E 여정 실패 ${failures.length}건`);
  process.exit(1);
}
console.log("\nE2E 여정 통과");
process.exit(0);
