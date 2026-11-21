import type { Category, UrlImport } from "../../shared/types";
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

/**
 * 상품 분류 글(빵부스러기, JSON-LD category, 상품명)에서 옷 카테고리를 추정한다. 모르면 null.
 * 앞에 있는 규칙이 먼저 이긴다: "니트 원피스" → 원피스, "후드 집업" → 아우터, "데님 자켓" → 아우터.
 * 한글은 부분 문자열, 영어는 단어 단위로 찾는다. 헷갈리기 쉬운 말("베스트"=best, "힐링", "플랫폼")은 넣지 않았다.
 */
const CATEGORY_RULES: [Category, RegExp][] = [
  ["dress", /원피스|드레스|점프수트|\b(?:dress(?:es)?|jumpsuits?|one-?piece)\b/i],
  ["outer", /아우터|자켓|재킷|코트|패딩|점퍼|블루종|가디건|카디건|집업|바람막이|야상|무스탕|조끼|블레이저|아노락|\b(?:outer(?:wear)?|jackets?|coats?|parkas?|cardigans?|blazers?|puffers?|vests?|windbreakers?|anoraks?|zip-?ups?)\b/i],
  ["shoes", /신발|스니커즈|운동화|구두|로퍼|부츠|샌들|슬리퍼|슈즈|\b(?:shoes?|sneakers?|boots?|loafers?|sandals?|slippers?|heels|mules?)\b/i],
  ["bag", /가방|백팩|토트백|크로스백|숄더백|클러치|에코백|\b(?:bags?|backpacks?|totes?|clutch(?:es)?|handbags?)\b/i],
  ["bottom", /바지|팬츠|슬랙스|청바지|스커트|치마|쇼츠|반바지|레깅스|조거|하의|\b(?:pants|trousers|jeans|skirts?|shorts|leggings|slacks|joggers|bottoms?)\b/i],
  ["top", /티셔츠|셔츠|블라우스|니트|스웨터|맨투맨|후드|후디|나시|슬리브리스|폴로|터틀넥|상의|\b(?:t-?shirts?|tees?|shirts?|blouses?|knit(?:wear)?|sweaters?|sweatshirts?|hoodies?|tops?|polos?|turtlenecks?)\b/i],
  ["accessory", /모자|비니|벨트|목걸이|반지|귀걸이|팔찌|스카프|머플러|양말|시계|선글라스|안경|장갑|액세서리|주얼리|\b(?:hats?|caps?|beanies?|belts?|necklaces?|rings?|earrings?|bracelets?|scarf|scarves|socks|watch(?:es)?|sunglasses|gloves|accessor(?:y|ies)|jewelry)\b/i],
];

export function guessCategory(texts: (string | null | undefined)[]): Category | null {
  for (const t of texts) {
    if (!t) continue;
    for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  }
  return null;
}

/** JSON-LD BreadcrumbList의 이름들 ("홈 > 상의 > 니트") */
function breadcrumbText(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = breadcrumbText(n);
      if (t) return t;
    }
    return null;
  }
  const obj = node as { "@type"?: unknown; itemListElement?: unknown; "@graph"?: unknown };
  if (obj["@type"] === "BreadcrumbList" && Array.isArray(obj.itemListElement)) {
    const names = obj.itemListElement
      .map((e: unknown) => {
        if (!e || typeof e !== "object") return "";
        const el = e as { name?: unknown; item?: unknown };
        if (typeof el.name === "string") return el.name;
        const item = el.item as { name?: unknown } | null | undefined;
        return item && typeof item === "object" && typeof item.name === "string" ? item.name : "";
      })
      .filter(Boolean);
    return names.length ? names.join(" > ") : null;
  }
  return obj["@graph"] ? breadcrumbText(obj["@graph"]) : null;
}

interface JsonLdProduct {
  "@type"?: string | string[];
  name?: string;
  category?: string | string[];
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
  let breadcrumb: string | null = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(m[1]);
      product ??= findProduct(data);
      breadcrumb ??= breadcrumbText(data);
      if (product && breadcrumb) break;
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
  const decodedName = name ? decodeEntities(name) : null;
  const ldCategory = Array.isArray(product?.category) ? product.category.filter((x) => typeof x === "string").join(" > ") : typeof product?.category === "string" ? product.category : null;
  // 분류 글이 상품명보다 믿을 만하다 (상품명에는 "셔츠 같은 자켓"처럼 여러 말이 섞임)
  const category = guessCategory([breadcrumb, ldCategory, meta(html, "product:category"), decodedName]);
  return { name: decodedName, brand, price, image_url: image, url, category };
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
