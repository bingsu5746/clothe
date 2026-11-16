import type { UrlImport } from "../../shared/types";
import { isPublicHttpUrl } from "./util";

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
      image = new URL(image, url).toString();
    } catch {
      image = null;
    }
  }
  return { name: name ? decodeEntities(name) : null, brand, price, image_url: image, url };
}

export async function fetchProduct(url: string): Promise<UrlImport> {
  if (!isPublicHttpUrl(url)) throw new Error("올바른 URL을 입력해 주세요");
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "ko-KR,ko;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    throw new Error("페이지를 불러오지 못했어요 (연결 실패 또는 시간 초과)");
  });
  if (!res.ok) throw new Error(`페이지를 불러오지 못했어요 (${res.status})`);
  const html = (await res.text()).slice(0, 2_000_000);
  return parseProductHtml(html, res.url || url);
}

/** 외부 이미지를 내려받아 R2에 저장하고 key를 돌려준다. 실패하면 null. */
export async function saveRemoteImage(bucket: R2Bucket, imageUrl: string): Promise<string | null> {
  try {
    if (!isPublicHttpUrl(imageUrl)) return null;
    const res = await fetch(imageUrl, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/") || type.includes("svg")) return null; // SVG는 스크립트를 담을 수 있어 받지 않음
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 10 * 1024 * 1024) return null;
    const rawExt = type.split("/")[1]?.split(";")[0]?.trim().toLowerCase() ?? "jpg";
    const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : "jpg"; // svg+xml 같은 값이 key에 들어가지 않게
    const key = `img/${crypto.randomUUID()}.${ext}`;
    if (buf.byteLength === 0) return null;
    await bucket.put(key, buf, { httpMetadata: { contentType: type.split(";")[0] } });
    return key;
  } catch {
    return null;
  }
}
