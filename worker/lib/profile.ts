import {
  BODY_TYPES,
  BODY_TYPE_LABEL,
  COLOR_SEASONS,
  COLOR_SEASON_LABEL,
  COLOR_SUB_TONES,
  UNDERTONE_LABEL,
  type BodyAnalysis,
  type ColorAnalysis,
  type ColorSamples,
  type Confidence,
  type PaletteColor,
  type Profile,
} from "../../shared/types";
import { jsonStrings, numOrNull, strOrNull, type Row } from "./db";
import { arr, enumOf, obj, S, type Schema } from "./gemini";
import { parseJsonUnknown } from "./util";
import { asArray, asEnum, asString, asStringArray, isImageKey, isRecord } from "./validate";

const CONFIDENCES = ["high", "medium", "low"] as const;
const UNDERTONES = ["warm", "cool", "neutral"] as const;

/** "#abc", "ABCDEF", "#AbCdEf" → "#AABBCC". 색 값이 아니면 null. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${[...s].map((ch) => ch + ch).join("").toUpperCase()}`;
  return null;
}

export function sanitizePalette(v: unknown, max = 8): PaletteColor[] {
  const out: PaletteColor[] = [];
  for (const x of asArray(v)) {
    if (!isRecord(x)) continue;
    const hex = normalizeHex(x.hex);
    if (!hex || out.some((c) => c.hex === hex)) continue;
    out.push({ hex, name: asString(x.name, hex, 30) || hex });
    if (out.length >= max) break;
  }
  return out;
}

/** 클라이언트가 보낸 샘플 색을 정리한다 (형식이 틀린 값은 버림) */
export function sanitizeSamples(v: unknown): ColorSamples {
  if (!isRecord(v)) return {};
  const out: ColorSamples = {};
  const skin = normalizeHex(v.skin);
  const hair = normalizeHex(v.hair);
  const eye = normalizeHex(v.eye);
  if (skin) out.skin = skin;
  if (hair) out.hair = hair;
  if (eye) out.eye = eye;
  return out;
}

const palette = arr(obj({ hex: S.str, name: S.str }));

export const COLOR_SCHEMA: Schema = obj({
  season: enumOf(COLOR_SEASONS),
  sub_tone: enumOf(COLOR_SUB_TONES),
  undertone: enumOf(UNDERTONES),
  summary: S.str,
  skin_hex: S.str,
  hair_hex: S.str,
  eye_hex: S.str,
  best_colors: palette,
  worst_colors: palette,
  tips: S.strArr,
  confidence: enumOf(CONFIDENCES),
  caveat: S.str,
});

export function colorPrompt(samples: ColorSamples): string {
  const measured = [
    samples.skin ? `피부 ${samples.skin}` : "",
    samples.hair ? `머리카락 ${samples.hair}` : "",
    samples.eye ? `눈동자 ${samples.eye}` : "",
  ].filter(Boolean);
  return `이 사진은 사용자 본인의 얼굴 사진이야. 퍼스널 컬러(사계절 컬러 시스템)를 진단해 줘. 모든 설명은 한국어로.

${
  measured.length
    ? `앱이 화이트밸런스를 보정한 뒤 사진에서 직접 측정한 색 값: ${measured.join(", ")}.
이 측정값을 1차 근거로 삼고, 사진은 대비감·채도·전체 인상을 확인하는 데 써. skin_hex/hair_hex/eye_hex에는 측정값이 있으면 그 값을 그대로 적어.`
    : `사진에서 피부(볼/이마의 고른 부분), 머리카락, 눈동자의 대표 색을 추정해서 skin_hex/hair_hex/eye_hex에 #RRGGBB로 적어.`
}

