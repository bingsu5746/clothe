import { CATEGORIES, type Item, type OotdCandidate, type OotdPiece } from "../../shared/types";
import { wardrobeForPrompt } from "./db";
import { arr, enumOf, obj, S, type Schema } from "./gemini";
import { asArray, asCategory, asNumber, asString, isRecord } from "./validate";

export const OOTD_SCHEMA: Schema = obj({
  summary: S.str,
  pieces: arr(
    obj({
      category: enumOf(CATEGORIES),
      description: S.str,
      candidates: arr(obj({ item_id: S.str, confidence: S.num })),
    }),
  ),
});

/** 1단계: 셀카 + 옷장 글 목록 → 사진 속 옷마다 후보 id */
export function ootdPrompt(items: Item[]): string {
  return `이 사진은 사용자가 외출 전에 찍은 거울 셀카(OOTD)야. 사진 속 사용자가 입고 있는 옷과 소품을 하나씩 찾아서, 아래 "내 옷장" 목록의 어떤 옷인지 맞혀 줘.

규칙:
- pieces: 사진에서 보이는 옷/신발/가방/액세서리를 하나씩. 보이지 않는 것은 추측해서 넣지 마.
- category: outer, top, bottom, dress, shoes, bag, accessory 중 하나
- description: 사진에 보이는 그 옷을 한국어로 짧고 구체적으로 (색, 종류, 핏)
- candidates: "내 옷장"에서 같은 옷일 가능성이 있는 것을 가능성 높은 순으로 최대 3개.
  - item_id에는 반드시 아래 목록의 id만. 목록에 없는 id를 지어내지 마.
  - confidence는 0~1 (0.9 이상: 거의 확실, 0.6~0.9: 색·종류가 맞고 유력, 0.3~0.6: 비슷하지만 불확실).
  - category가 다른 옷은 후보로 넣지 마. 옷장에 맞는 옷이 없으면 빈 배열.
- 같은 옷장 아이템을 두 piece에 중복해서 넣지 마.
- summary: 오늘 착장의 전체 분위기를 한국어 한 문장으로.

내 옷장:
${wardrobeForPrompt(items)}`;
}

export interface OotdRaw {
  summary: string;
  pieces: OotdPiece[];
}

