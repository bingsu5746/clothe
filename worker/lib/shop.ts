import type { UrlImport } from "../../shared/types";
import { sameImageFamily, sniffImageType } from "./images";
import { isPublicHttpUrl, readBodyLimited, safeFetch } from "./util";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function meta(html: string, prop: string): string | null {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

function toPrice(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

interface JsonLdProduct {
  "@type"?: string | string[];
  name?: string;
  image?: string | string[] | { url?: string };
  brand?: string | { name?: string };
  offers?: { price?: unknown; lowPrice?: unknown } | { price?: unknown; lowPrice?: unknown }[];
  "@graph"?: JsonLdProduct[];
}

function findProduct(node: unknown): JsonLdProduct | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const p = findProduct(n);
      if (p) return p;
    }
    return null;
  }
  const obj: JsonLdProduct = node;
  const t = obj["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return obj;
  if (obj["@graph"]) return findProduct(obj["@graph"]);
  return null;
}

/** 쇼핑몰 상품 페이지 HTML에서 상품명/브랜드/가격/이미지를 뽑는다 (JSON-LD 우선, 없으면 OpenGraph). */
export function parseProductHtml(html: string, url: string): UrlImport {
  let product: JsonLdProduct | null = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      product = findProduct(JSON.parse(m[1]));
      if (product) break;
    } catch {
      /* 잘못된 JSON-LD 무시 */
    }
  }

  let image: string | null = null;
  let brand: string | null = null;
  let price: number | null = null;
  let name: string | null = null;

  if (product) {
    name = product.name ?? null;
    const img = product.image;
    image = typeof img === "string" ? img : Array.isArray(img) ? img[0] ?? null : img?.url ?? null;
    brand = typeof product.brand === "string" ? product.brand : product.brand?.name ?? null;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    price = toPrice(offer?.price ?? offer?.lowPrice);
  }

  name ??= meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  image ??= meta(html, "og:image") ?? meta(html, "twitter:image");
  brand ??= meta(html, "product:brand") ?? meta(html, "og:brand");
  price ??= toPrice(meta(html, "product:price:amount") ?? meta(html, "og:price:amount"));

  if (image) {
    try {
      const abs = new URL(image, url);
      // 페이지가 준 값이라 javascript:, data: 같은 주소가 들어올 수 있다 → http(s)만 남긴다 (위시리스트 링크/이미지로 그대로 쓰임)
      image = abs.protocol === "http:" || abs.protocol === "https:" ? abs.toString() : null;
    } catch {
      image = null;
    }
  }
  return { name: name ? decodeEntities(name) : null, brand, price, image_url: image, url };
}

const MAX_HTML_BYTES = 2_000_000;
const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;

export async function fetchProduct(url: string): Promise<UrlImport> {
  if (!isPublicHttpUrl(url)) throw new Error("올바른 URL을 입력해 주세요");
  const { res, finalUrl } = await safeFetch(url, {
    headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "ko-KR,ko;q=0.9" },
  }).catch(() => {
    throw new Error("페이지를 불러오지 못했어요 (연결 실패 또는 시간 초과)");
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`페이지를 불러오지 못했어요 (${res.status})`);
  }
  // 아주 큰 응답을 통째로 메모리에 올리지 않게 앞부분만 읽는다 (상품 메타 태그는 보통 <head> 안에 있다)
  const html = await readTextPrefix(res, MAX_HTML_BYTES);
  return parseProductHtml(html, finalUrl);
}

async function readTextPrefix(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = value.subarray(0, Math.max(0, maxBytes - total));
    total += take.byteLength;
    out += decoder.decode(take, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return out + decoder.decode();
}

/**
 * 외부 이미지를 내려받아 R2에 저장하고 key를 돌려준다. 실패하면 null.
 * 리다이렉트도 한 단계씩 검사하고(safeFetch), 10MB를 넘으면 중간에 끊고, 응답 헤더가 아니라 실제 바이트로 형식을 확인한다.
 */
export async function saveRemoteImage(bucket: R2Bucket, imageUrl: string): Promise<string | null> {
  try {
    if (!isPublicHttpUrl(imageUrl)) return null;
    const { res } = await safeFetch(imageUrl, { headers: { "user-agent": UA, accept: "image/*" } });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !type.startsWith("image/") || type.includes("svg")) {
      await res.body?.cancel().catch(() => undefined);
      return null; // SVG는 스크립트를 담을 수 있어 받지 않음
    }
    const data = await readBodyLimited(res, MAX_REMOTE_IMAGE_BYTES);
    if (!data || data.byteLength === 0) return null;
    const sniffed = sniffImageType(data);
    if (!sniffed) return null;
    // 서버가 형식을 잘못 알려 줘도(예: webp를 image/jpeg로) 실제 형식으로 저장한다
    const contentType = sniffed === "isobmff" ? (sameImageFamily(type, sniffed) ? type : "image/heif") : sniffed;
    const key = `img/${crypto.randomUUID()}.${contentType.split("/")[1]}`;
    await bucket.put(key, data, { httpMetadata: { contentType } });
    return key;
  } catch {
    return null;
  }
}
