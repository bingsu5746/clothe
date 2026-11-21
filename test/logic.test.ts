import { describe, expect, it } from "vitest";
import type { Item, OotdPiece } from "../shared/types";
import { signedImagePath, verifySignedImage } from "../worker/lib/auth";
import { coerceLinks, coerceValidation, rowToItem, rowToLog, rowToWish } from "../worker/lib/db";
import { costPerWear, findDormantItems } from "../worker/lib/dormant";
import { buildGeminiBody, extractJsonText, parseGeminiJsonResponse } from "../worker/lib/gemini";
import { applyVerification, ootdPrompt, ootdVerifyPrompt, pickVerifyTargets, sanitizeOotd, suggestedItemIds } from "../worker/lib/ootd";
import { colorPrompt, normalizeHex, profileForPrompt, rowToProfile, sanitizeBodyAnalysis, sanitizeColorAnalysis, sanitizePalette, sanitizeSamples } from "../worker/lib/profile";
import { naverShoppingUrl, parseNaverShopping, shoppingLinks, stripTags, toRecommendedLinks, wishSearchQuery } from "../worker/lib/shopping";
import { coerceOutfits, sanitizeOutfits, similarPrompt, todayPrompt } from "../worker/lib/stylist";
import { buildChecklist, buildTripWeather, coerceChecklist, forecastWindow, parseTripForecast, sanitizeTripPlan, tripDates, tripForecastUrl, tripPrompt } from "../worker/lib/trips";
import {
  DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_REPLICATE_MODEL, geminiTryOnBody, idmCategory, imageExtension, parseGeminiImageResponse, parseReplicatePrediction, replicateCreateBody,
  tryOnAvailability,
} from "../worker/lib/tryon";
import { addDays, daysBetween, HttpError, isDateString, isPublicHttpUrl } from "../worker/lib/util";
import { isImageKey, optBool, optDate, optEnum, optIdArray, optImageKey, optInt, optNum, optStr, optStrArray, optUrl, reqStr } from "../worker/lib/validate";
import { computeValidation, scoreLabel, validatePrompt, validationComment } from "../worker/lib/validator";
import { computeWearChanges, sameItemSet } from "../worker/lib/wear";
import { isForecast, parseGeocode } from "../worker/lib/weather";

function item(over: Partial<Item> & { id: string }): Item {
  return {
    name: `옷 ${over.id}`, brand: null, category: "top", sub_category: null, colors: [], material: null, fit: null, season: [], style_tags: [], warmth: null,
    image_key: null, original_shop_url: null, purchase_price: null, wear_count: 0, last_worn_date: null, notes: null, created_at: "2026-01-01 00:00:00", ...over,
  };
}

function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
  return 200;
}

describe("validate helpers", () => {
  it("optStr: 없음/null/빈 문자열/길이/타입", () => {
    expect(optStr({}, "a")).toBeUndefined();
    expect(optStr({ a: null }, "a")).toBeNull();
    expect(optStr({ a: "  " }, "a")).toBeNull();
    expect(optStr({ a: " x " }, "a")).toBe("x");
    expect(status(() => optStr({ a: 1 }, "a"))).toBe(400);
    expect(status(() => optStr({ a: "abcdef" }, "a", 3))).toBe(400);
    expect(status(() => reqStr({}, "a"))).toBe(400);
  });

  it("optNum/optInt: 범위와 정수 검사", () => {
    expect(optNum({ a: "12.5" }, "a")).toBe(12.5);
    expect(optInt({ a: 3 }, "a", { min: 1, max: 5 })).toBe(3);
    expect(optInt({ a: "" }, "a")).toBeNull();
    for (const bad of [{ a: 1.5 }, { a: 0 }, { a: 6 }, { a: "x" }, { a: {} }, { a: NaN }]) {
      expect(status(() => optInt(bad, "a", { min: 1, max: 5 }))).toBe(400);
    }
  });

  it("optBool / optEnum / optDate", () => {
    expect(optBool({ a: true }, "a")).toBe(true);
    expect(status(() => optBool({ a: "true" }, "a"))).toBe(400);
    expect(optEnum({ a: "x" }, "a", ["x", "y"] as const)).toBe("x");
    expect(status(() => optEnum({ a: "z" }, "a", ["x", "y"] as const))).toBe(400);
    expect(optDate({ a: "2026-02-28" }, "a")).toBe("2026-02-28");
    expect(status(() => optDate({ a: "2026-02-30" }, "a"))).toBe(400);
    expect(status(() => optDate({ a: "26-2-3" }, "a"))).toBe(400);
  });

  it("optStrArray / optIdArray: 중복 제거, 개수·타입 제한", () => {
    expect(optStrArray({ a: ["x", " x ", "", "y"] }, "a")).toEqual(["x", "y"]);
    expect(optStrArray({ a: null }, "a")).toEqual([]);
    expect(status(() => optStrArray({ a: "x" }, "a"))).toBe(400);
    expect(status(() => optStrArray({ a: [1] }, "a"))).toBe(400);
    expect(status(() => optIdArray({ a: ["1", "2", "3"] }, "a", 2))).toBe(400);
  });

  it("이미지 key와 URL 검증", () => {
    expect(isImageKey("img/0b1c-22.webp")).toBe(true);
    expect(isImageKey("tryon/abc.png")).toBe(true);
    for (const bad of ["../secret", "img/../x", "img/a/b.png", "other/x.png", "img/", 5, null]) expect(isImageKey(bad)).toBe(false);
    expect(status(() => optImageKey({ a: "x" }, "a"))).toBe(400);
    expect(optUrl({ a: "https://shop.example.com/p/1" }, "a")).toBe("https://shop.example.com/p/1");
    expect(status(() => optUrl({ a: "javascript:alert(1)" }, "a"))).toBe(400);
  });

  it("isPublicHttpUrl: 로컬/사설 주소 거절", () => {
    expect(isPublicHttpUrl("https://www.musinsa.com/products/1")).toBe(true);
    for (const bad of ["ftp://a.com", "http://localhost:8787", "http://127.0.0.1/x", "http://10.0.0.1", "http://192.168.0.5", "http://172.16.3.3", "http://169.254.169.254/", "http://[::1]/", "http://x.internal/", "nope"]) {
      expect(isPublicHttpUrl(bad), bad).toBe(false);
    }
  });

  it("날짜 도우미", () => {
    expect(isDateString("2024-02-29")).toBe(true);
    expect(isDateString("2026-02-29")).toBe(false);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-11-01", "2026-11-04")).toBe(3);
  });
});

