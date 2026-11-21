#!/usr/bin/env node
/**
 * 끝에서 끝까지(E2E) 연기 테스트. `npm run e2e` 로 실행한다 (`npm test` 에는 포함되지 않음). 공용 도구는 harness.mjs.
 *
 * 하는 일:
 *  1. 저장소 밖 임시 폴더에 격리된 wrangler 설정·.dev.vars(PIN 1234, Gemini 키 없음)·D1/R2 상태를 만들고
 *     Vite 개발 서버를 포트 5184(E2E_PORT)에 띄운다. 저장소 안에는 아무 파일도 만들지 않는다.
 *  2. API로 옷·코디·스크랩·위시리스트·여행·착용 기록·프로필 사진을 넣는다.
 *  3. 390×844(모바일)·820×1180(iPad 세로)·1440×900(데스크톱)을 라이트·다크 테마로 모든 화면을 열어 본다.
 *     콘솔 오류, 페이지 오류, 5xx 응답, 가로 넘침, h1 개수, 이름 없는 컨트롤, alt 없는 이미지,
 *     axe-core(WCAG 2.1 AA) serious/critical 위반이 하나라도 있으면 실패. 라이트 테마에서는 내비게이션도 눌러 본다.
 *  4. 흐름: 콜라주 → 코디로 저장(대표 그림), 구매 링크 다시 찾기(직접 추가한 링크 유지),
 *     AI 성공 경로(page.route 로 계약서 모양의 가짜 응답), 모바일 피팅룸 고정 "피팅 시작" 바,
 *     키보드·포커스(시트·대화상자 포커스 가두기/되돌리기/Esc, 겹친 모달, 프롬프트 입력, 세그먼트, 달력, 콜라주, 색 찍기),
 *     배경 지운 사진의 IndexedDB 저장·복원(배경 제거 라이브러리는 미리 만든 PNG 를 돌려주는 가짜 모듈), 동작 줄이기.
 *  5. 서버를 끄고 임시 폴더를 지운다 (E2E_KEEP=1 이면 남김). 스크린숏은 E2E_OUT(기본: 임시 폴더/shots).
 *
 * 외부 네트워크(Open-Meteo, Pretendard 글꼴 CDN)는 브라우저에서 가짜로 응답한다.
 * E2E_CONFIGS=m-light,t-dark 처럼 화면 검사할 조합을 줄일 수 있다.
 */
import { join } from "node:path";
import {
  BASE, OUT, api, checkOverflow, checkStructure, cleanup, fail, failures, loadPlaywright, newContext, ok, png, runAxe, screenPaths, seed, settle, startServer, TMP,
} from "./harness.mjs";

const VIEWPORTS = { m: { width: 390, height: 844 }, t: { width: 820, height: 1180 }, d: { width: 1440, height: 900 } };
const CONFIGS = (process.env.E2E_CONFIGS ?? "m-light,m-dark,t-light,t-dark,d-light,d-dark").split(",").filter(Boolean);

async function visit(page, label, name, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await settle(page);
  await checkOverflow(page, label, name);
  await checkStructure(page, label, name);
  await runAxe(page, label, name);
  await page.screenshot({ path: join(OUT, `${label}-${name}.png`), fullPage: true });
}

async function screens(browser, config, s) {
  const [v, scheme] = config.split("-");
  const viewport = VIEWPORTS[v];
  const label = config;
  const { context, page } = await newContext(browser, viewport, label, { colorScheme: scheme });
  const paths = screenPaths(s);
  for (const [name, path] of Object.entries(paths)) await visit(page, label, name, path);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== scheme) fail(`[${label}] 시스템 테마 ${scheme} 인데 앱 테마가 ${theme}`);
  ok(`[${label}] 화면 ${Object.keys(paths).length}개 (넘침·구조·axe)`);
  if (scheme === "dark") return context.close();

  // 내비게이션: 모바일 탭 바 + 더보기, 태블릿 레일·데스크톱 사이드바
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

/** 포커스가 지금 이 선택자 안에 있는지 */
const focusInside = (page, sel) => page.evaluate((s) => !!document.activeElement?.closest(s), sel);
const focusedName = (page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim() || document.activeElement?.tagName);

