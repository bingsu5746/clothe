/**
 * 퍼스널 컬러 진단용 색 처리 (브라우저 캔버스).
 *
 * 1) 화이트밸런스 보정: 조명 색 때문에 피부가 누렇게/푸르게 찍히는 것을 바로잡는다.
 *    - gray-world: 사진 전체 평균이 무채색이 되도록 채널마다 이득(gain)을 준다. 흰 벽·종이가 없을 때.
 *    - white point: 사용자가 누른 "원래 흰색/회색인 곳"(종이, 벽, 흰 옷)을 무채색으로 맞춘다. 더 정확.
 *    두 방법 모두 밝기는 그대로 두고 색만 바꾼다(이득의 평균 = 1).
 * 2) 색 뽑기: 누른 지점 주변 원 안의 픽셀을 밝기 순으로 줄 세워 위아래 20%(반사광·그림자)를 버리고 평균.
 */

export type Gains = [number, number, number];
export const NO_GAINS: Gains = [1, 1, 1];

const clampGain = (g: number) => Math.min(2.2, Math.max(0.45, g));

/** 밝기를 지키도록 세 이득의 평균을 1로 맞춘다 */
function normalize([r, g, b]: Gains): Gains {
  const m = (r + g + b) / 3;
  return [clampGain(r / m), clampGain(g / m), clampGain(b / m)];
}

/** 사진 전체(너무 어둡거나 하얗게 날아간 픽셀 제외)의 평균이 회색이 되게 */
export function grayWorldGains(data: ImageData): Gains {
  const d = data.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  // 큰 사진도 빠르게: 8픽셀마다 하나
  for (let i = 0; i < d.length; i += 32) {
    const R = d[i];
    const G = d[i + 1];
    const B = d[i + 2];
    const max = Math.max(R, G, B);
    if (max < 20 || Math.min(R, G, B) > 248) continue;
    r += R;
    g += G;
    b += B;
    n++;
  }
  if (!n || !r || !g || !b) return NO_GAINS;
  return normalize([1 / (r / n), 1 / (g / n), 1 / (b / n)]);
}

/** 기준점(원래 흰색/회색인 곳)의 색을 무채색으로 */
export function whitePointGains([r, g, b]: [number, number, number]): Gains {
  if (r < 8 || g < 8 || b < 8) return NO_GAINS;
  return normalize([1 / r, 1 / g, 1 / b]);
}

export function applyGains(src: HTMLCanvasElement, gains: Gains): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!ctx || !sctx) throw new Error("이미지를 처리하지 못했어요");
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const [gr, gg, gb] = gains;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * gr);
    d[i + 1] = Math.min(255, d[i + 1] * gg);
    d[i + 2] = Math.min(255, d[i + 2] * gb);
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** (x, y)는 0~1 비율. 반지름도 사진 짧은 변에 대한 비율 */
export function sampleRgb(canvas: HTMLCanvasElement, x: number, y: number, radius = 0.018): [number, number, number] | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const cx = Math.round(x * canvas.width);
  const cy = Math.round(y * canvas.height);
  const r = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * radius));
  const x0 = Math.max(0, cx - r);
  const y0 = Math.max(0, cy - r);
  const w = Math.min(canvas.width, cx + r + 1) - x0;
  const h = Math.min(canvas.height, cy + r + 1) - y0;
  if (w <= 0 || h <= 0) return null;
  const d = ctx.getImageData(x0, y0, w, h).data;
  const px: [number, number, number, number][] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = x0 + i - cx;
      const dy = y0 + j - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const k = (j * w + i) * 4;
      px.push([d[k], d[k + 1], d[k + 2], d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114]);
    }
  }
  if (!px.length) return null;
  px.sort((a, b) => a[3] - b[3]);
  const cut = Math.floor(px.length * 0.2);
  const kept = px.length > 10 ? px.slice(cut, px.length - cut) : px;
  const sum = kept.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
  return [sum[0] / kept.length, sum[1] / kept.length, sum[2] / kept.length];
}

export function toHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** 글자를 얹을 때 흰 글자/검은 글자 중 무엇이 잘 보이는지 */
export function readableOn(hex: string): "light" | "dark" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "dark";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? "dark" : "light";
}

/** Blob → 최대 maxSide 캔버스 (이미 방향 보정·압축된 Blob 을 받는다) */
export async function blobToCanvas(blob: Blob, maxSide = 1280): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("이미지를 처리하지 못했어요");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}