describe("row mappers: 깨진 JSON 컬럼도 안전하게", () => {
  it("items / logs / wishlist", () => {
    const i = rowToItem({ id: "1", name: "셔츠", category: "weird", colors: "{broken", season: '["fall","nope"]', style_tags: "[1,\"미니멀\"]", wear_count: 2, created_at: "x" });
    expect(i.category).toBe("top");
    expect(i.colors).toEqual([]);
    expect(i.season).toEqual(["fall"]);
    expect(i.style_tags).toEqual(["미니멀"]);
    expect(rowToLog({ id: "l", worn_date: "2026-11-01", item_ids: "nope", occasion_tags: null }).item_ids).toEqual([]);
    const w = rowToWish({ id: "w", name: "코트", colors: "[]", status: "??", validation: '{"score":"x"}', recommended_links: '[{"url":"javascript:1"},{"url":"https://a.com","title":"A"}]' });
    expect(w.status).toBe("wanted");
    expect(w.validation).toBeNull();
    expect(w.recommended_links).toEqual([{ title: "A", url: "https://a.com", source: "custom", price: null, image_url: null, mall: null }]);
  });

  it("coerceLinks는 http(s)만 남긴다", () => {
    expect(coerceLinks([{ url: "data:text/html,x" }, "x", { url: "http://a.com" }]).map((l) => l.url)).toEqual(["http://a.com"]);
    expect(coerceValidation(null)).toBeNull();
  });
});

describe("착용 횟수 규칙 (computeWearChanges)", () => {
  const w = (id: string, wear_count: number, last_worn_date: string | null, base_last_worn_date: string | null = null) => ({ id, wear_count, last_worn_date, base_last_worn_date });

  it("기록 추가: +1, 마지막 착용일 갱신", () => {
    expect(computeWearChanges(null, { worn_date: "2026-11-10", item_ids: ["a"] }, [], [w("a", 0, null)])).toEqual([{ id: "a", wear_count: 1, last_worn_date: "2026-11-10" }]);
  });

  it("같은 날 다른 기록에 이미 있는 옷은 다시 세지 않는다", () => {
    const others = [{ worn_date: "2026-11-10", item_ids: ["a", "b"] }];
    const items = [w("a", 1, "2026-11-10"), w("c", 0, null)];
    expect(computeWearChanges(null, { worn_date: "2026-11-10", item_ids: ["a", "c"] }, others, items)).toEqual([{ id: "c", wear_count: 1, last_worn_date: "2026-11-10" }]);
  });

  it("과거 날짜 기록 추가: 횟수는 오르지만 마지막 착용일은 뒤로 가지 않는다", () => {
    const r = computeWearChanges(null, { worn_date: "2026-10-01", item_ids: ["a"] }, [], [w("a", 4, "2026-11-01", "2026-11-01")]);
    expect(r).toEqual([{ id: "a", wear_count: 5, last_worn_date: "2026-11-01" }]);
  });

  it("기록 삭제: -1, 마지막 착용일은 남은 기록 중 가장 늦은 날로", () => {
    const others = [{ worn_date: "2026-11-01", item_ids: ["a"] }, { worn_date: "2026-10-20", item_ids: ["a"] }];
    const r = computeWearChanges({ worn_date: "2026-11-10", item_ids: ["a"] }, null, others, [w("a", 3, "2026-11-10")]);
    expect(r).toEqual([{ id: "a", wear_count: 2, last_worn_date: "2026-11-01" }]);
  });

  it("삭제: 같은 날 다른 기록이 남아 있으면 그대로", () => {
    const others = [{ worn_date: "2026-11-10", item_ids: ["a"] }];
    expect(computeWearChanges({ worn_date: "2026-11-10", item_ids: ["a"] }, null, others, [w("a", 1, "2026-11-10")])).toEqual([]);
  });

  it("삭제: 0 아래로 내려가지 않고, 기록도 기준값도 없으면 마지막 착용일은 null", () => {
    expect(computeWearChanges({ worn_date: "2026-11-10", item_ids: ["a"] }, null, [], [w("a", 0, "2026-11-10")])).toEqual([{ id: "a", wear_count: 0, last_worn_date: null }]);
  });

  it("삭제: 기록 밖에서 알던 날짜(기준값)로 되돌아간다 — 업그레이드 전 데이터 보존", () => {
    // 예전부터 3/1에 입었다고 돼 있던 옷을 11/1 기록에 넣었다가 그 기록을 지운 경우
    const r = computeWearChanges({ worn_date: "2026-11-01", item_ids: ["a"] }, null, [], [w("a", 3, "2026-11-01", "2026-03-01")]);
    expect(r).toEqual([{ id: "a", wear_count: 2, last_worn_date: "2026-03-01" }]);
  });

  it("삭제: 직접 입력한 더 늦은 마지막 착용일은 건드리지 않는다", () => {
    const r = computeWearChanges({ worn_date: "2026-11-01", item_ids: ["a"] }, null, [], [w("a", 5, "2026-11-12", "2026-11-12")]);
    expect(r).toEqual([{ id: "a", wear_count: 4, last_worn_date: "2026-11-12" }]);
  });

  it("수정: 옷 교체 → 빠진 옷 -1, 들어온 옷 +1, 그대로인 옷은 변화 없음", () => {
    const items = [w("a", 2, "2026-11-10"), w("b", 1, "2026-11-10"), w("c", 0, null)];
    const r = computeWearChanges({ worn_date: "2026-11-10", item_ids: ["a", "b"] }, { worn_date: "2026-11-10", item_ids: ["a", "c"] }, [], items);
    expect(r).toEqual([{ id: "b", wear_count: 0, last_worn_date: null }, { id: "c", wear_count: 1, last_worn_date: "2026-11-10" }]);
  });

  it("수정: 날짜만 앞당기면 횟수는 그대로, 마지막 착용일만 따라간다", () => {
    const r = computeWearChanges({ worn_date: "2026-11-10", item_ids: ["a"] }, { worn_date: "2026-11-08", item_ids: ["a"] }, [], [w("a", 1, "2026-11-10")]);
    expect(r).toEqual([{ id: "a", wear_count: 1, last_worn_date: "2026-11-08" }]);
  });

  it("수정: 이미 다른 기록이 있는 날짜로 옮기면 그 날 중복이 되어 -1", () => {
    const others = [{ worn_date: "2026-11-08", item_ids: ["a"] }];
    const r = computeWearChanges({ worn_date: "2026-11-10", item_ids: ["a"] }, { worn_date: "2026-11-08", item_ids: ["a"] }, others, [w("a", 2, "2026-11-10")]);
    expect(r).toEqual([{ id: "a", wear_count: 1, last_worn_date: "2026-11-08" }]);
  });

  it("sameItemSet은 순서를 무시한다", () => {
    expect(sameItemSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameItemSet(["a"], ["a", "b"])).toBe(false);
  });
});

