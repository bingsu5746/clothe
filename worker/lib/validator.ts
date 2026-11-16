import type { Item, PurchaseValidation, SuggestedOutfit } from "../../shared/types";
import { wardrobeForPrompt } from "./db";
import { arr, enumOf, obj, OUTFIT_LIST_SCHEMA, S, type Schema } from "./gemini";
import { coerceOutfits, sanitizeOutfits } from "./stylist";
import { asArray, asEnum, asRecord, asString, isRecord } from "./validate";

/**
 * 살까 말까 점수 계산 규칙 (docs/api-contract.md에도 같은 표가 있음)
 *
 * 항목별 만점: 중복 30 + 시너지 40 + 퍼스널 컬러 15 + 체형 15 = 100
 * - 중복(30): 30점에서 시작. "거의 같은 옷(same)" 하나당 -20, "비슷한 옷(similar)" 하나당 -8. 0 아래로는 안 내려감.
 * - 시너지(40): 이 옷으로 새로 만들 수 있는 코디 수 0/1/2/3/4/5개 이상 → 0/10/20/28/35/40점.
 * - 퍼스널 컬러(15): best 15 / good 12 / neutral 8 / poor 3 / worst 0.
 * - 체형(15): great 15 / good 11 / neutral 8 / poor 3.
 * - 프로필(진단 결과)이 없는 항목은 계산에서 빼고, 나머지 항목의 만점 합계로 나눠 100점 만점으로 환산한다.
 * 점수는 코드가 계산한다. AI는 "비슷한 옷이 무엇인지 / 어떤 코디가 가능한지 / 색·핏이 어느 등급인지"만 판단한다.
 */
export const SCORE_RULES = {
  duplicate: { max: 30, same: 20, similar: 8 },
  synergy: { max: 40, byCount: [0, 10, 20, 28, 35, 40] },
  color: { max: 15, levels: { best: 15, good: 12, neutral: 8, poor: 3, worst: 0 } },
  body: { max: 15, levels: { great: 15, good: 11, neutral: 8, poor: 3 } },
} as const;

const COLOR_LEVELS = ["best", "good", "neutral", "poor", "worst"] as const;
const BODY_LEVELS = ["great", "good", "neutral", "poor"] as const;
const DUP_LEVELS = ["same", "similar"] as const;
export const NO_PROFILE_COMMENT = "프로필 없음";

export const VALIDATE_SCHEMA: Schema = obj({
  verdict: S.str,
  similar: arr(obj({ item_id: S.str, level: enumOf(DUP_LEVELS) })),
  duplicate_comment: S.str,
  outfits: OUTFIT_LIST_SCHEMA,
  synergy_comment: S.str,
  color_level: enumOf(COLOR_LEVELS),
  color_comment: S.str,
  body_level: enumOf(BODY_LEVELS),
  body_comment: S.str,
});

export function validatePrompt(items: Item[], wishDesc: string, profile: string | null, hasImage: boolean): string {
  return `사용자가 아래 "살까 말까 고민 중인 옷"을 살지 고민하고 있어. id가 "NEW"인 것이 그 옷이야.${
    hasImage ? " 첨부한 사진이 그 옷(또는 그 옷이 나온 참고 사진)이야." : ""
  } 구매 전에 여러 각도로 판독해 줘. 모든 설명은 한국어로, 솔직하게.

1) 중복 판독
- similar: "내 옷장"에 NEW와 역할이 겹치는 옷이 있으면 적어. level은 same(종류·색·디자인이 거의 같아서 사실상 중복) 또는 similar(비슷하지만 다른 느낌으로 입을 수 있음). 없으면 빈 배열.
- duplicate_comment: 겹치는 옷이 있는지, 있다면 무엇이 얼마나 겹치는지 한두 문장.

2) 매칭 시너지
- outfits: NEW를 사면 "내 옷장" 옷과 새로 만들 수 있는 코디를 최대 5개. 모든 코디의 item_ids에 "NEW"를 넣고, 나머지는 반드시 "내 옷장"의 id만 써. 각 코디는 최소 (상의+하의) 또는 (원피스)를 이루게 해. 억지스러운 조합은 넣지 마.
- synergy_comment: 어떤 옷들과 잘 맞는지 한두 문장.

3) 퍼스널 컬러 / 체형 적합도
${
  profile
    ? `- color_level: NEW의 색이 "내 프로필"의 퍼스널 컬러에 얼마나 맞는지. best(베스트 컬러에 해당) / good / neutral / poor / worst(워스트 컬러에 해당).
- color_comment: 근거를 한 문장으로. 프로필에 퍼스널 컬러 정보가 없으면 "${NO_PROFILE_COMMENT}"라고만 적어.
- body_level: NEW의 핏/실루엣이 "내 프로필"의 체형 조언에 얼마나 맞는지. great / good / neutral / poor.
- body_comment: 근거를 한 문장으로. 프로필에 체형 정보가 없으면 "${NO_PROFILE_COMMENT}"라고만 적어.`
    : `- 프로필이 없으니 color_level과 body_level은 neutral로, color_comment와 body_comment는 "${NO_PROFILE_COMMENT}"라고만 적어.`
}

4) verdict: 사도 좋을지 두세 문장으로 종합해. 점수는 매기지 마 (점수는 앱이 계산해).

살까 말까 고민 중인 옷 (id=NEW): ${wishDesc}
${profile ? `\n내 프로필:\n${profile}\n` : ""}
내 옷장:
${items.length ? wardrobeForPrompt(items) : "(비어 있음)"}`;
}

