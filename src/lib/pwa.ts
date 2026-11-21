import { toast } from "../components/Toast";
import { revalidateAll } from "./query";

/**
 * PWA 실행 환경 관리.
 * - 서비스 워커 등록 (배포 빌드에서만)
 * - 새 버전 확인: 홈 화면 앱은 며칠씩 메모리에 살아 있어서 새로 배포해도 예전 JS를 계속 쓸 수 있다.
 *   앱으로 돌아올 때마다 서버의 index.html 이 지금 실행 중인 번들을 가리키는지 확인하고,
 *   다르면 "업데이트" 토스트를 띄운다 (작성 중인 내용을 날리지 않도록 자동 새로고침은 하지 않음).
 * - 앱으로 돌아오면 화면의 데이터를 조용히 새로 받는다.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastCheck = Date.now();
let updateAnnounced = false;

/** 지금 실행 중인 진입 번들 파일 이름 (예: index-AbC123.js) */
function currentBundleName(): string | null {
  const name = new URL(import.meta.url).pathname.split("/").pop() ?? "";
  return /-[\w-]{6,}\.js$/.test(name) ? name : null;
}

async function checkForUpdate() {
  const bundle = currentBundleName();
  if (!bundle || updateAnnounced) return;
  try {
    const res = await fetch("/", { cache: "no-store", headers: { accept: "text/html" } });
    if (!res.ok) return;
    const html = await res.text();
    if (!html.includes("/assets/") || html.includes(bundle)) return;
    updateAnnounced = true;
    toast("새 버전이 있어요", { duration: 0, action: { label: "업데이트", onClick: () => window.location.reload() } });
  } catch {
    // 오프라인이면 다음에 다시 확인
  }
}

/** 동적 import(화면 조각)가 실패했을 때: 새 배포로 예전 파일이 사라진 경우이므로 한 번만 새로고침 */
export function reloadOnceForStaleChunk(): boolean {
  try {
    const key = "clothe:chunk-reload";
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function initPwa() {
  // iOS Safari는 터치 리스너가 하나라도 있어야 :active 스타일(눌림 피드백)을 적용한다
  document.addEventListener("touchstart", () => {}, { passive: true });

  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    // 잠깐이라도(5초 넘게) 자리를 비웠다 돌아오면 화면의 데이터를 새로 받는다.
    // (iPhone 단축어로 옷·위시리스트를 넣고 바로 앱으로 돌아왔을 때 새 항목이 보이도록. 예전 기준 30초는 그 사이에 돌아오면 안 보였다)
    if (hiddenAt && Date.now() - hiddenAt > 5_000) void revalidateAll();
    if (Date.now() - lastCheck > CHECK_INTERVAL_MS) {
      lastCheck = Date.now();
      void checkForUpdate();
      void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    }
  });

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}