describe("장롱템 (findDormantItems)", () => {
  const today = "2026-11-15";
  it("기준별로 골라내고 점수 순으로 정렬한다", () => {
    const items = [
      item({ id: "fresh", created_at: "2026-11-10 00:00:00" }), // 등록한 지 얼마 안 됨 → 제외
      item({ id: "never", created_at: "2026-08-01 00:00:00" }), // 한 번도 안 입음
      item({ id: "old", wear_count: 5, last_worn_date: "2026-05-01", created_at: "2025-01-01 00:00:00" }), // 오래 안 입음
      item({ id: "recent", wear_count: 5, last_worn_date: "2026-11-01", created_at: "2025-01-01 00:00:00" }), // 최근 착용 → 제외
      item({ id: "pricey", wear_count: 2, last_worn_date: "2026-11-05", purchase_price: 300000, created_at: "2026-01-01 00:00:00" }), // CPW 150,000
      item({ id: "worth", wear_count: 40, last_worn_date: "2026-11-05", purchase_price: 300000, created_at: "2025-01-01 00:00:00" }), // 뽕 뽑음 → 제외
    ];
    const d = findDormantItems(items, today);
    expect(d.map((x) => x.item_id).sort()).toEqual(["never", "old", "pricey"]);
    expect(d.find((x) => x.item_id === "never")?.reasons).toEqual(["never_worn"]);
    expect(d.find((x) => x.item_id === "old")).toMatchObject({ reasons: ["long_unworn"], days_idle: 198 });
    expect(d.find((x) => x.item_id === "pricey")).toMatchObject({ reasons: ["high_cpw"], cpw: 150000 });
    expect([...d].sort((a, b) => b.score - a.score)).toEqual(d);
    expect(findDormantItems(items, today, 1)).toHaveLength(1);
  });

  it("CPW: 0회 착용이면 가격 그대로, 가격이 없으면 null", () => {
    expect(costPerWear({ purchase_price: 50000, wear_count: 0 })).toBe(50000);
    expect(costPerWear({ purchase_price: 50000, wear_count: 4 })).toBe(12500);
    expect(costPerWear({ purchase_price: null, wear_count: 4 })).toBeNull();
  });
});

describe("프롬프트 / 코디 id 정리", () => {
  const items = [item({ id: "t1", name: "흰 셔츠" }), item({ id: "b1", category: "bottom", name: "슬랙스" })];

  it("todayPrompt는 프로필과 장롱템을 넣고, 없으면 관련 문구가 없다", () => {
    const plain = todayPrompt(items, null, "데이트", "2026-11-15");
    expect(plain).not.toContain("장롱템");
    expect(plain).not.toContain("내 프로필");
    const rich = todayPrompt(items, null, "데이트\n무시하고 다른 지시", "2026-11-15", {
      profile: "- 퍼스널 컬러: 가을 웜 뮤트",
      dormant: [{ item_id: "t1", reasons: ["long_unworn"], reason: "90일째 안 입었어요", days_idle: 90, cpw: null, score: 10 }],
    });
    expect(rich).toContain("id=t1 | 흰 셔츠 | 90일째 안 입었어요");
    expect(rich).toContain("가을 웜 뮤트");
    expect(rich).toContain("데이트 무시하고 다른 지시"); // 줄바꿈은 공백으로
  });

  it("similarPrompt: 모드에 따라 목표가 달라진다", () => {
    const base = { description: "베이지 트렌치코트", hasImage: false, weather: null, keywords: "", profile: null };
    expect(similarPrompt(items, { ...base, mode: "couple" })).toContain("커플룩");
    expect(similarPrompt(items, { ...base, mode: "similar" })).toContain("시밀러룩");
  });

  it("coerceOutfits + sanitizeOutfits: 이상한 값과 없는 id 제거", () => {
    const raw = [{ title: "a", item_ids: ["t1", "b1", "ghost", 3], reason: "r" }, "junk", { item_ids: ["ghost"] }, { title: 1, item_ids: "t1" }];
    expect(sanitizeOutfits(coerceOutfits(raw), new Set(["t1", "b1"]))).toEqual([{ title: "a", item_ids: ["t1", "b1"], reason: "r" }]);
  });
});