export function scoreLabel(score: number): string {
  if (score >= 80) return "강력 추천";
  if (score >= 60) return "추천";
  if (score >= 40) return "고민 필요";
  return "비추천";
}

export interface ValidationContext {
  /** 옷장에 있는 옷 id */
  validIds: Set<string>;
  hasColorProfile: boolean;
  hasBodyProfile: boolean;
  now: string;
}

/** Gemini의 판단(raw)을 정리하고 규칙대로 점수를 계산한다. */
export function computeValidation(raw: unknown, ctx: ValidationContext): PurchaseValidation {
  const r = asRecord(raw);

  // 중복
  const similar: { item_id: string; level: "same" | "similar" }[] = [];
  for (const x of asArray(r.similar)) {
    if (!isRecord(x) || typeof x.item_id !== "string") continue;
    const id = x.item_id.trim();
    if (!ctx.validIds.has(id) || similar.some((s) => s.item_id === id)) continue;
    similar.push({ item_id: id, level: asEnum(x.level, DUP_LEVELS) ?? "similar" });
    if (similar.length >= 6) break;
  }
  const penalty = similar.reduce((sum, s) => sum + (s.level === "same" ? SCORE_RULES.duplicate.same : SCORE_RULES.duplicate.similar), 0);
  const duplicateScore = Math.max(0, SCORE_RULES.duplicate.max - penalty);

  // 시너지
  const withNew = new Set([...ctx.validIds, "NEW"]);
  const outfits: SuggestedOutfit[] = sanitizeOutfits(coerceOutfits(r.outfits, 5), withNew).filter((o) => o.item_ids.includes("NEW"));
  const table = SCORE_RULES.synergy.byCount;
  const synergyScore = table[Math.min(outfits.length, table.length - 1)];

  // 퍼스널 컬러 / 체형
  const colorLevel = ctx.hasColorProfile ? (asEnum(r.color_level, COLOR_LEVELS) ?? "neutral") : null;
  const bodyLevel = ctx.hasBodyProfile ? (asEnum(r.body_level, BODY_LEVELS) ?? "neutral") : null;
  const colorScore = colorLevel ? SCORE_RULES.color.levels[colorLevel] : null;
  const bodyScore = bodyLevel ? SCORE_RULES.body.levels[bodyLevel] : null;

  const earned = duplicateScore + synergyScore + (colorScore ?? 0) + (bodyScore ?? 0);
  const possible = SCORE_RULES.duplicate.max + SCORE_RULES.synergy.max + (colorScore !== null ? SCORE_RULES.color.max : 0) + (bodyScore !== null ? SCORE_RULES.body.max : 0);
  const score = Math.round((earned / possible) * 100);

  const noColor = `${NO_PROFILE_COMMENT} — 퍼스널 컬러 진단을 하면 점수에 반영돼요.`;
  const noBody = `${NO_PROFILE_COMMENT} — 체형 진단을 하면 점수에 반영돼요.`;
  return {
    score,
    label: scoreLabel(score),
    verdict: asString(r.verdict, "", 1000),
    breakdown: {
      duplicate: {
        score: duplicateScore,
        max: SCORE_RULES.duplicate.max,
        available: true,
        comment: asString(r.duplicate_comment, "", 500) || (similar.length ? "옷장에 비슷한 옷이 있어요." : "옷장에 겹치는 옷이 없어요."),
        similar,
      },
      synergy: {
        score: synergyScore,
        max: SCORE_RULES.synergy.max,
        available: true,
        comment: asString(r.synergy_comment, "", 500) || `새로 만들 수 있는 코디 ${outfits.length}개`,
        new_outfit_count: outfits.length,
        outfits,
      },
      personal_color: {
        score: colorScore,
        max: SCORE_RULES.color.max,
        available: colorLevel !== null,
        comment: colorLevel ? asString(r.color_comment, "", 500) : noColor,
        level: colorLevel,
      },
      body_fit: {
        score: bodyScore,
        max: SCORE_RULES.body.max,
        available: bodyLevel !== null,
        comment: bodyLevel ? asString(r.body_comment, "", 500) : noBody,
        level: bodyLevel,
      },
    },
    validated_at: ctx.now,
    stale: false,
  };
}

/** wishlist.validator_comment 에 저장할 한 덩어리 설명 (중복 여부, 예상 조합 수, 퍼스널 컬러/체형 코멘트) */
export function validationComment(v: PurchaseValidation): string {
  const b = v.breakdown;
  return [
    v.verdict,
    `· 중복 (${b.duplicate.score}/${b.duplicate.max}): ${b.duplicate.comment}`,
    `· 시너지 (${b.synergy.score}/${b.synergy.max}): 새 코디 ${b.synergy.new_outfit_count}개. ${b.synergy.comment}`,
    `· 퍼스널 컬러 (${b.personal_color.score ?? "-"}/${b.personal_color.max}): ${b.personal_color.comment}`,
    `· 체형 (${b.body_fit.score ?? "-"}/${b.body_fit.max}): ${b.body_fit.comment}`,
  ]
    .filter(Boolean)
    .join("\n");
}