async function addShirtToBoard(page) {
  await page.getByRole("button", { name: "옷장에서" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /흰 옥스퍼드 셔츠/ }).click();
  await page.getByRole("button", { name: /1벌 올리기/ }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

/** 키보드·포커스: 시트/대화상자 포커스 가두기·되돌리기·Esc, 겹친 모달, 프롬프트 입력, 콜라주·세그먼트·달력·색 찍기 */
async function flowKeyboard(browser) {
  const label = "d-keys";
  const { context, page } = await newContext(browser, { width: 1440, height: 900 }, label);
  await page.goto(BASE + "/profile/fitting", { waitUntil: "domcontentloaded" });
  await settle(page);

  // 시트: 열면 포커스가 안으로, Tab 은 밖으로 못 나감, Esc 로 닫으면 연 버튼으로
  const opener = page.getByRole("button", { name: "옷장에서" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  let escaped = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
    if (!(await focusInside(page, "[role=dialog]"))) escaped++;
  }
  if (escaped) fail(`[${label}] 시트에서 Tab 으로 포커스가 ${escaped}번 밖으로 나감`);

  // 시트 위에 확인 대화상자: Tab 은 대화상자 안에서만, Esc 는 대화상자만 닫음
  await page.evaluate(() => import("/src/components/Dialog.tsx").then((m) => void m.confirmDialog({ title: "겹친 대화상자 테스트" })));
  await page.getByRole("alertdialog").waitFor();
  let leaked = 0;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    if (!(await focusInside(page, "[role=alertdialog]"))) leaked++;
  }
  if (leaked) fail(`[${label}] 시트 위 대화상자에서 Tab 이 ${leaked}번 아래 시트로 빠져나감`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if (await page.getByRole("alertdialog").count()) fail(`[${label}] Esc 로 대화상자가 닫히지 않음`);
  if (!(await page.getByRole("dialog").isVisible())) fail(`[${label}] 대화상자에서 Esc 한 번에 아래 시트까지 닫힘`);
  else if (!(await focusInside(page, "[role=dialog]"))) fail(`[${label}] 대화상자를 닫은 뒤 포커스가 시트로 돌아오지 않음`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  if (await page.getByRole("dialog").count()) fail(`[${label}] Esc 로 시트가 닫히지 않음`);
  if ((await focusedName(page)) !== "옷장에서") fail(`[${label}] 시트를 닫은 뒤 포커스가 연 버튼으로 돌아오지 않음 (${await focusedName(page)})`);
  ok(`[${label}] 시트·겹친 대화상자: 포커스 가두기, Esc(맨 위만), 포커스 되돌리기`);

  // 콜라주 키보드
  await addShirtToBoard(page);
  const layer = page.locator("[data-layer]").first();
  await layer.focus();
  const style = () => layer.evaluate((el) => ({ left: parseFloat(el.style.left), width: parseFloat(el.style.width), transform: el.style.transform }));
  const s0 = await style();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("+");
  await page.keyboard.press("r");
  const s1 = await style();
  if (!(s1.left > s0.left + 5)) fail(`[${label}] 콜라주: 화살표로 옮겨지지 않음 (${s0.left} → ${s1.left})`);
  if (!(s1.width > s0.width)) fail(`[${label}] 콜라주: + 로 커지지 않음`);
  if (!s1.transform.includes("rotate(15deg)")) fail(`[${label}] 콜라주: R 로 돌지 않음 (${s1.transform})`);

  // 프롬프트 대화상자: 글자를 여러 개 칠 수 있고(예전에는 칠 때마다 전체 선택되어 마지막 글자만 남음), Esc 뒤 포커스 복귀
  const save = page.getByRole("button", { name: "코디로 저장" });
  await save.click();
  const input = page.getByRole("alertdialog").getByRole("textbox");
  await input.waitFor();
  await page.keyboard.type("가을 출근 코디");
  const typed = await input.inputValue();
  if (typed !== "가을 출근 코디") fail(`[${label}] 프롬프트 입력칸에 친 글자가 "${typed}" (덮어써짐)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if ((await focusedName(page)) !== "코디로 저장") fail(`[${label}] 프롬프트를 닫은 뒤 포커스가 "코디로 저장" 으로 돌아오지 않음`);
  await layer.focus();
  await page.keyboard.press("Delete");
  if (await page.locator("[data-layer]").count()) fail(`[${label}] 콜라주: Delete 로 빠지지 않음`);
  ok(`[${label}] 콜라주 키보드(이동·크기·회전·빼기), 프롬프트 입력 (${typed})`);

  // 세그먼트: 화살표로 바꾸고 포커스도 따라감
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("radio", { name: "시밀러룩" }).focus();
  await page.keyboard.press("ArrowRight");
  const couple = page.getByRole("radio", { name: "커플룩" });
  if ((await couple.getAttribute("aria-checked")) !== "true" || (await focusedName(page)) !== "커플룩") fail(`[${label}] 세그먼트: 화살표로 바뀌지 않음`);

  // 달력: 화살표 하루, PageDown 다음 달
  await page.goto(BASE + "/outfits/calendar", { waitUntil: "domcontentloaded" });
  await settle(page);
  const cell = page.locator('[role=grid] button[tabindex="0"]');
  const d0 = await cell.getAttribute("data-date");
  await cell.focus();
  await page.keyboard.press("ArrowRight");
  const d1 = await page.evaluate(() => document.activeElement?.getAttribute("data-date"));
  const next = new Date(`${d0}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (d1 !== next.toISOString().slice(0, 10)) fail(`[${label}] 달력: → 키로 다음 날로 가지 않음 (${d0} → ${d1})`);
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(300);
  const d2 = await page.evaluate(() => document.activeElement?.getAttribute("data-date"));
  if (!d2 || d2.slice(0, 7) === d1.slice(0, 7)) fail(`[${label}] 달력: PageDown 으로 다음 달로 가지 않음 (${d2})`);
  const name = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (!name || !name.includes(String(Number(d2.slice(8))))) fail(`[${label}] 달력 칸 이름에 보이는 날짜가 없음 (${name})`);

  // 퍼스널 컬러: 사진 위 색 찍기 자리를 화살표로
  await page.goto(BASE + "/profile/color", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("input[type=file]").first().setInputFiles({ name: "face.png", mimeType: "image/png", buffer: png(200, 260, [214, 180, 160]) });
  const app = page.getByRole("application");
  await app.waitFor({ timeout: 10000 });
  await app.focus();
  await page.keyboard.press("ArrowRight");
  const m1 = await app.locator("span[aria-hidden]").first().evaluate((el) => parseFloat(el.style.left)).catch(() => NaN);
  await page.keyboard.press("Shift+ArrowRight");
  const m2 = await app.locator("span[aria-hidden]").first().evaluate((el) => parseFloat(el.style.left)).catch(() => NaN);
  if (!(m2 > m1)) fail(`[${label}] 색 찍기: 화살표로 위치가 움직이지 않음 (${m1} → ${m2})`);
  ok(`[${label}] 세그먼트·달력(→, PageDown, 이름)·색 찍기 키보드`);
  await context.close();
}

/** 콜라주 "배경 지우기" 결과가 IndexedDB 에 저장되고 다시 열면 복원되는지 (모델 대신 미리 만든 PNG) */
async function flowCutouts(browser) {
  const label = "d-cutout";
  const { context, page } = await newContext(browser, { width: 1440, height: 900 }, label);
  const cut = png(60, 80, [20, 120, 60], { alpha: true }).toString("base64");
  let libLoads = 0;
  await page.route(/@imgly\/background-removal/, (r) => {
    libLoads++;
    return r.fulfill({
      contentType: "text/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: `export async function removeBackground() { const b = Uint8Array.from(atob("${cut}"), (c) => c.charCodeAt(0)); return new Blob([b], { type: "image/png" }); }`,
    });
  });
  await page.goto(BASE + "/profile/fitting", { waitUntil: "domcontentloaded" });
  await settle(page);
  await addShirtToBoard(page);
  const layerImg = page.locator("[data-layer] img").first();
  const original = await layerImg.getAttribute("src");
  await page.getByRole("button", { name: "배경 지우기" }).click();
  await page.getByText("배경을 지웠어요").first().waitFor({ timeout: 15000 }).catch(() => fail(`[${label}] 배경 지우기 완료 알림이 없음`));
  const after = await layerImg.getAttribute("src");
  if (!after?.startsWith("blob:")) fail(`[${label}] 배경 지운 사진으로 바뀌지 않음 (${after})`);
  // 저장은 비동기 → IndexedDB 에 들어갈 때까지
  const key = original.replace("/api/images/", "");
  const stored = async () =>
    page.evaluate(
      (k) =>
        new Promise((resolve) => {
          const req = indexedDB.open("clothe-cutouts");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("cutouts")) return resolve(null);
            const g = db.transaction("cutouts").objectStore("cutouts").get(k);
            g.onsuccess = () => resolve(g.result ? { type: g.result.blob.type, size: g.result.blob.size } : null);
            g.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        }),
      key,
    );
  let rec = null;
  for (let i = 0; i < 20 && !rec; i++) {
    rec = await stored();
    if (!rec) await page.waitForTimeout(200);
  }
  if (!rec || rec.size === 0) fail(`[${label}] IndexedDB 에 배경 지운 사진이 저장되지 않음`);
  // 다시 열기 → 복원
  await page.waitForTimeout(500); // 배치(localStorage) 저장 대기
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("[data-layer] img").first().waitFor();
  let restored = null;
  for (let i = 0; i < 20; i++) {
    restored = await page.locator("[data-layer] img").first().getAttribute("src");
    if (restored?.startsWith("blob:")) break;
    await page.waitForTimeout(200);
  }
  if (!restored?.startsWith("blob:")) fail(`[${label}] 다시 열었을 때 배경 지운 사진이 복원되지 않음 (${restored})`);
  // 모듈 단위: 저장 개수 제한(40) — 오래된 것부터 지움
  const evicted = await page.evaluate(async () => {
    const m = await import("/src/lib/cutouts.ts");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    for (let i = 0; i < 42; i++) await m.saveCutout(`img/test-${i}.png`, blob);
    const got = await m.loadCutouts(["img/test-0.png", "img/test-1.png", "img/test-41.png"]);
    return [...got.keys()];
  });
  if (evicted.includes("img/test-0.png") || !evicted.includes("img/test-41.png")) fail(`[${label}] 저장 개수 제한이 오래된 것부터 지우지 않음 (${evicted.join(",")})`);
  // 원래 사진으로 → IndexedDB 에서도 지움
  await page.locator("[data-layer]").first().click();
  await page.getByRole("button", { name: "원래 사진으로" }).click();
  await page.waitForTimeout(300);
  if ((await page.locator("[data-layer] img").first().getAttribute("src")) !== original) fail(`[${label}] 원래 사진으로 돌아가지 않음`);
  if (await stored()) fail(`[${label}] 원래 사진으로 바꿨는데 IndexedDB 에 남아 있음`);
  if (libLoads !== 1) fail(`[${label}] 배경 제거 라이브러리를 ${libLoads}번 받음 (1번이어야 함)`);
  if (!failures.some((f) => f.includes(label))) ok(`[${label}] 배경 지운 사진: IndexedDB 저장 → 다시 열면 복원 → 개수 제한 → 원래 사진으로 되돌리면 삭제`);
  await context.close();
}

/** 동작 줄이기: 애니메이션이 사실상 꺼지는지 */
async function flowReducedMotion(browser) {
  const label = "m-reduce";
  const { context, page } = await newContext(browser, { width: 390, height: 844 }, label, { reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(BASE + "/profile/fitting", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: "옷장에서" }).click();
  const dur = await page.getByRole("dialog").evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000);
  if (!(dur < 1)) fail(`[${label}] 동작 줄이기인데 시트 애니메이션이 ${dur}ms`);
  else ok(`[${label}] 동작 줄이기: 시트 애니메이션 꺼짐`);
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
  for (const config of CONFIGS) await screens(browser, config, s);
  await flowCollageCover(browser);
  await flowLinks(browser, s);
  await flowAiMocks(browser, s);
  await flowKeyboard(browser);
  await flowCutouts(browser);
  await flowReducedMotion(browser);
} catch (e) {
  fail(`실행 중 오류: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  console.log(`스크린숏: ${OUT}`);
  cleanup();
}

if (failures.length) {
  console.error(`\nE2E 실패 ${failures.length}건`);
  process.exit(1);
}
console.log("\nE2E 통과");
process.exit(0);