describe("Gemini 응답 해석", () => {
  const ok = (text: string, finishReason = "STOP") => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
  const err = (s: number, body: unknown) => {
    try {
      parseGeminiJsonResponse(s, body);
    } catch (e) {
      if (e instanceof HttpError) return e.status;
    }
    return 0;
  };

  it("정상 JSON과 ```json 감싼 응답", () => {
    expect(parseGeminiJsonResponse(200, ok('{"a":1}'))).toEqual({ a: 1 });
    expect(parseGeminiJsonResponse(200, ok('```json\n{"a":2}\n```'))).toEqual({ a: 2 });
    expect(extractJsonText(" {} ")).toBe("{}");
  });

  it("오류 종류별 상태 코드", () => {
    expect(err(429, { error: { message: "quota" } })).toBe(429);
    expect(err(500, null)).toBe(502);
    expect(err(403, { error: { message: "key" } })).toBe(502);
    expect(err(200, { promptFeedback: { blockReason: "SAFETY" } })).toBe(422);
    expect(err(200, { candidates: [{ finishReason: "SAFETY" }] })).toBe(422);
    expect(err(200, ok('{"a":', "MAX_TOKENS"))).toBe(502);
    expect(err(200, ok("그냥 글"))).toBe(502);
    expect(err(200, {})).toBe(502);
    expect(err(200, "nope")).toBe(502);
  });

  it("요청 본문: 이미지가 글보다 먼저, JSON 스키마 지정", () => {
    const body = buildGeminiBody("p", { type: "OBJECT" }, [{ mimeType: "image/webp", data: new Uint8Array([1, 2, 3]) }], 0.2);
    expect(body).toEqual({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/webp", data: "AQID" } }, { text: "p" }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT" }, temperature: 0.2 },
    });
  });
});

describe("프로필 진단 정리", () => {
  it("HEX 정규화", () => {
    expect(normalizeHex("#a1b2c3")).toBe("#A1B2C3");
    expect(normalizeHex("abc")).toBe("#AABBCC");
    for (const bad of ["#12", "red", "#GGGGGG", 123, null]) expect(normalizeHex(bad)).toBeNull();
    expect(sanitizePalette([{ hex: "#fff", name: "화이트" }, { hex: "zzz" }, { hex: "FFFFFF", name: "중복" }, "x"])).toEqual([{ hex: "#FFFFFF", name: "화이트" }]);
    expect(sanitizeSamples({ skin: "#e8c4a0", hair: "zzz", eye: 3 })).toEqual({ skin: "#E8C4A0" });
  });

  const raw = {
    season: "AUTUMN", sub_tone: "뮤트", undertone: "warm", summary: "s", skin_hex: "#111111", hair_hex: "#222", eye_hex: "nope",
    best_colors: [{ hex: "#8B5A2B", name: "카멜" }], worst_colors: [{ hex: "#FF00FF", name: "마젠타" }], tips: ["t"], confidence: "HIGH", caveat: "",
  };

  it("컬러 진단: 라벨 생성, 클라이언트 측정값 우선", () => {
    const a = sanitizeColorAnalysis(raw, { skin: "#E8C4A0" }, "img/f.webp", "2026-11-15T00:00:00Z");
    expect(a).toMatchObject({ season: "autumn", sub_tone: "뮤트", label: "가을 웜 뮤트", skin_hex: "#E8C4A0", hair_hex: "#222222", eye_hex: null, hex_source: "client", confidence: "high" });
    expect(sanitizeColorAnalysis(raw, {}, "img/f.webp", "t")?.hex_source).toBe("ai");
    expect(sanitizeColorAnalysis({ ...raw, season: "monsoon" }, {}, "img/f.webp", "t")).toBeNull();
    expect(sanitizeColorAnalysis({ ...raw, best_colors: [] }, {}, "img/f.webp", "t")).toBeNull();
    expect(colorPrompt({ skin: "#E8C4A0" })).toContain("피부 #E8C4A0");
    expect(colorPrompt({})).toContain("추정");
  });

  it("체형 진단과 프로필 요약", () => {
    const body = sanitizeBodyAnalysis({ body_type: "wave", proportions: "p", features: ["f"], fit_tips: ["하이웨이스트"], avoid: ["박시"], confidence: "low", caveat: "c" }, "img/b.webp", "t");
    expect(body).toMatchObject({ body_type: "wave", body_type_label: "웨이브", confidence: "low" });
    expect(sanitizeBodyAnalysis({ body_type: "pear" }, "img/b.webp", "t")).toBeNull();

    const color = sanitizeColorAnalysis(raw, {}, "img/f.webp", "t");
    const p = rowToProfile({ height_cm: 170, face_image_key: "img/other.webp", body_image_key: "img/b.webp", mannequin_images: '["img/m.webp","../x"]', color_analysis: JSON.stringify(color), body_analysis: JSON.stringify(body), version: 3 });
    expect(p).toMatchObject({ personal_color: "가을 웜 뮤트", body_type: "wave", mannequin_images: ["img/m.webp"], color_analysis_stale: true, body_analysis_stale: false, version: 3 });
    expect(p.best_colors).toEqual([{ hex: "#8B5A2B", name: "카멜" }]);
    const text = profileForPrompt(p);
    expect(text).toContain("가을 웜 뮤트");
    expect(text).toContain("하이웨이스트");
    expect(profileForPrompt(rowToProfile(null))).toBeNull();
    expect(rowToProfile({ color_analysis: "{broken" }).color_analysis).toBeNull();
  });
});

