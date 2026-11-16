/**
 * 옷 사진 배경 제거 (누끼). 전부 기기 안에서 처리하고 사진을 외부로 보내지 않는다.
 *
 * @imgly/background-removal 은 크기가 커서(코드 + ONNX 런타임) 사용자가 "배경 제거"를 켠 뒤
 * 처음 사진을 고를 때에만 불러온다. 라이브러리 코드는 버전을 고정한 jsDelivr ESM 빌드에서,
 * 모델 파일(약 45MB)과 WASM(약 12MB)은 라이브러리 CDN(staticimgly.com)에서 처음 한 번 내려받고
 * 이후에는 브라우저 캐시를 쓴다.
 *
 * npm 패키지를 번들하지 않는 이유: onnxruntime-web 이 import.meta.url 로 24MB짜리 WASM 을 참조해서
 * Vite 가 쓰지도 않는 그 파일을 배포물에 복사한다 (Cloudflare 정적 파일 한도 25MiB에 근접).
 * 패키지는 타입을 위해서만 devDependency 로 둔다.
 */
import type { Config } from "@imgly/background-removal";

const LIB_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
type Lib = { removeBackground: (image: Blob, config?: Config) => Promise<Blob> };
let libPromise: Promise<Lib> | null = null;
function loadLib(): Promise<Lib> {
  libPromise ??= (import(/* @vite-ignore */ LIB_URL) as Promise<Lib>).catch((e) => {
    libPromise = null; // 다음에 다시 시도할 수 있게
    throw e;
  });
  return libPromise;
}

export interface RemovalProgress {
  /** download: 모델을 내려받는 중, process: 사진을 처리하는 중 */
  phase: "download" | "process";
  /** 0~1. 알 수 없으면 null */
  ratio: number | null;
}

export async function removeBackground(image: Blob, onProgress?: (p: RemovalProgress) => void): Promise<Blob> {
  onProgress?.({ phase: "download", ratio: null });
  const { removeBackground: run } = await loadLib();
  // 여러 파일을 나눠 받으므로 파일별 진행을 합쳐서 하나의 비율로 만든다
  const totals = new Map<string, { current: number; total: number }>();
  return run(image, {
    model: "isnet_quint8",
    device: "cpu",
    output: { format: "image/png", quality: 1 },
    progress: (key: string, current: number, total: number) => {
      if (!onProgress) return;
      if (key.startsWith("fetch:")) {
        totals.set(key, { current, total });
        let c = 0;
        let t = 0;
        totals.forEach((v) => {
          c += v.current;
          t += v.total;
        });
        onProgress({ phase: "download", ratio: t > 0 ? c / t : null });
      } else if (key.startsWith("compute:")) {
        onProgress({ phase: "process", ratio: total > 0 ? current / total : null });
      }
    },
  });
}