function clamp01(n: number | null): number {
  if (n === null) return 0.5;
  // 모델이 0~100으로 답하는 경우도 받아 준다
  const v = n > 1 ? n / 100 : n;
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

/** Gemini 응답 정리: 옷장에 없는 id 제거, confidence 0~1, piece당 후보 3개, 높은 순 정렬 */
export function sanitizeOotd(raw: unknown, validIds: Set<string>): OotdRaw {
  const r = isRecord(raw) ? raw : {};
  const pieces: OotdPiece[] = [];
  for (const p of asArray(r.pieces)) {
    if (!isRecord(p)) continue;
    const seen = new Set<string>();
    const candidates: OotdCandidate[] = [];
    for (const c of asArray(p.candidates)) {
      if (!isRecord(c) || typeof c.item_id !== "string") continue;
      const id = c.item_id.trim();
      if (!validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      candidates.push({ item_id: id, confidence: clamp01(asNumber(c.confidence)) });
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    pieces.push({ category: asCategory(p.category, "accessory"), description: asString(p.description, "", 200), candidates: candidates.slice(0, 3) });
    if (pieces.length >= 12) break;
  }
  return { summary: asString(r.summary, "", 300), pieces };
}

export const SUGGEST_THRESHOLD = 0.5;

/** 각 piece의 1순위 후보 중 확신 0.5 이상만 (같은 옷은 한 번만) */
export function suggestedItemIds(pieces: OotdPiece[]): string[] {
  const out: string[] = [];
  for (const p of pieces) {
    const top = p.candidates[0];
    if (top && top.confidence >= SUGGEST_THRESHOLD && !out.includes(top.item_id)) out.push(top.item_id);
  }
  return out;
}

export interface VerifyTarget {
  piece: number;
  item_ids: string[];
}

/**
 * 2단계(사진 대조)가 필요한 piece 고르기.
 * 후보가 2개 이상이고 1순위가 확실하지 않을 때(0.8 미만이거나 2순위와 0.25 미만 차이)만, 사진이 있는 후보를 최대 maxImages장까지.
 */
export function pickVerifyTargets(pieces: OotdPiece[], hasImage: (id: string) => boolean, maxImages = 6): VerifyTarget[] {
  const targets: VerifyTarget[] = [];
  let used = 0;
  pieces.forEach((p, index) => {
    if (p.candidates.length < 2) return;
    const [first, second] = p.candidates;
    if (first.confidence >= 0.8 && first.confidence - second.confidence >= 0.25) return;
    const ids = p.candidates.map((c) => c.item_id).filter(hasImage);
    if (ids.length < 2 || used + ids.length > maxImages) return;
    used += ids.length;
    targets.push({ piece: index, item_ids: ids });
  });
  return targets;
}

export const OOTD_VERIFY_SCHEMA: Schema = obj({
  picks: arr(obj({ piece: { type: "INTEGER" }, item_id: S.str, confidence: S.num })),
});

/** 2단계 프롬프트. 이미지 순서: [셀카, 후보1, 후보2, ...] (orderedIds 순서와 같아야 함) */
export function ootdVerifyPrompt(pieces: OotdPiece[], targets: VerifyTarget[], orderedIds: string[]): string {
  return `첫 번째 사진은 사용자의 거울 셀카(OOTD)야. 그 뒤의 사진들은 사용자 옷장에 있는 옷 사진이고, 순서대로 아래 id를 가져:
${orderedIds.map((id, i) => `- 사진 ${i + 2}: id=${id}`).join("\n")}

셀카 속 아래 옷이 후보 사진 중 어느 것과 같은 옷인지 골라 줘.
${targets.map((t) => `- piece ${t.piece}: "${pieces[t.piece].description}" → 후보 id: ${t.item_ids.join(", ")}`).join("\n")}

규칙:
- picks에 piece 번호마다 하나씩 답해.
- item_id는 그 piece의 후보 id 중 하나. 어느 것도 같은 옷이 아니면 빈 문자열("").
- confidence는 0~1. 색, 무늬, 넥라인, 기장, 디테일(단추, 로고, 주머니)을 비교해서 정해.`;
}

/** 2단계 결과를 반영: 고른 후보를 1순위로 올리고 confidence를 갱신. 후보 밖의 id는 무시. */
export function applyVerification(pieces: OotdPiece[], targets: VerifyTarget[], raw: unknown): OotdPiece[] {
  const out = pieces.map((p) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c })) }));
  const allowed = new Map(targets.map((t) => [t.piece, new Set(t.item_ids)]));
  for (const pick of asArray(isRecord(raw) ? raw.picks : null)) {
    if (!isRecord(pick)) continue;
    const index = asNumber(pick.piece);
    if (index === null || !allowed.has(index)) continue;
    const piece = out[index];
    const id = asString(pick.item_id);
    const conf = clamp01(asNumber(pick.confidence));
    if (!id) {
      // 후보 중 같은 옷이 없다고 판단 → 대조한 후보들의 확신을 낮춘다
      for (const c of piece.candidates) if (allowed.get(index)!.has(c.item_id)) c.confidence = Math.min(c.confidence, 0.3);
    } else if (allowed.get(index)!.has(id)) {
      for (const c of piece.candidates) {
        if (c.item_id === id) c.confidence = Math.max(conf, 0.5);
        else if (allowed.get(index)!.has(c.item_id)) c.confidence = Math.min(c.confidence, 0.4);
      }
    }
    piece.candidates.sort((a, b) => b.confidence - a.confidence);
  }
  return out;
}
