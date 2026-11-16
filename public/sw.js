/*
 * 서비스 워커. 목표: 오프라인에서도 앱 화면이 뜨되, 새로 배포하면 절대 예전 JS에 머물지 않게.
 *
 * - /api/* 는 손대지 않는다 (항상 네트워크, 캐시 안 함).
 * - 페이지 이동(index.html): 네트워크 우선. 4초 안에 못 받으면(오프라인·느린 망) 저장해 둔 화면.
 *   받아 온 index.html이 저장본과 다르면 = 새 배포 → 예전 /assets 캐시를 통째로 비운다.
 * - /assets/* (파일 이름에 해시가 있어 내용이 절대 바뀌지 않음): 캐시 우선.
 * - 아이콘·매니페스트: 캐시를 먼저 주고 뒤에서 새로 받아 둔다.
 * - Pretendard 글꼴(jsDelivr, 버전이 박힌 주소): 캐시 우선.
 * 이 파일은 빌드 결과 목록을 담지 않으므로 새 워커가 곧바로 활성화되어도 안전하다 (skipWaiting).
 */
const VERSION = "v2";
const SHELL = `clothe-shell-${VERSION}`;
const ASSETS = `clothe-assets-${VERSION}`;
const FONTS = "clothe-fonts-v1";
const KEEP = new Set([SHELL, ASSETS, FONTS]);
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([new Request("/", { cache: "reload" }), "/manifest.webmanifest", "/icons/icon.svg"]))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function storeShell(res) {
  const shell = await caches.open(SHELL);
  const old = await shell.match("/");
  const [next, prev] = await Promise.all([res.clone().text(), old ? old.text() : null]);
  if (prev !== null && prev !== next) await caches.delete(ASSETS);
  await shell.put("/", res);
}

async function navigate(req) {
  const cached = () => caches.match("/", { cacheName: SHELL });
  const network = fetch(req).then((res) => {
    // 앱 화면(HTML)일 때만 저장. 로그인 리다이렉트나 오류 페이지는 저장하지 않는다.
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) storeShell(res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return (await cached()) || (await network);
  } catch {
    return (await cached()) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || network;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === "https://cdn.jsdelivr.net" && url.pathname.includes("/pretendard@")) {
    e.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(navigate(req));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(cacheFirst(req, ASSETS));
    return;
  }
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(staleWhileRevalidate(req, SHELL));
  }
});
