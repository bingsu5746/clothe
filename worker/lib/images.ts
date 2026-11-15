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
