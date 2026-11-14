import type { Item, SuggestedOutfit, Weather } from "../../shared/types";
import { wardrobeForPrompt } from "./db";

export function weatherLine(w: Weather): string {
  return [
    `최저 ${w.temp_min}°C / 최고 ${w.temp_max}°C`,
    w.temp_now != null ? `현재 ${w.temp_now}°C` : "",
    `일교차 ${w.diurnal_range}°C`,
    w.precip_probability != null ? `강수확률 ${w.precip_probability}%` : "",
    w.description,
  ]
    .filter(Boolean)
    .join(", ");
}

export function todayPrompt(items: Item[], w: Weather | null, keywords: string, today: string): string {
  return `너는 사용자의 개인 스타일리스트야. 아래 "내 옷장" 목록에 있는 옷만 사용해서 오늘 입을 코디 3가지를 추천해.

규칙:
- item_ids에는 반드시 아래 목록의 id만 넣어. 목록에 없는 옷을 지어내지 마.
- 각 코디는 최소한 (상의+하의) 또는 (원피스)를 포함하고, 신발이 옷장에 있으면 신발도 포함해.
- 날씨에 맞는 보온성(warmth)과 계절(season)을 고려해.
- 일교차가 10°C 이상이거나 아침 기온이 낮으면 벗고 입기 쉬운 아우터나 레이어드를 포함하고, 그 이유를 reason에 적어.
- 강수확률이 높으면 젖어도 괜찮은 신발/소재를 우선해.
- 최근에 입지 않았거나 착용 횟수(worn)가 적은 옷을 적당히 섞어 줘.
- 3가지 코디는 서로 분위기가 다르게.
- title은 짧은 코디 이름, reason은 왜 이 조합인지 한두 문장, briefing은 오늘 날씨 기준 옷차림 조언 한두 문장. 모두 한국어로.

오늘 날짜: ${today}
오늘 날씨: ${w ? weatherLine(w) : "정보 없음"}
사용자 요청/키워드: ${keywords.trim() || "없음"}

내 옷장:
${wardrobeForPrompt(items)}`;
}

export function inspirationPrompt(items: Item[]): string {
  return `이 사진은 사용자가 저장한 참고용 코디 사진이야. 사진 속 사람이 입고 있는 옷과 착용 소품을 하나씩 나눠서 분석해.

각 piece마다:
- category: outer, top, bottom, dress, shoes, bag, accessory 중 하나
- description: 한국어로 짧고 구체적인 설명 (예: "크롭 기장 아이보리 케이블 니트 가디건")
- colors: 한국어 색 이름 배열
- matched_item_ids: 아래 "내 옷장"에서 이 piece와 비슷해서 대신 입을 수 있는 옷의 id (없으면 빈 배열, 최대 3개). 목록에 없는 id는 절대 넣지 마.

summary에는 이 코디의 전체 분위기를 한국어 한두 문장으로 적어.

내 옷장:
${items.length ? wardrobeForPrompt(items) : "(비어 있음)"}`;
}

export function taggingPrompt(): string {
  return `이 사진 속 옷 한 벌을 분석해 JSON으로 답해. 모든 텍스트는 한국어로.
- name: 짧은 이름 (예: "네이비 오버핏 셔츠")
- category: outer, top, bottom, dress, shoes, bag, accessory 중 하나 (영어 그대로)
- sub_category: 세부 종류 (예: 셔츠, 슬랙스, 스니커즈)
- colors: 주색상부터 색 이름 배열
- material: 소재/원단 느낌
- fit: 핏 (예: 오버핏, 슬림핏, 레귤러핏)
- season: spring, summer, fall, winter 중 어울리는 것들 (영어 그대로)
- style_tags: 스타일 태그 2~5개 (예: 미니멀, 캐주얼, 스트릿)
- warmth: 보온성 1(아주 얇음)~5(아주 따뜻함) 정수`;
}

export function wishPrompt(items: Item[], wishDesc: string): string {
  return `사용자가 아래 "살까 말까 고민 중인 옷"을 사려고 해. id가 "NEW"인 것이 그 옷이야.
"내 옷장"에 있는 옷과 NEW를 조합해서 NEW를 사면 새로 만들 수 있는 코디를 최대 4개 제안해.

규칙:
- 모든 코디의 item_ids에는 반드시 "NEW"가 포함되어야 해.
- 나머지 id는 반드시 "내 옷장" 목록의 id만 사용해. 지어내지 마.
- 각 코디는 최소 (상의+하의) 또는 (원피스)를 이루도록 구성해.
- similar_item_ids: 내 옷장에 NEW와 거의 같은 역할(비슷한 디자인/색)의 옷이 있으면 그 id들. 없으면 빈 배열.
- verdict: 이 옷이 지금 옷장과 얼마나 잘 어울리는지, 비슷한 옷이 이미 있는지 한국어 두세 문장으로 솔직하게.
- title, reason도 한국어로.

살까 말까 고민 중인 옷 (id=NEW): ${wishDesc}

내 옷장:
${items.length ? wardrobeForPrompt(items) : "(비어 있음)"}`;
}

/** AI가 돌려준 코디에서 존재하지 않는 id를 걸러낸다 */
export function sanitizeOutfits(outfits: SuggestedOutfit[], validIds: Set<string>, minItems = 2): SuggestedOutfit[] {
  return outfits
    .map((o) => ({ ...o, item_ids: [...new Set(o.item_ids.filter((id) => validIds.has(id)))] }))
    .filter((o) => o.item_ids.length >= minItems);
}