describe("살까 말까 점수 (computeValidation)", () => {
  const ctx = { validIds: new Set(["a", "b", "c"]), hasColorProfile: true, hasBodyProfile: true, now: "t" };
  const outfit = (ids: string[]) => ({ title: "o", item_ids: ids, reason: "r" });

  it("만점: 중복 없음 + 코디 5개 + 색/핏 최고", () => {
    const v = computeValidation({ similar: [], outfits: Array.from({ length: 5 }, () => outfit(["NEW", "a"])), color_level: "best", body_level: "great", verdict: "v" }, ctx);
    expect(v.score).toBe(100);
    expect(v.label).toBe("강력 추천");
    expect(v.breakdown.synergy).toMatchObject({ score: 40, new_outfit_count: 5 });
  });

  it("중복 감점, 없는 id·NEW 없는 코디 제거", () => {
    const v = computeValidation(
      {
        similar: [{ item_id: "a", level: "same" }, { item_id: "b", level: "similar" }, { item_id: "ghost", level: "same" }, { item_id: "a", level: "same" }],
        outfits: [outfit(["NEW", "a"]), outfit(["a", "b"]), outfit(["NEW", "ghost"]), outfit(["NEW", "b", "c"])],
        color_level: "poor", body_level: "neutral",
      },
      ctx,
    );
    expect(v.breakdown.duplicate).toMatchObject({ score: 2, similar: [{ item_id: "a", level: "same" }, { item_id: "b", level: "similar" }] });
    expect(v.breakdown.synergy).toMatchObject({ score: 20, new_outfit_count: 2 });
    expect(v.breakdown.personal_color).toMatchObject({ score: 3, level: "poor" });
    expect(v.breakdown.body_fit.score).toBe(8);
    expect(v.score).toBe(33); // (2+20+3+8)/100
    expect(v.label).toBe("비추천");
  });

  it("프로필이 없으면 그 항목을 빼고 환산하고 '프로필 없음'이라고 적는다", () => {
    const v = computeValidation({ similar: [], outfits: [outfit(["NEW", "a"]), outfit(["NEW", "b"])], color_level: "best", body_level: "great" }, { ...ctx, hasColorProfile: false, hasBodyProfile: false });
    expect(v.breakdown.personal_color).toMatchObject({ score: null, available: false, level: null });
    expect(v.breakdown.personal_color.comment).toContain("프로필 없음");
    expect(v.breakdown.body_fit.comment).toContain("프로필 없음");
    expect(v.score).toBe(71); // (30+20)/70
    expect(validationComment(v)).toContain("새 코디 2개");
  });

  it("엉망인 응답도 0~100 안에서 계산된다", () => {
    const v = computeValidation("garbage", ctx);
    expect(v.score).toBeGreaterThanOrEqual(0);
    expect(v.score).toBeLessThanOrEqual(100);
    expect(v.breakdown.synergy.new_outfit_count).toBe(0);
    expect([scoreLabel(80), scoreLabel(60), scoreLabel(40), scoreLabel(39)]).toEqual(["강력 추천", "추천", "고민 필요", "비추천"]);
    expect(validatePrompt([], "코트", null, false)).toContain("프로필이 없으니");
  });
});

describe("OOTD 매칭 정리", () => {
  const valid = new Set(["a", "b", "c"]);
  const raw = {
    summary: "s",
    pieces: [
      { category: "top", description: "흰 셔츠", candidates: [{ item_id: "b", confidence: 0.6 }, { item_id: "a", confidence: 70 }, { item_id: "ghost", confidence: 0.99 }, { item_id: "a", confidence: 0.1 }] },
      { category: "???", description: "모자", candidates: [] },
      { category: "bottom", description: "청바지", candidates: [{ item_id: "c", confidence: 0.2 }] },
    ],
  };

  it("없는 id 제거, 0~100 confidence 보정, 정렬", () => {
    const r = sanitizeOotd(raw, valid);
    expect(r.pieces[0].candidates).toEqual([{ item_id: "a", confidence: 0.7 }, { item_id: "b", confidence: 0.6 }]);
    expect(r.pieces[1]).toMatchObject({ category: "accessory", candidates: [] });
    expect(suggestedItemIds(r.pieces)).toEqual(["a"]); // c는 0.2라 제외
    expect(sanitizeOotd(null, valid)).toEqual({ summary: "", pieces: [] });
    expect(ootdPrompt([item({ id: "a" })])).toContain("id=a");
  });

  it("사진 대조 대상 선정과 결과 반영", () => {
    const pieces: OotdPiece[] = sanitizeOotd(raw, valid).pieces;
    const targets = pickVerifyTargets(pieces, (id) => id !== "c");
    expect(targets).toEqual([{ piece: 0, item_ids: ["a", "b"] }]);
    expect(pickVerifyTargets(pieces, () => false)).toEqual([]);
    expect(pickVerifyTargets([{ category: "top", description: "", candidates: [{ item_id: "a", confidence: 0.95 }, { item_id: "b", confidence: 0.3 }] }], () => true)).toEqual([]);
    expect(ootdVerifyPrompt(pieces, targets, ["a", "b"])).toContain("사진 3: id=b");

    const picked = applyVerification(pieces, targets, { picks: [{ piece: 0, item_id: "b", confidence: 0.9 }, { piece: 2, item_id: "c", confidence: 1 }, { piece: 0, item_id: "ghost", confidence: 1 }] });
    expect(picked[0].candidates).toEqual([{ item_id: "b", confidence: 0.9 }, { item_id: "a", confidence: 0.4 }]);
    expect(picked[2].candidates).toEqual([{ item_id: "c", confidence: 0.2 }]); // 대상이 아닌 piece는 그대로
    const none = applyVerification(pieces, targets, { picks: [{ piece: 0, item_id: "", confidence: 0.9 }] });
    expect(suggestedItemIds(none)).toEqual([]);
    expect(pieces[0].candidates[0]).toEqual({ item_id: "a", confidence: 0.7 }); // 원본은 안 바뀜
  });
});

