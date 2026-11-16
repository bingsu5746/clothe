import type { Env } from "../env";
import type { ShoppingLink, ShoppingResult, ShoppingSearch } from "../../shared/types";
import { fetchWithRetry } from "./util";
import { asArray, asNumber, asString, isRecord } from "./validate";

/**
 * 키 없이 쓸 수 있는 쇼핑몰 검색 링크.
 * URL 형식 확인(2026-11-15, 실제 브라우저로 열어 봄):
 * - 무신사 https://www.musinsa.com/search/goods?keyword=니트 → 검색 결과 페이지가 열림 ("'니트' 관련 상품 찾기")
 * - 29CM  https://www.29cm.co.kr/store/search?keyword=니트 → 검색 결과 페이지가 열림 (/search?keyword= 는 404라서 쓰지 않음)
 * - 네이버 쇼핑 https://search.shopping.naver.com/search/all?query=니트 → 네이버 통합검색의 "쇼핑" 탭이 거는 링크와 같은 형식.
 *   (확인한 환경의 IP에서는 네이버 쇼핑이 접속 제한 화면을 보여 줘서 결과 화면까지는 확인하지 못함)
 */
export function shoppingLinks(query: string): ShoppingLink[] {
  const q = encodeURIComponent(query.trim());
  const link = (title: string, url: string, source: ShoppingLink["source"], mall: string): ShoppingLink => ({ title, url, source, price: null, image_url: null, mall });
  return [
    link(`네이버 쇼핑에서 "${query}" 검색`, `https://search.shopping.naver.com/search/all?query=${q}`, "naver_search", "네이버 쇼핑"),
    link(`무신사에서 "${query}" 검색`, `https://www.musinsa.com/search/goods?keyword=${q}`, "musinsa_search", "무신사"),
    link(`29CM에서 "${query}" 검색`, `https://www.29cm.co.kr/store/search?keyword=${q}`, "29cm_search", "29CM"),
  ];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** 네이버가 검색어와 일치하는 부분에 넣는 <b> 태그 등을 지운다 */
export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).trim();
}

/**
 * 네이버 쇼핑 검색 API(JSON) 응답 → ShoppingResult[].
 * 응답 필드(공식 문서): items[].title, link, image, lprice, hprice, mallName, productId, productType, maker, brand, category1~4.
 * lprice는 "최저가. 최저가 정보가 없으면 0을 반환" → 0이면 null로 바꾼다.
 */
export function parseNaverShopping(body: unknown): ShoppingResult[] {
  const out: ShoppingResult[] = [];
  for (const x of asArray(isRecord(body) ? body.items : null)) {
    if (!isRecord(x)) continue;
    const url = asString(x.link);
    const title = stripTags(asString(x.title));
    if (!/^https?:\/\//i.test(url) || !title) continue;
    const price = asNumber(x.lprice);
    const image = asString(x.image);
    const productId = typeof x.productId === "number" ? String(x.productId) : asString(x.productId);
    out.push({
      title,
      url,
      image_url: /^https?:\/\//i.test(image) ? image : null,
      price: price && price > 0 ? Math.round(price) : null,
      mall: asString(x.mallName) || null,
      brand: asString(x.brand) || null,
      category: [x.category1, x.category2, x.category3, x.category4].map((c) => asString(c)).filter(Boolean),
      product_id: productId || null,
    });
  }
  return out;
}

export function naverEnabled(env: Env): boolean {
  return Boolean(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET);
}

/**
 * 네이버 쇼핑 검색 API 요청 URL.
 * 공식 문서: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md (2026-11-15 확인)
 * - GET https://openapi.naver.com/v1/search/shop.json
 * - 헤더 X-Naver-Client-Id / X-Naver-Client-Secret
 * - query(필수, UTF-8), display(기본 10, 최대 100), start(기본 1, 최대 1000), sort(sim|date|asc|dsc),
 *   exclude(used:rental:cbshop 조합)
 * - 하루 호출 한도 25,000회, API 사용 설정이 안 된 애플리케이션이면 403
 */
export function naverShoppingUrl(query: string, display: number): string {
  const url = new URL("https://openapi.naver.com/v1/search/shop.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.min(100, Math.max(1, Math.round(display)))));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "sim");
  url.searchParams.set("exclude", "used:rental");
  return url.toString();
}

function naverFailure(status: number, body: unknown): string {
  const detail = isRecord(body) && typeof body.errorMessage === "string" ? ` (${body.errorMessage.slice(0, 120)})` : "";
  if (status === 401) return `네이버 API 키가 올바르지 않아요${detail}. NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 확인해 주세요.`;
  if (status === 403) return `네이버 애플리케이션에 '검색' API 사용 설정이 안 되어 있어요${detail}.`;
  if (status === 429) return `네이버 검색 API 호출 한도를 넘었어요${detail}.`;
  return `네이버 쇼핑 검색에 실패했어요 (${status})${detail}.`;
}

/** 쇼핑 검색. 네이버 키가 있으면 API 결과 + 검색 링크, 없거나 실패하면 검색 링크만 (notice에 이유). */
export async function searchShopping(env: Env, query: string, limit = 10): Promise<ShoppingSearch> {
  const links = shoppingLinks(query);
  const base = { query, naver_enabled: naverEnabled(env), links };
  if (!base.naver_enabled) {
    return { ...base, source: "links", results: [], notice: "네이버 쇼핑 API 키(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)가 없어서 쇼핑몰 검색 링크만 보여 드려요." };
  }
  try {
    const res = await fetchWithRetry(
      naverShoppingUrl(query, limit),
      { headers: { "X-Naver-Client-Id": env.NAVER_CLIENT_ID, "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET, accept: "application/json" } },
      { timeoutMs: 8000, retries: 1, label: "네이버 쇼핑" },
    );
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ...base, source: "links", results: [], notice: naverFailure(res.status, body) };
    const results = parseNaverShopping(body).slice(0, limit);
    return { ...base, source: "naver", results, notice: results.length ? null : "네이버 쇼핑에서 검색 결과를 찾지 못했어요." };
  } catch (e) {
    return { ...base, source: "links", results: [], notice: e instanceof Error ? e.message : "네이버 쇼핑 검색에 실패했어요." };
  }
}

/** 위시리스트 항목으로 검색어 만들기: 이름 (+ 이름에 없는 첫 번째 색) */
export function wishSearchQuery(wish: { name: string; colors: string[] }): string {
  const name = wish.name.replace(/\s+/g, " ").trim().slice(0, 60);
  const color = wish.colors.find((c) => c && !name.includes(c));
  return color ? `${color} ${name}` : name;
}

/** 검색 결과를 위시리스트에 저장할 링크 목록으로 (API 상품 최대 5개 + 검색 링크 3개) */
export function toRecommendedLinks(search: ShoppingSearch): ShoppingLink[] {
  const items: ShoppingLink[] = search.results.slice(0, 5).map((r) => ({
    title: r.title,
    url: r.url,
    source: "naver_item",
    price: r.price,
    image_url: r.image_url,
    mall: r.mall,
  }));
  return [...items, ...search.links];
}
