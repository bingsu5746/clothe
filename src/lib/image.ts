/**
 * 클라이언트 이미지 파이프라인.
 *
 * 1) 사진을 읽는다 — EXIF 회전 정보를 반영해서 (세로로 찍은 사진이 눕지 않게)
 * 2) 긴 변이 maxSide를 넘지 않게 줄인다
 * 3) WebP로 압축한다. 브라우저가 WebP 인코딩을 못 하면(Safari) 불투명 사진은 JPEG, 투명 배경 사진은 PNG.
 *
 * 배경 제거(누끼)는 lib/background.ts 가 맡고, 결과를 composeCutout 으로 3:4 타일에 맞춰 다듬는다.
 */

const DEFAULT_MAX_SIDE = 1280;
const DEFAULT_QUALITY = 0.82;

/** EXIF 방향 6(시계 방향 90°)이 적힌 2×1 JPEG. 브라우저가 EXIF를 알아서 반영하면 1×2로 읽힌다. */
const EXIF_PROBE =
  "data:image/jpeg;base64,/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=";

let exifAutoPromise: Promise<boolean> | null = null;
/** 이 브라우저가 <img>/canvas 에서 EXIF 방향을 자동으로 반영하는지 (요즘 브라우저는 모두 true) */
export function browserAppliesExifOrientation(): Promise<boolean> {
  exifAutoPromise ??= new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth === 1 && img.naturalHeight === 2);
    img.onerror = () => resolve(true);
    img.src = EXIF_PROBE;
  });
  return exifAutoPromise;
}

/** JPEG 파일에서 EXIF 방향 값(1~8)을 읽는다. 없거나 JPEG가 아니면 1. */
export async function readExifOrientation(file: Blob): Promise<number> {
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
        const tiff = offset + 10;
        if (tiff + 8 > view.byteLength) return 1;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd = tiff + view.getUint32(tiff + 4, little);
        if (ifd + 2 > view.byteLength) return 1;
        const count = view.getUint16(ifd, little);
        for (let i = 0; i < count; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 12 > view.byteLength) return 1;
          if (view.getUint16(e, little) === 0x0112) {
            const v = view.getUint16(e + 8, little);
            return v >= 1 && v <= 8 ? v : 1;
          }
        }
        return 1;
      }
      if (marker === 0xffda) break;
      offset += 2 + size;
    }
  } catch {
    // 읽지 못하면 회전 없음으로 본다
  }
  return 1;
}

function loadImage(file: Blob): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했어요"));
    };
    img.src = url;
  });
}

/** 방향을 바로잡고 maxSide 이하로 줄여 캔버스에 그린다 */
async function drawOriented(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const [{ img, release }, auto] = await Promise.all([loadImage(file), browserAppliesExifOrientation()]);
  try {
    // 브라우저가 이미 돌려 줬으면 그대로, 아니면 EXIF 값을 읽어 직접 돌린다 (두 번 돌리지 않도록 둘 중 하나만)
    const orientation = auto ? 1 : await readExifOrientation(file);
    const swap = orientation >= 5;
    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    if (!srcW || !srcH) throw new Error("이미지를 읽지 못했어요");
    const outW = swap ? srcH : srcW;
    const outH = swap ? srcW : srcH;
    const scale = Math.min(1, maxSide / Math.max(outW, outH));
    const w = Math.max(1, Math.round(outW * scale));
    const h = Math.max(1, Math.round(outH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 처리하지 못했어요");
    ctx.imageSmoothingQuality = "high";
    // EXIF 방향 1~8 → 캔버스 변환 행렬
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, w, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, w, h); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, h); break;
    }
    ctx.drawImage(img, 0, 0, swap ? h : w, swap ? w : h);
    return canvas;
  } finally {
    release();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // 16픽셀마다 하나씩만 봐도 충분하다
  for (let i = 3; i < data.length; i += 64) if (data[i] < 250) return true;
  return false;
}

/** WebP → (안 되면) 투명하면 PNG, 아니면 JPEG */
async function encode(canvas: HTMLCanvasElement, quality: number, mayHaveAlpha: boolean): Promise<Blob> {
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  if (mayHaveAlpha && hasTransparency(canvas)) {
    const png = await canvasToBlob(canvas, "image/png");
    if (png) return png;
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("이미지를 압축하지 못했어요");
  return jpeg;
}

const OPAQUE_TYPES = new Set(["image/jpeg", "image/heic", "image/heif"]);

/** 업로드 전에 방향을 바로잡고, 줄이고, 압축한다 */
export async function compressImage(file: Blob, maxSide = DEFAULT_MAX_SIDE, quality = DEFAULT_QUALITY): Promise<Blob> {
  const canvas = await drawOriented(file, maxSide);
  return encode(canvas, quality, !OPAQUE_TYPES.has(file.type));
}

/**
 * 배경을 지운 사진(투명 PNG)을 옷 타일 비율에 맞춘다:
 * 투명한 가장자리를 잘라 내고, ratio(가로/세로) 캔버스 한가운데에 여백을 두고 놓는다.
 * 옷이 타일마다 비슷한 크기로 보이게 하려는 것.
 */
export async function composeCutout(cutout: Blob, opts: { ratio?: number; padding?: number; maxSide?: number; quality?: number } = {}): Promise<Blob> {
  const { ratio = 3 / 4, padding = 0.08, maxSide = DEFAULT_MAX_SIDE, quality = 0.86 } = opts;
  const src = await drawOriented(cutout, maxSide);
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("이미지를 처리하지 못했어요");
  const { data, width, height } = sctx.getImageData(0, 0, src.width, src.height);
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) throw new Error("사진에서 옷을 찾지 못했어요");
  const bw = right - left + 1;
  const bh = bottom - top + 1;
  // 내용이 (1 - 2*padding) 안에 들어가도록 캔버스 크기를 정한다
  const inner = 1 - padding * 2;
  let outH = Math.max(bh / inner, bw / inner / ratio);
  let outW = outH * ratio;
  const shrink = Math.min(1, maxSide / Math.max(outW, outH));
  outW = Math.round(outW * shrink);
  outH = Math.round(outH * shrink);
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("이미지를 처리하지 못했어요");
  octx.imageSmoothingQuality = "high";
  const dw = bw * shrink;
  const dh = bh * shrink;
  octx.drawImage(src, left, top, bw, bh, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
  return encode(out, quality, true);
}

/** 캔버스를 업로드용으로 압축한다 (WebP → 안 되면 투명하면 PNG, 아니면 JPEG) */
export function encodeCanvas(canvas: HTMLCanvasElement, quality = DEFAULT_QUALITY, mayHaveAlpha = false): Promise<Blob> {
  return encode(canvas, quality, mayHaveAlpha);
}
