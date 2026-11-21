/**
 * E2E 공용 도구: 격리된 서버, 시드 데이터, 브라우저 컨텍스트, 가로 넘침·접근성(axe-core) 검사.
 * smoke.mjs 가 쓴다. 저장소 안에는 아무 파일도 만들지 않는다 (상태·설정은 E2E_TMP 아래 임시 폴더).
 */
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const require = createRequire(import.meta.url);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PORT = Number(process.env.E2E_PORT ?? 5184);
export const BASE = `http://localhost:${PORT}`;
export const KEEP = process.env.E2E_KEEP === "1";
export const TMP = mkdtempSync(join(process.env.E2E_TMP ?? tmpdir(), "clothe-e2e-"));
export const OUT = process.env.E2E_OUT ? resolve(process.env.E2E_OUT) : join(TMP, "shots");
mkdirSync(OUT, { recursive: true });

export const failures = [];
export const fail = (msg) => {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
export const ok = (msg) => console.log(`  ✓ ${msg}`);
export const note = (msg) => console.log(`  · ${msg}`);

/* ───────────── 격리된 서버 ───────────── */

export function writeIsolatedConfig() {
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

export async function startServer() {
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

export function cleanup() {
  if (!KEEP && !process.env.E2E_OUT) rmSync(TMP, { recursive: true, force: true });
  else if (!KEEP) rmSync(join(TMP, "state"), { recursive: true, force: true });
}

/* ───────────── 시드 데이터 ───────────── */

/** 단색 PNG (API는 실제 이미지 바이트만 받는다). alpha=true면 가운데만 불투명한 RGBA (배경 지운 사진 흉내) */
export function png(w, h, [r, g, b], { alpha = false } = {}) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.concat(
    Array.from({ length: h }, (_, y) => {
      const row = Buffer.alloc(1 + w * ch);
      for (let x = 0; x < w; x++) {
        const inside = !alpha || (x > w / 4 && x < (3 * w) / 4 && y > h / 4 && y < (3 * h) / 4);
        row.set(alpha ? [r, g, b, inside ? 255 : 0] : [r, g, b], 1 + x * ch);
      }
      return row;
    }),
  );
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
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let cookie = "";
export const sessionCookie = () => cookie;

export async function api(method, path, body) {
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

export async function upload(color, w = 120, h = 160) {
  const form = new FormData();
  form.append("file", new File([png(w, h, color)], "a.png", { type: "image/png" }));
  return (await api("POST", "/images", form)).key;
}

export async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "1234" }) });
  if (!res.ok) throw new Error(`로그인 실패 ${res.status}`);
  cookie = res.headers.get("set-cookie").split(";")[0];
}

export async function seed() {
  await login();
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
  return { img, items, outfit, photo, collage, wish, trip, today };
}

/** 시드 데이터로 열어 볼 모든 화면 */
export function screenPaths(s) {
  return {
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
}

/* ───────────── 브라우저 ───────────── */

export function loadPlaywright() {
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

/**
 * @param opts.colorScheme "light" | "dark" (시스템 테마 흉내 — 앱 기본값이 시스템을 따름)
 * @param opts.reducedMotion "reduce" | "no-preference"
 */
export async function newContext(browser, viewport, label, opts = {}) {
  const mobile = viewport.width < 500;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "ko-KR",
    isMobile: mobile,
    hasTouch: viewport.width < 1100,
    colorScheme: opts.colorScheme ?? "light",
    reducedMotion: opts.reducedMotion ?? "no-preference",
  });
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

export async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(250);
}

export async function checkOverflow(page, label, name) {
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

/**
 * 화면 구조 검사: h1 은 정확히 하나, 이름 없는 버튼·링크·입력칸 없음, alt 없는 이미지 없음,
 * 고정 탭 바(모바일)에 가려지는 마지막 내용 없음.
 */
export async function checkStructure(page, label, name) {
  const r = await page.evaluate(() => {
    const visible = (el) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0;
    };
    const h1 = [...document.querySelectorAll("h1")].filter((el) => !el.closest("[aria-hidden='true']") && el.getClientRects().length > 0);
    const unnamed = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=switch], [role=tab]")]
      .filter((el) => visible(el) && !el.closest("[aria-hidden='true'], [inert]"))
      .filter((el) => {
        const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.labels && el.labels.length) || el.closest("label");
        return !labelled && !(el.textContent || "").trim() && !el.querySelector("img[alt]:not([alt=''])");
      })
      .map((el) => el.outerHTML.slice(0, 120));
    const noAlt = [...document.querySelectorAll("img:not([alt])")].map((el) => el.outerHTML.slice(0, 120));
    return { h1: h1.length, unnamed, noAlt };
  });
  if (r.h1 !== 1) fail(`[${label}] ${name}: h1 이 ${r.h1}개 (1개여야 함)`);
  for (const u of r.unnamed.slice(0, 3)) fail(`[${label}] ${name}: 이름 없는 컨트롤 ${u}`);
  for (const u of r.noAlt.slice(0, 3)) fail(`[${label}] ${name}: alt 없는 이미지 ${u}`);
}

const AXE_SRC = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** axe-core (WCAG 2.1 A/AA). serious/critical 은 실패, 나머지는 로그만. */
export async function runAxe(page, label, name, { include } = {}) {
  await page.evaluate(AXE_SRC);
  const res = await page.evaluate(async (sel) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(sel ? { include: [sel] } : document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
      resultTypes: ["violations"],
      rules: { region: { enabled: false } },
    });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} — ${n.failureSummary?.split("\n").slice(1, 2).join(" ").trim() ?? ""}`) }));
  }, include ?? null);
  const serious = res.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of serious) fail(`[${label}] axe ${name}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.join(" | ").slice(0, 400)}`);
  const minor = res.filter((v) => !serious.includes(v));
  if (minor.length) note(`[${label}] axe ${name}: 경미 ${minor.map((v) => `${v.id}(${v.impact})`).join(", ")}`);
  return res;
}