describe("여행 짐 싸기", () => {
  it("날짜 목록과 예보 가능 구간", () => {
    expect(tripDates("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    const dates = tripDates("2026-11-27", "2026-12-02");
    expect(forecastWindow(dates, "2026-11-15")).toEqual({ start: "2026-11-27", end: "2026-11-29" }); // 오늘+14일까지만
    expect(forecastWindow(tripDates("2027-03-01", "2027-03-04"), "2026-11-15")).toBeNull();
    expect(forecastWindow(tripDates("2026-11-10", "2026-11-17"), "2026-11-15")).toEqual({ start: "2026-11-15", end: "2026-11-17" }); // 지난 날은 제외
    // 경계: 오늘+13·+14 는 예보 요청, +15·+16 은 범위 밖 (Open-Meteo 는 오늘+15 를 넘으면 400)
    const today = "2026-11-21";
    expect(forecastWindow(tripDates("2026-12-04", "2026-12-07"), today)).toEqual({ start: "2026-12-04", end: "2026-12-05" });
    expect(forecastWindow(["2026-12-05"], today)).toEqual({ start: "2026-12-05", end: "2026-12-05" }); // +14
    expect(forecastWindow(["2026-12-06"], today)).toBeNull(); // +15
    expect(forecastWindow(["2026-12-07"], today)).toBeNull(); // +16
    const url = new URL(tripForecastUrl(35.68, 139.69, "2026-11-20", "2026-11-23"));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ start_date: "2026-11-20", end_date: "2026-11-23", timezone: "auto" });
  });

  it("예보 파싱: 숫자가 빠진 날은 버리고 상태를 정직하게 표시", () => {
    const days = parseTripForecast({
      daily: { time: ["2026-11-20", "2026-11-21", "bad"], temperature_2m_max: [12.9, null, 3], temperature_2m_min: [5.6, 3, 1], precipitation_probability_max: [10, 0, 0], weather_code: [61, 0, 0] },
    });
    expect(days).toEqual([{ date: "2026-11-20", temp_min: 5.6, temp_max: 12.9, precip_probability: 10, weather_code: 61, description: "약한 비" }]);
    expect(parseTripForecast({ error: true, reason: "out of range" })).toEqual([]);
    expect(buildTripWeather(["2026-11-20"], days, "도쿄", null).status).toBe("forecast");
    expect(buildTripWeather(["2026-11-20", "2026-11-21"], days, "도쿄", null)).toMatchObject({ status: "partial", days });
    const none = buildTripWeather(["2027-03-01"], days, "도쿄", null);
    expect(none).toMatchObject({ status: "unavailable", days: [] });
    expect(none.message).toContain("예보");
    expect(buildTripWeather(["2027-03-01"], [], null, "위치를 못 찾음").message).toBe("위치를 못 찾음");
  });

  it("프롬프트: 예보 없는 날은 숫자 없이 '예보 없음'", () => {
    const weather = buildTripWeather(["2026-11-20", "2026-11-21"], [{ date: "2026-11-20", temp_min: 5, temp_max: 12, precip_probability: null, weather_code: 0, description: "맑음" }], "도쿄", null);
    const p = tripPrompt([item({ id: "a" })], { destination: "도쿄", dates: ["2026-11-20", "2026-11-21"], notes: "하루 2만 보", weather, profile: null });
    expect(p).toContain("1일차 (2026-11-20): 최저 5°C / 최고 12°C, 맑음");
    expect(p).toContain("2일차 (2026-11-21): 예보 없음");
    expect(p).toContain("지어내지 말고");
  });

  it("계획 정리: 없는 id 제거, 빠진 날 채우기, 캡슐은 일차별 옷을 포함", () => {
    const { plan, extras } = sanitizeTripPlan(
      { summary: "s", capsule_item_ids: ["a", "ghost"], days: [{ day: 2, item_ids: ["b", "ghost"], note: "n2" }, { day: 1, item_ids: ["a"], note: "n1" }, { day: 9, item_ids: ["a"] }, { day: 1, item_ids: ["c"] }], extras: ["충전기", "충전기", 3], tips: ["t"] },
      new Set(["a", "b", "c"]),
      ["2026-11-20", "2026-11-21", "2026-11-22"],
    );
    expect(plan.days).toEqual([
      { day: 1, date: "2026-11-20", item_ids: ["a"], note: "n1" },
      { day: 2, date: "2026-11-21", item_ids: ["b"], note: "n2" },
      { day: 3, date: "2026-11-22", item_ids: [], note: "" },
    ]);
    expect(plan.capsule_item_ids).toEqual(["a", "b"]);
    expect(extras).toEqual(["충전기"]);
  });

  it("체크리스트: 다시 만들어도 챙김 표시와 직접 추가한 준비물은 유지", () => {
    const names = new Map([["a", "셔츠"], ["b", "바지"]]);
    const first = buildChecklist(["a", "b"], names, ["충전기", "우산"], []);
    expect(first.map((e) => [e.kind, e.label, e.source])).toEqual([["item", "셔츠", "plan"], ["item", "바지", "plan"], ["extra", "충전기", "ai"], ["extra", "우산", "ai"]]);
    first[0].packed = true;
    first[2].packed = true;
    const mine = { id: "u1", kind: "extra" as const, item_id: null, label: "여권", packed: true, source: "user" as const };
    const second = buildChecklist(["a"], names, ["충전기", "여권"], [...first, mine]);
    expect(second.map((e) => [e.label, e.packed, e.source])).toEqual([["셔츠", true, "plan"], ["여권", true, "user"], ["충전기", true, "ai"]]);
    expect(second[0].id).toBe(first[0].id);
    expect(coerceChecklist([{ id: "x", kind: "item" }, { nope: 1 }, { id: "y", kind: "extra", label: "l", packed: "yes" }])).toEqual([
      { id: "x", kind: "extra", item_id: null, label: "", packed: false, source: "user" },
      { id: "y", kind: "extra", item_id: null, label: "l", packed: false, source: "user" },
    ]);
  });
});

