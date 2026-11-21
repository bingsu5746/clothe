import { describe, expect, it } from "vitest";
import { parseProductHtml } from "../worker/lib/shop";
import { parseForecast } from "../shared/weather";
import { createSessionToken, verifySessionToken } from "../worker/lib/auth";
import { sanitizeOutfits } from "../worker/lib/stylist";
import { todayKST } from "../worker/lib/util";

describe("parseProductHtml", () => {
  it("JSON-LD Product를 우선 사용한다", () => {
    const html = `<html><head>
      <meta property="og:title" content="OG 제목">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"울 블렌드 코트","image":["/img/a.jpg"],"brand":{"name":"브랜드A"},"offers":{"price":"129000"}}</script>
    </head></html>`;
    expect(parseProductHtml(html, "https://shop.example.com/p/1")).toEqual({
      name: "울 블렌드 코트",
      brand: "브랜드A",
      price: 129000,
      image_url: "https://shop.example.com/img/a.jpg",
      url: "https://shop.example.com/p/1",
      category: "outer",
    });
  });

  it("카테고리: 빵부스러기·JSON-LD category가 상품명보다 우선하고, 모르면 null", () => {
    const crumbs = `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"name":"홈"},{"name":"여성"},{"item":{"name":"원피스"}}]}</script>
      <script type="application/ld+json">{"@type":"Product","name":"셔츠 칼라 롱 드레스"}</script>`;
    expect(parseProductHtml(crumbs, "https://a.com/").category).toBe("dress");
    const ld = `<script type="application/ld+json">{"@type":"Product","name":"데일리 아이템","category":["의류","하의","슬랙스"]}</script>`;
    expect(parseProductHtml(ld, "https://a.com/").category).toBe("bottom");
    expect(parseProductHtml(`<meta property="og:title" content="후드 집업 그레이">`, "https://a.com/").category).toBe("outer");
    expect(parseProductHtml(`<meta property="og:title" content="Leather Chelsea Boots">`, "https://a.com/").category).toBe("shoes");
    expect(parseProductHtml(`<meta property="og:title" content="베스트 상품 모음">`, "https://a.com/").category).toBeNull();
  });

  it("따옴표가 섞인 메타 값과 16진수 엔티티 (예전에는 \"Levi's 501\"이 \"Levi\"로 잘렸다)", () => {
    const html = `<meta property="og:title" content="Levi's 501 &#x27;오리지널&#x27; &apos;진&apos;"><meta content='29CM "단독"' property="og:brand"><meta property="product:brand" content='Men"s'>`;
    const r = parseProductHtml(html, "https://a.com/");
    expect(r.name).toBe("Levi's 501 '오리지널' '진'");
    expect(r.brand).toBe('Men"s');
    expect(parseProductHtml(`<meta property="og:title" content="A &#0; B &#x110000; C">`, "https://a.com/").name).toBe("A  B  C");
  });

  it("JSON-LD가 없으면 OpenGraph 메타태그를 쓴다", () => {
    const html = `<meta content="https://cdn.example.com/x.jpg" property="og:image"><meta property="og:title" content="셔츠 &amp; 타이"><meta property="product:price:amount" content="39,900">`;
    const r = parseProductHtml(html, "https://a.com/");
    expect(r.name).toBe("셔츠 & 타이");
    expect(r.image_url).toBe("https://cdn.example.com/x.jpg");
    expect(r.price).toBe(39900);
    expect(r.brand).toBeNull();
  });

  it("@graph 안의 Product도 찾는다", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"니트","offers":[{"price":59000}]}]}</script>`;
    expect(parseProductHtml(html, "https://a.com/").price).toBe(59000);
  });
});

describe("parseForecast", () => {
  it("일교차를 계산한다", () => {
    const w = parseForecast(
      {
        current: { temperature_2m: 12.3 },
        daily: { time: ["2026-11-14"], temperature_2m_max: [16.4], temperature_2m_min: [4.1], precipitation_probability_max: [30], weather_code: [3] },
      },
      "서울",
    );
    expect(w.diurnal_range).toBe(12.3);
    expect(w.description).toBe("흐림");
    expect(w.location_name).toBe("서울");
  });
});

describe("session token", () => {
  it("올바른 토큰만 통과한다", async () => {
    const now = 1_700_000_000_000;
    const t = await createSessionToken("secret", now);
    expect(await verifySessionToken("secret", t, now + 1000)).toBe(true);
    expect(await verifySessionToken("other", t, now + 1000)).toBe(false);
    const tampered = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0");
    expect(await verifySessionToken("secret", tampered, now)).toBe(false);
    expect(await verifySessionToken("secret", t, now + 181 * 86400 * 1000)).toBe(false);
    expect(await verifySessionToken("secret", undefined)).toBe(false);
  });
});

describe("sanitizeOutfits", () => {
  it("없는 id를 지우고 너무 작은 코디는 버린다", () => {
    const r = sanitizeOutfits(
      [
        { title: "a", reason: "", item_ids: ["1", "2", "fake", "2"] },
        { title: "b", reason: "", item_ids: ["1", "fake"] },
      ],
      new Set(["1", "2"]),
    );
    expect(r).toEqual([{ title: "a", reason: "", item_ids: ["1", "2"] }]);
  });
});

describe("todayKST", () => {
  it("UTC 15시 이후는 한국 날짜로 다음 날", () => {
    expect(todayKST(new Date("2026-11-14T15:30:00Z"))).toBe("2026-11-15");
    expect(todayKST(new Date("2026-11-14T14:30:00Z"))).toBe("2026-11-14");
  });
});
