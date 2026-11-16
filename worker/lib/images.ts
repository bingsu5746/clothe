import type { Env } from "../env";
import { HttpError } from "./util";

export interface LoadedImage {
  mimeType: string;
  data: Uint8Array;
}

/** R2에서 이미지를 읽는다. maxBytes보다 크면 413. */
export async function loadImage(env: Env, key: string, maxBytes = 8 * 1024 * 1024): Promise<LoadedImage> {
  const obj = await env.BUCKET.get(key);
  if (!obj) throw new HttpError(404, "이미지를 찾을 수 없어요. 사진을 다시 올려 주세요.");
  if (obj.size > maxBytes) throw new HttpError(413, "이미지가 너무 커요");
  return {
    mimeType: obj.httpMetadata?.contentType ?? "image/jpeg",
    data: new Uint8Array(await obj.arrayBuffer()),
  };
}

/** 이 이미지 key를 쓰는 행이 하나라도 있는지 확인하는 쿼리 (모든 표를 한 번에) */
const REFERENCED_SQL = `
SELECT 1 FROM items WHERE image_key = ?1
UNION ALL SELECT 1 FROM inspirations WHERE image_key = ?1
UNION ALL SELECT 1 FROM wishlist WHERE image_key = ?1
UNION ALL SELECT 1 FROM outfit_logs WHERE selfie_key = ?1
UNION ALL SELECT 1 FROM profile WHERE face_image_key = ?1 OR body_image_key = ?1 OR instr(mannequin_images, ?2) > 0
UNION ALL SELECT 1 FROM tryons WHERE person_image_key = ?1 OR garment_image_key = ?1 OR result_image_key = ?1
LIMIT 1`;

/**
 * 행을 지우거나 사진을 바꾼 뒤에 호출: 더 이상 어디에서도 쓰지 않는 이미지만 R2에서 지운다.
 * (스크랩 사진을 위시리스트가 같이 쓰는 경우처럼, 다른 곳에서 아직 쓰는 이미지는 남긴다.)
 * 정리 실패는 요청을 실패시키지 않는다.
 */
export async function deleteUnreferencedImages(env: Env, keys: (string | null | undefined)[]): Promise<string[]> {
  const unique = [...new Set(keys.filter((k): k is string => typeof k === "string" && k !== ""))];
  if (!unique.length) return [];
  try {
    const results = await env.DB.batch(unique.map((k) => env.DB.prepare(REFERENCED_SQL).bind(k, JSON.stringify(k))));
    const orphaned = unique.filter((_, i) => results[i].results.length === 0);
    if (orphaned.length) await env.BUCKET.delete(orphaned);
    return orphaned;
  } catch (e) {
    console.error("image cleanup failed", e);
    return [];
  }
}

/**
 * 파일 앞부분(매직 바이트)으로 이미지 형식을 알아낸다. 모르는 형식이면 null.
 * HEIC/HEIF/AVIF는 모두 ISO BMFF("....ftyp" + 브랜드)라서 브랜드로 구분하고, 구분이 애매하면 "isobmff".
 * 형식 출처: JPEG FF D8 FF / PNG 89 50 4E 47 0D 0A 1A 0A / GIF "GIF87a"|"GIF89a" / WebP "RIFF"....“WEBP” /
 * ISO BMFF 4~7번째 바이트 "ftyp" (https://mimesniff.spec.whatwg.org/#matching-an-image-type-pattern)
 */
export type SniffedImage = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" | "image/heic" | "isobmff";

export function sniffImageType(b: Uint8Array): SniffedImage | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "isobmff";
  }
  return null;
}

/** 주장한 MIME과 실제 형식이 같은 계열인지 (HEIC/HEIF/AVIF는 브랜드가 섞여 쓰여서 서로 허용) */
export function sameImageFamily(claimed: string, sniffed: SniffedImage): boolean {
  const c = claimed.toLowerCase();
  const bmff = new Set(["image/heic", "image/heif", "image/avif"]);
  if (sniffed === "isobmff" || sniffed === "image/heic" || sniffed === "image/avif") return bmff.has(c);
  return c === sniffed;
}