describe("쇼핑 링크 / 네이버 응답", () => {
  it("키 없이 쓰는 검색 링크 형식", () => {
    expect(shoppingLinks("울 코트").map((l) => [l.source, l.url])).toEqual([
      ["naver_search", "https://search.shopping.naver.com/search/all?query=%EC%9A%B8%20%EC%BD%94%ED%8A%B8"],
      ["musinsa_search", "https://www.musinsa.com/search/goods?keyword=%EC%9A%B8%20%EC%BD%94%ED%8A%B8"],
      ["29cm_search", "https://www.29cm.co.kr/store/search?keyword=%EC%9A%B8%20%EC%BD%94%ED%8A%B8"],
    ]);
    expect(shoppingLinks("a&b=c")[1].url).toContain("keyword=a%26b%3Dc");
  });

  it("네이버 요청 URL: 문서의 파라미터와 범위", () => {
    const u = new URL(naverShoppingUrl("니트 가디건", 500));
    expect(u.origin + u.pathname).toBe("https://openapi.naver.com/v1/search/shop.json");
    expect(Object.fromEntries(u.searchParams)).toEqual({ query: "니트 가디건", display: "100", start: "1", sort: "sim", exclude: "used:rental" });
  });

  it("네이버 응답 파싱: <b> 제거, 0원은 null, 이상한 항목 제외", () => {
    const body = {
      total: 2,
      items: [
        { title: "울 <b>코트</b> &amp; 머플러", link: "https://smartstore.naver.com/x/1", image: "https://shopping-phinf.pstatic.net/1.jpg", lprice: "129000", hprice: "", mallName: "네이버", productId: "123", productType: "2", brand: "브랜드", maker: "", category1: "패션의류", category2: "여성의류", category3: "코트", category4: "" },
        { title: "가격 없음", link: "https://a.com/2", image: "", lprice: "0", productId: 77 },
        { title: "", link: "https://a.com/3" },
        { title: "나쁜 링크", link: "javascript:alert(1)" },
        "junk",
      ],
    };
    const r = parseNaverShopping(body);
    expect(r).toEqual([
      { title: "울 코트 & 머플러", url: "https://smartstore.naver.com/x/1", image_url: "https://shopping-phinf.pstatic.net/1.jpg", price: 129000, mall: "네이버", brand: "브랜드", category: ["패션의류", "여성의류", "코트"], product_id: "123" },
      { title: "가격 없음", url: "https://a.com/2", image_url: null, price: null, mall: null, brand: null, category: [], product_id: "77" },
    ]);
    expect(parseNaverShopping({ errorMessage: "x" })).toEqual([]);
    expect(stripTags("<b>a</b>&lt;b&gt;")).toBe("a<b>");
    const links = toRecommendedLinks({ query: "q", source: "naver", naver_enabled: true, results: r, links: shoppingLinks("q"), notice: null });
    expect(links.map((l) => l.source)).toEqual(["naver_item", "naver_item", "naver_search", "musinsa_search", "29cm_search"]);
  });

  it("위시리스트 검색어", () => {
    expect(wishSearchQuery({ name: "오버핏  울 코트", colors: ["카멜"] })).toBe("카멜 오버핏 울 코트");
    expect(wishSearchQuery({ name: "카멜 코트", colors: ["카멜"] })).toBe("카멜 코트");
  });
});

