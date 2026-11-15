import type { DormantItem, Item, SuggestedOutfit, Weather } from "../../shared/types";
import { wardrobeForPrompt } from "./db";
import { obj, OUTFIT_LIST_SCHEMA, S, type Schema } from "./gemini";
import { asArray, asString, asStringArray, isRecord } from "./validate";

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

/** 사용자가 입력한 글을 프롬프트에 넣기 전에 정리 (줄바꿈 제거, 길이 제한) */
export function cleanUserText(text: string | null | undefined, max = 300): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface TodayPromptExtras {
  /** profileForPrompt() 결과. 프로필이 없으면 null */
  profile?: string | null;
  dormant?: DormantItem[];
}

export function todayPrompt(items: Item[], w: Weather | null, keywords: string, today: string, extras: TodayPromptExtras = {}): string {
  const dormant = extras.dormant ?? [];
  const names = new Map(items.map((i) => [i.id, i.name]));
  return `너는 사용자의 개인 스타일리스트야. 아래 "내 옷장" 목록에 있는 옷만 사용해서 오늘 입을 코디 3가지를 추천해.

규칙:
- item_ids에는 반드시 아래 목록의 id만 넣어. 목록에 없는 옷을 지어내지 마.
- 각 코디는 최소한 (상의+하의) 또는 (원피스)를 포함하고, 신발이 옷장에 있으면 신발도 포함해.
- 날씨에 맞는 보온성(warmth)과 계절(season)을 고려해.
- 일교차가 10°C 이상이거나 아침 기온이 낮으면 벗고 입기 쉬운 아우터나 레이어드를 포함하고, 그 이유를 reason에 적어.
- 강수확률이 높으면 젖어도 괜찮은 신발/소재를 우선해.
- 최근에 입지 않았거나 착용 횟수(worn)가 적은 옷을 적당히 섞어 줘.
${
  dormant.length
    ? `- 아래 "장롱템" 중에서 오늘 날씨에 무리 없이 입을 수 있는 것을 골라 3가지 코디 중 최소 1개에 꼭 넣고, reason에 "오랜만에 꺼내 입기 좋다"는 식으로 어떤 옷인지 언급해. 날씨에 전혀 맞지 않는 장롱템뿐이면 억지로 넣지 마.\n`
    : ""
}${
    extras.profile
      ? `- 아래 "내 프로필"의 퍼스널 컬러와 체형 조언을 반영해. 얼굴 가까이 오는 상의/아우터는 잘 어울리는 색을 우선하고, 핏 조언에 맞는 실루엣을 골라. 반영한 점이 있으면 reason에 짧게 적어.\n`
      : ""
  }- 3가지 코디는 서로 분위기가 다르게.
- title은 짧은 코디 이름, reason은 왜 이 조합인지 한두 문장, briefing은 오늘 날씨 기준 옷차림 조언 한두 문장. 모두 한국어로.

오늘 날짜: ${today}
오늘 날씨: ${w ? weatherLine(w) : "정보 없음"}
사용자 요청/키워드: ${cleanUserText(keywords) || "없음"}
${extras.profile ? `\n내 프로필:\n${extras.profile}\n` : ""}${
    dormant.length ? `\n장롱템 (오래 안 입었거나 1회당 가격이 높은 옷):\n${dormant.map((d) => `id=${d.item_id} | ${names.get(d.item_id) ?? ""} | ${d.reason}`).join("\n")}\n` : ""
  }
내 옷장:
${wardrobeForPrompt(items)}`;
}

export const SIMILAR_SCHEMA: Schema = obj({ partner_summary: S.str, outfits: OUTFIT_LIST_SCHEMA });

export interface SimilarPromptInput {
  mode: "similar" | "couple";
  description: string;
  hasImage: boolean;
  weather: Weather | null;
  keywords: string;
  profile: string | null;
}

/** 시밀러룩/커플룩: 상대 옷차림(사진/설명)에 어울리는 내 코디 */
export function similarPrompt(items: Item[], input: SimilarPromptInput): string {
  const goal =
    input.mode === "couple"
      ? "나란히 섰을 때 커플룩으로 보이도록 색 조합, 소재감, 포인트 아이템을 맞춘"
      : "똑같이 맞춘 느낌은 피하면서 색감·소재·무드가 자연스럽게 통하는 시밀러룩";
  return `사용자가 친구나 연인과 함께 외출해. ${input.hasImage ? "첨부한 사진이 상대가 입을 옷차림이야." : ""}${
    input.description ? ` 상대 옷차림 설명: "${cleanUserText(input.description, 500)}"` : ""
  }
아래 "내 옷장"에 있는 옷만 사용해서 ${goal} 코디를 2~3가지 추천해.

규칙:
- partner_summary: 상대 옷차림의 색, 소재, 분위기를 한국어 한두 문장으로 요약해.
- item_ids에는 반드시 아래 목록의 id만 넣어. 목록에 없는 옷을 지어내지 마.
- 각 코디는 최소한 (상의+하의) 또는 (원피스)를 포함하고, 신발이 옷장에 있으면 신발도 포함해.
- reason에는 상대 옷의 어떤 요소(색/소재/무드)와 어떻게 맞췄는지 한두 문장으로 적어.
${input.weather ? "- 오늘 날씨에 맞는 보온성도 고려해.\n" : ""}${input.profile ? "- \"내 프로필\"의 퍼스널 컬러와 체형 조언도 가능하면 반영해.\n" : ""}- title, reason 모두 한국어로.

${input.weather ? `오늘 날씨: ${weatherLine(input.weather)}\n` : ""}사용자 요청/키워드: ${cleanUserText(input.keywords) || "없음"}
${input.profile ? `\n내 프로필:\n${input.profile}\n` : ""}
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

/** 신뢰할 수 없는 값(AI 응답, 캐시)을 SuggestedOutfit[] 모양으로 정리한다 */
export function coerceOutfits(v: unknown, max = 8): SuggestedOutfit[] {
  const out: SuggestedOutfit[] = [];
  for (const x of asArray(v)) {
    if (!isRecord(x)) continue;
    out.push({ title: asString(x.title, "추천 코디", 80) || "추천 코디", item_ids: asStringArray(x.item_ids, 12, 64), reason: asString(x.reason, "", 600) });
    if (out.length >= max) break;
  }
  return out;
}

/** AI가 돌려준 코디에서 존재하지 않는 id를 걸러낸다 */
export function sanitizeOutfits(outfits: SuggestedOutfit[], validIds: Set<string>, minItems = 2): SuggestedOutfit[] {
  return outfits
    .map((o) => ({ ...o, item_ids: [...new Set(o.item_ids.filter((id) => validIds.has(id)))] }))
    .filter((o) => o.item_ids.length >= minItems);
}
