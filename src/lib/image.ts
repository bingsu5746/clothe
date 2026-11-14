/**
 * 업로드 전에 브라우저에서 이미지를 줄이고 압축한다.
 * WebP로 인코딩을 시도하고, 브라우저가 WebP 인코딩을 지원하지 않으면(일부 Safari) JPEG로 저장한다.
 */
export async function compressImage(file: Blob, maxSide = 1280, quality = 0.82): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 읽지 못했어요"));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
    const webp = await toBlob("image/webp");
    if (webp && webp.type === "image/webp") return webp;
    const jpeg = await toBlob("image/jpeg");
    if (!jpeg) throw new Error("이미지를 압축하지 못했어요");
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}