describe("가상 피팅", () => {
  const base = { TRYON_PROVIDER: "", TRYON_MODEL: "", REPLICATE_API_TOKEN: "", GEMINI_API_KEY: "" };

  it("설정에 따른 사용 가능 여부", () => {
    const off = tryOnAvailability(base);
    expect(off).toMatchObject({ available: false, provider: null, model: null });
    expect(off.reason).toBeTruthy();
    expect(off.setup_hint).toContain("REPLICATE_API_TOKEN");
    // Gemini 키만 있으면 자동으로 켜지지 않는다 (이미지 모델은 유료)
    expect(tryOnAvailability({ ...base, GEMINI_API_KEY: "k" }).available).toBe(false);
    expect(tryOnAvailability({ ...base, GEMINI_API_KEY: "k", TRYON_PROVIDER: "gemini" })).toEqual({ available: true, provider: "gemini", model: DEFAULT_GEMINI_IMAGE_MODEL, reason: null, setup_hint: null });
    expect(tryOnAvailability({ ...base, TRYON_PROVIDER: "gemini" }).available).toBe(false);
    expect(tryOnAvailability({ ...base, REPLICATE_API_TOKEN: "r" })).toMatchObject({ available: true, provider: "replicate", model: DEFAULT_REPLICATE_MODEL });
    expect(tryOnAvailability({ ...base, TRYON_PROVIDER: "replicate" }).available).toBe(false);
    expect(tryOnAvailability({ ...base, REPLICATE_API_TOKEN: "r", TRYON_MODEL: "o/m:v" }).model).toBe("o/m:v");
    expect(tryOnAvailability({ ...base, REPLICATE_API_TOKEN: "r", TRYON_PROVIDER: "dalle" }).available).toBe(false);
  });

  it("IDM-VTON 카테고리 매핑과 요청 본문", () => {
    expect([idmCategory("top"), idmCategory("outer"), idmCategory("bottom"), idmCategory("dress"), idmCategory(null)]).toEqual(["upper_body", "upper_body", "lower_body", "dresses", "upper_body"]);
    expect([idmCategory("shoes"), idmCategory("bag"), idmCategory("accessory")]).toEqual([null, null, null]);
    expect(replicateCreateBody("o/m:v", { human_img: "h", garm_img: "g", garment_des: "d", category: "upper_body", crop: true })).toEqual({
      version: "o/m:v",
      input: { human_img: "h", garm_img: "g", garment_des: "d", category: "upper_body", crop: true },
    });
  });

  it("Replicate prediction 파싱", () => {
    expect(parseReplicatePrediction({ id: "p1", status: "processing", output: null, error: null })).toEqual({ id: "p1", status: "processing", output: null, error: null });
    expect(parseReplicatePrediction({ id: "p1", status: "succeeded", output: "https://replicate.delivery/x/out.png" })?.output).toBe("https://replicate.delivery/x/out.png");
    expect(parseReplicatePrediction({ id: "p1", status: "succeeded", output: ["https://replicate.delivery/a.png", "https://b"] })?.output).toBe("https://replicate.delivery/a.png");
    expect(parseReplicatePrediction({ id: "p1", status: "succeeded", output: "http://insecure/x.png" })?.output).toBeNull();
    expect(parseReplicatePrediction({ id: "p1", status: "failed", error: "NSFW" })).toMatchObject({ status: "failed", error: "NSFW" });
    expect(parseReplicatePrediction({ id: "p1", status: "weird" })).toBeNull();
    expect(parseReplicatePrediction({ detail: "Unauthenticated" })).toBeNull();
  });

  it("Gemini 이미지 응답 파싱 (camelCase/snake_case 모두)", () => {
    const img = parseGeminiImageResponse(200, { candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: "AQID" } }] } }] });
    expect(img.mimeType).toBe("image/png");
    expect([...img.data]).toEqual([1, 2, 3]);
    expect(parseGeminiImageResponse(200, { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: "AQID" } }] } }] }).mimeType).toBe("image/jpeg");
    const st = (s: number, b: unknown) => {
      try {
        parseGeminiImageResponse(s, b);
      } catch (e) {
        if (e instanceof HttpError) return e.status;
      }
      return 0;
    };
    expect(st(429, { error: { message: "quota" } })).toBe(429);
    expect(st(400, { error: { message: "bad" } })).toBe(502);
    expect(st(200, { promptFeedback: { blockReason: "OTHER" } })).toBe(422);
    expect(st(200, { candidates: [{ content: { parts: [{ text: "no image" }] }, finishReason: "IMAGE_SAFETY" }] })).toBe(422);
    expect(st(200, { candidates: [{ content: { parts: [{ text: "no image" }] }, finishReason: "STOP" }] })).toBe(502);
    const body = geminiTryOnBody({ mimeType: "image/webp", data: new Uint8Array([1]) }, { mimeType: "image/png", data: new Uint8Array([2]) }, "p");
    expect(body).toEqual({ contents: [{ parts: [{ inline_data: { mime_type: "image/png", data: "Ag==" } }, { inline_data: { mime_type: "image/webp", data: "AQ==" } }, { text: "p" }] }] });
    expect([imageExtension("image/jpeg"), imageExtension("image/png"), imageExtension("image/svg+xml")]).toEqual(["jpg", "png", "png"]);
  });

  it("서명된 이미지 주소: 만료/변조 거절", async () => {
    const now = 1_800_000_000_000;
    const path = await signedImagePath("secret", "img/a.webp", now);
    const [, , , , exp, sig, dir, name] = path.split("/");
    expect(`${dir}/${name}`).toBe("img/a.webp");
    expect(await verifySignedImage("secret", exp, sig, "img/a.webp", now + 60_000)).toBe(true);
    expect(await verifySignedImage("secret", exp, sig, "img/b.webp", now)).toBe(false);
    expect(await verifySignedImage("other", exp, sig, "img/a.webp", now)).toBe(false);
    expect(await verifySignedImage("secret", exp, sig, "img/a.webp", now + 16 * 60_000)).toBe(false);
    expect(await verifySignedImage("secret", "abc", sig, "img/a.webp", now)).toBe(false);
  });
});

describe("날씨 응답 검증", () => {
  it("isForecast / parseGeocode", () => {
    expect(isForecast({ daily: { time: ["2026-11-15"], temperature_2m_max: [10], temperature_2m_min: [1] } })).toBe(true);
    expect(isForecast({ daily: { time: [], temperature_2m_max: [], temperature_2m_min: [] } })).toBe(false);
    expect(isForecast({ error: true })).toBe(false);
    expect(parseGeocode({ results: [{ name: "도쿄", latitude: 35.6, longitude: 139.6, country: "일본", admin1: "도쿄 도" }, { name: "x" }, 3] })).toEqual([
      { name: "도쿄", latitude: 35.6, longitude: 139.6, country: "일본", admin1: "도쿄 도" },
    ]);
    expect(parseGeocode({})).toEqual([]);
  });
});