답할 내용:
- season: spring(봄 웜), summer(여름 쿨), autumn(가을 웜), winter(겨울 쿨) 중 하나
- sub_tone: 라이트, 브라이트, 뮤트, 딥 중 가장 가까운 것 (예: 가을 + 뮤트 = "가을 웜 뮤트")
- undertone: warm, cool, neutral 중 하나 (피부의 노란기/붉은기 기준)
- summary: 피부 톤의 명도·채도·노란기/붉은기, 눈동자와 머리색의 대비를 근거로 왜 이 유형인지 2~3문장
- best_colors: 잘 어울리는 옷 색 6~8개 (hex는 #RRGGBB, name은 한국어 색 이름)
- worst_colors: 피하는 게 좋은 옷 색 4~6개
- tips: 옷/액세서리 색을 고를 때 쓸 수 있는 구체적인 조언 2~4개
- confidence: 사진 상태(조명, 화장, 필터, 해상도)를 고려한 확신 정도 high/medium/low
- caveat: 조명이 누렇거나 필터·화장이 의심되는 등 결과가 달라질 수 있는 점. 없으면 빈 문자열.

주의: 사진만으로 하는 추정이라는 점을 감안해서, 근거가 약하면 confidence를 낮추고 caveat에 이유를 적어. 사람의 신원이나 외모 평가는 하지 마.`;
}

export function sanitizeColorAnalysis(raw: unknown, samples: ColorSamples, imageKey: string, now: string): ColorAnalysis | null {
  if (!isRecord(raw)) return null;
  const season = asEnum(raw.season, COLOR_SEASONS);
  if (!season) return null;
  const sub_tone = asEnum(raw.sub_tone, COLOR_SUB_TONES);
  const best_colors = sanitizePalette(raw.best_colors);
  if (!best_colors.length) return null;
  const hasSamples = Boolean(samples.skin || samples.hair || samples.eye);
  return {
    season,
    sub_tone,
    label: sub_tone ? `${COLOR_SEASON_LABEL[season]} ${sub_tone}` : COLOR_SEASON_LABEL[season],
    undertone: asEnum(raw.undertone, UNDERTONES) ?? (season === "spring" || season === "autumn" ? "warm" : "cool"),
    summary: asString(raw.summary, "", 1000),
    // 클라이언트 측정값이 있으면 항상 그 값을 쓴다 (모델이 다른 값을 적어도 무시)
    skin_hex: samples.skin ?? normalizeHex(raw.skin_hex),
    hair_hex: samples.hair ?? normalizeHex(raw.hair_hex),
    eye_hex: samples.eye ?? normalizeHex(raw.eye_hex),
    hex_source: hasSamples ? "client" : "ai",
    best_colors,
    worst_colors: sanitizePalette(raw.worst_colors),
    tips: asStringArray(raw.tips, 6, 300),
    confidence: asEnum(raw.confidence, CONFIDENCES) ?? "medium",
    caveat: asString(raw.caveat, "", 500),
    image_key: imageKey,
    analyzed_at: now,
  };
}

export const BODY_SCHEMA: Schema = obj({
  body_type: enumOf(BODY_TYPES),
  proportions: S.str,
  features: S.strArr,
  fit_tips: S.strArr,
  avoid: S.strArr,
  confidence: enumOf(CONFIDENCES),
  caveat: S.str,
});

export function bodyPrompt(heightCm: number | null, weightKg: number | null): string {
  const facts = [heightCm ? `키 ${heightCm}cm` : "", weightKg ? `몸무게 ${weightKg}kg` : ""].filter(Boolean);
  return `이 사진은 사용자 본인의 전신 사진이야. 옷을 고르는 데 쓰려고 골격 체형을 진단하려 해. 모든 설명은 한국어로, 중립적이고 존중하는 말투로.
${facts.length ? `\n사용자가 입력한 정보: ${facts.join(", ")}\n` : ""}
답할 내용:
- body_type: straight(스트레이트: 상체에 입체감, 허리 위치가 높고 몸에 탄력이 있는 편), wave(웨이브: 상체가 얇고 하체에 볼륨, 곡선적), natural(내추럴: 뼈와 관절이 도드라지고 프레임이 큰 편) 중 가장 가까운 것
- proportions: 어깨너비와 골반 너비의 관계, 상체·하체 길이 비율, 허리 위치를 2~3문장으로 요약
- features: 눈에 띄는 체형 특징 2~4개 (짧은 구)
- fit_tips: 이 체형을 살리는 옷 핏/기장/소재/실루엣 조언 3~5개 (구체적으로. 예: "허리선이 높은 하의로 다리를 길어 보이게")
- avoid: 피하는 게 좋은 핏이나 디테일 2~4개
- confidence: 사진의 자세/옷/각도를 고려한 확신 정도 high/medium/low
- caveat: 헐렁한 옷이나 각도 때문에 판단이 어려운 점. 없으면 빈 문자열.

주의: 건강이나 체중에 대한 평가, 신원 추정은 하지 마. 사진만으로 하는 추정임을 감안해.`;
}

export function sanitizeBodyAnalysis(raw: unknown, imageKey: string, now: string): BodyAnalysis | null {
  if (!isRecord(raw)) return null;
  const body_type = asEnum(raw.body_type, BODY_TYPES);
  if (!body_type) return null;
  return {
    body_type,
    body_type_label: BODY_TYPE_LABEL[body_type],
    proportions: asString(raw.proportions, "", 1000),
    features: asStringArray(raw.features, 6, 200),
    fit_tips: asStringArray(raw.fit_tips, 8, 300),
    avoid: asStringArray(raw.avoid, 6, 300),
    confidence: asEnum(raw.confidence, CONFIDENCES) ?? "medium",
    caveat: asString(raw.caveat, "", 500),
    image_key: imageKey,
    analyzed_at: now,
  };
}

/** DB에 저장된 진단 JSON을 다시 읽을 때 (모양이 깨졌으면 null) */
function storedColor(v: unknown): ColorAnalysis | null {
  if (!isRecord(v) || !isImageKey(v.image_key)) return null;
  const a = sanitizeColorAnalysis(v, {}, v.image_key, asString(v.analyzed_at));
  if (!a) return null;
  const conf: Confidence = a.confidence;
  return { ...a, confidence: conf, hex_source: v.hex_source === "client" ? "client" : "ai" };
}

function storedBody(v: unknown): BodyAnalysis | null {
  if (!isRecord(v) || !isImageKey(v.image_key)) return null;
  return sanitizeBodyAnalysis(v, v.image_key, asString(v.analyzed_at));
}

export const EMPTY_PROFILE: Profile = {
  height_cm: null,
  weight_kg: null,
  face_image_key: null,
  body_image_key: null,
  mannequin_images: [],
  personal_color: null,
  body_type: null,
  best_colors: [],
  worst_colors: [],
  color_analysis: null,
  body_analysis: null,
  color_analysis_stale: false,
  body_analysis_stale: false,
  version: 0,
  updated_at: null,
};

export function rowToProfile(r: Row | null): Profile {
  if (!r) return { ...EMPTY_PROFILE };
  const color = storedColor(parseJsonUnknown(r.color_analysis));
  const body = storedBody(parseJsonUnknown(r.body_analysis));
  const face = strOrNull(r.face_image_key);
  const bodyKey = strOrNull(r.body_image_key);
  return {
    height_cm: numOrNull(r.height_cm),
    weight_kg: numOrNull(r.weight_kg),
    face_image_key: face,
    body_image_key: bodyKey,
    mannequin_images: jsonStrings(r.mannequin_images, 10).filter(isImageKey),
    personal_color: color?.label ?? null,
    body_type: body?.body_type ?? null,
    best_colors: color?.best_colors ?? [],
    worst_colors: color?.worst_colors ?? [],
    color_analysis: color,
    body_analysis: body,
    color_analysis_stale: Boolean(color && face && color.image_key !== face),
    body_analysis_stale: Boolean(body && bodyKey && body.image_key !== bodyKey),
    version: numOrNull(r.version) ?? 0,
    updated_at: strOrNull(r.updated_at),
  };
}

export async function getProfile(db: D1Database): Promise<Profile> {
  return rowToProfile(await db.prepare("SELECT * FROM profile WHERE id = 'me'").first<Row>());
}

/** 코디 추천/구매 판독 프롬프트에 넣을 프로필 요약. 진단 결과가 없으면 null. */
export function profileForPrompt(p: Profile): string | null {
  const lines: string[] = [];
  const c = p.color_analysis;
  if (c) {
    lines.push(`- 퍼스널 컬러: ${c.label} (${UNDERTONE_LABEL[c.undertone]})`);
    if (c.best_colors.length) lines.push(`- 잘 어울리는 색: ${c.best_colors.map((x) => `${x.name}(${x.hex})`).join(", ")}`);
    if (c.worst_colors.length) lines.push(`- 피하면 좋은 색: ${c.worst_colors.map((x) => `${x.name}(${x.hex})`).join(", ")}`);
  }
  const b = p.body_analysis;
  if (b) {
    lines.push(`- 체형: ${b.body_type_label}${b.proportions ? ` — ${b.proportions}` : ""}`);
    if (b.fit_tips.length) lines.push(`- 어울리는 핏: ${b.fit_tips.join(" / ")}`);
    if (b.avoid.length) lines.push(`- 피하면 좋은 핏: ${b.avoid.join(" / ")}`);
  }
  if (p.height_cm) lines.push(`- 키: ${p.height_cm}cm`);
  return c || b ? lines.join("\n") : null;
}
