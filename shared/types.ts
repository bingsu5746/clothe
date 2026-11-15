export const CATEGORIES = ["outer", "top", "bottom", "dress", "shoes", "bag", "accessory"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  outer: "아우터",
  top: "상의",
  bottom: "하의",
  dress: "원피스",
  shoes: "신발",
  bag: "가방",
  accessory: "액세서리",
};

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, string> = { spring: "봄", summer: "여름", fall: "가을", winter: "겨울" };

export interface Item {
  id: string;
  name: string;
  brand: string | null;
  category: Category;
  sub_category: string | null;
  colors: string[];
  material: string | null;
  fit: string | null;
  season: Season[];
  style_tags: string[];
  warmth: number | null;
  image_key: string | null;
  original_shop_url: string | null;
  purchase_price: number | null;
  wear_count: number;
  last_worn_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface Outfit {
  id: string;
  name: string;
  item_ids: string[];
  source: "manual" | "ai" | "reference";
  reason: string | null;
  tags: string[];
  created_at: string;
}

export interface InspirationPiece {
  category: Category;
  description: string;
  colors: string[];
  matched_item_ids: string[];
  wishlist_id?: string | null;
}

export interface InspirationAnalysis {
  summary: string;
  pieces: InspirationPiece[];
}

export interface Inspiration {
  id: string;
  image_key: string;
  source_url: string | null;
  note: string | null;
  analysis: InspirationAnalysis | null;
  created_at: string;
}

export interface WishlistItem {
  id: string;
  name: string;
  category: Category | null;
  description: string | null;
  colors: string[];
  estimated_price: number | null;
  image_key: string | null;
  image_url: string | null;
  shop_url: string | null;
  reference_id: string | null;
  status: "wanted" | "bought" | "dropped";
  bought_item_id: string | null;
  created_at: string;
}

export interface Weather {
  date: string;
  location_name: string | null;
  temp_min: number;
  temp_max: number;
  temp_now: number | null;
  diurnal_range: number;
  precip_probability: number | null;
  weather_code: number | null;
  description: string;
}

export interface SuggestedOutfit {
  title: string;
  item_ids: string[];
  reason: string;
}

export interface ItemTagging {
  name: string;
  category: Category;
  sub_category: string;
  colors: string[];
  material: string;
  fit: string;
  season: Season[];
  style_tags: string[];
  warmth: number;
}

export interface UrlImport {
  name: string | null;
  brand: string | null;
  price: number | null;
  image_url: string | null;
  url: string;
}

// ───────────────────────── 아래는 2차 기능에서 추가된 타입 (기존 타입은 그대로) ─────────────────────────

/** 구매 링크 (위시리스트 recommended_links, /shopping/search 의 links) */
export interface ShoppingLink {
  title: string;
  url: string;
  /** naver_search | musinsa_search | 29cm_search = 검색 결과로 가는 링크, naver_item = 네이버 쇼핑 API가 찾은 상품, custom = 직접 넣은 링크 */
  source: "naver_search" | "musinsa_search" | "29cm_search" | "naver_item" | "custom";
  price: number | null;
  image_url: string | null;
  mall: string | null;
}

/** 네이버 쇼핑 검색 API 결과 한 건 */
export interface ShoppingResult {
  title: string;
  url: string;
  image_url: string | null;
  /** 최저가(원). 정보가 없으면 null */
  price: number | null;
  mall: string | null;
  brand: string | null;
  category: string[];
  product_id: string | null;
}

export interface ShoppingSearch {
  query: string;
  /** naver = 네이버 쇼핑 API 결과 있음, links = 키가 없거나 실패해서 검색 링크만 */
  source: "naver" | "links";
  naver_enabled: boolean;
  results: ShoppingResult[];
  links: ShoppingLink[];
  /** 네이버 API가 꺼져 있거나 실패한 이유 (없으면 null) */
  notice: string | null;
}

export interface PaletteColor {
  hex: string; // #RRGGBB (대문자)
  name: string;
}

export const COLOR_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type ColorSeason = (typeof COLOR_SEASONS)[number];
/** 사계절 기본 라벨 */
export const COLOR_SEASON_LABEL: Record<ColorSeason, string> = { spring: "봄 웜", summer: "여름 쿨", autumn: "가을 웜", winter: "겨울 쿨" };
export const COLOR_SUB_TONES = ["라이트", "브라이트", "뮤트", "딥"] as const;
export type ColorSubTone = (typeof COLOR_SUB_TONES)[number];
export type Undertone = "warm" | "cool" | "neutral";
export const UNDERTONE_LABEL: Record<Undertone, string> = { warm: "웜톤", cool: "쿨톤", neutral: "뉴트럴" };
export type Confidence = "high" | "medium" | "low";

export interface ColorSamples {
  skin?: string | null;
  hair?: string | null;
  eye?: string | null;
}

export interface ColorAnalysis {
  season: ColorSeason;
  sub_tone: ColorSubTone | null;
  /** 화면에 보여 줄 이름. 예: "가을 웜 뮤트" */
  label: string;
  undertone: Undertone;
  summary: string;
  skin_hex: string | null;
  hair_hex: string | null;
  eye_hex: string | null;
  /** client = 브라우저가 화이트밸런스 보정 후 뽑은 값, ai = Gemini가 사진에서 추정한 값 */
  hex_source: "client" | "ai";
  best_colors: PaletteColor[];
  worst_colors: PaletteColor[];
  tips: string[];
  confidence: Confidence;
  /** 조명/화장 등 때문에 결과가 달라질 수 있는 점 (없으면 빈 문자열) */
  caveat: string;
  image_key: string;
  analyzed_at: string;
}

export const BODY_TYPES = ["straight", "wave", "natural"] as const;
export type BodyType = (typeof BODY_TYPES)[number];
export const BODY_TYPE_LABEL: Record<BodyType, string> = { straight: "스트레이트", wave: "웨이브", natural: "내추럴" };

export interface BodyAnalysis {
  body_type: BodyType;
  body_type_label: string;
  /** 어깨너비, 상·하체 비율 등 요약 */
  proportions: string;
  features: string[];
  fit_tips: string[];
  avoid: string[];
  confidence: Confidence;
  caveat: string;
  image_key: string;
  analyzed_at: string;
}

export interface Profile {
  height_cm: number | null;
  weight_kg: number | null;
  face_image_key: string | null;
  body_image_key: string | null;
  /** 가상 피팅/콜라주에 쓰는 전신(마네킹) 사진들. 첫 번째가 기본 */
  mannequin_images: string[];
  /** color_analysis.label 과 같음 (없으면 null) */
  personal_color: string | null;
  body_type: BodyType | null;
  best_colors: PaletteColor[];
  worst_colors: PaletteColor[];
  color_analysis: ColorAnalysis | null;
  body_analysis: BodyAnalysis | null;
  /** 얼굴 사진을 바꿔서 진단 결과가 지금 사진과 다를 때 true */
  color_analysis_stale: boolean;
  body_analysis_stale: boolean;
  /** 진단/키/몸무게가 바뀔 때마다 1씩 증가 (AI 캐시 키에 사용) */
  version: number;
  updated_at: string | null;
}

/** 장롱템 (오래 안 입었거나 1회당 가격이 높은 옷) */
export interface DormantItem {
  item_id: string;
  reasons: ("never_worn" | "long_unworn" | "high_cpw")[];
  /** 화면에 보여 줄 한 줄 설명 */
  reason: string;
  /** 마지막으로 입은 뒤(한 번도 안 입었으면 등록한 뒤) 지난 날 수 */
  days_idle: number | null;
  /** 1회 착용당 가격 (가격을 모르면 null) */
  cpw: number | null;
  score: number;
}

export interface TodayResult {
  weather: Weather | null;
  briefing: string;
  outfits: SuggestedOutfit[];
  /** 이번 추천에서 AI에게 "하나 섞어 달라"고 넘긴 장롱템 후보 */
  dormant: DormantItem[];
  /** 프롬프트에 프로필(퍼스널 컬러/체형)이 반영됐는지 */
  profile_used: boolean;
}

export interface SimilarLookResult {
  mode: "similar" | "couple";
  /** 상대 옷차림 요약 */
  partner_summary: string;
  outfits: SuggestedOutfit[];
  cached: boolean;
}

export interface WishCombos {
  verdict: string;
  similar_item_ids: string[];
  outfits: SuggestedOutfit[];
}

export interface ValidationPart {
  /** 이 항목 점수. 프로필이 없어 평가하지 못하면 null */
  score: number | null;
  max: number;
  available: boolean;
  comment: string;
}

export interface PurchaseValidation {
  /** 0~100 */
  score: number;
  /** 강력 추천 | 추천 | 고민 필요 | 비추천 */
  label: string;
  verdict: string;
  breakdown: {
    duplicate: ValidationPart & { similar: { item_id: string; level: "same" | "similar" }[] };
    synergy: ValidationPart & { new_outfit_count: number; outfits: SuggestedOutfit[] };
    personal_color: ValidationPart & { level: "best" | "good" | "neutral" | "poor" | "worst" | null };
    body_fit: ValidationPart & { level: "great" | "good" | "neutral" | "poor" | null };
  };
  validated_at: string;
  /** 판독 뒤에 옷장이나 프로필이 바뀌어서 다시 판독하는 게 좋을 때 true */
  stale: boolean;
}

/** GET /wishlist 응답에 추가된 필드 (기존 WishlistItem 필드는 그대로) */
export interface WishlistItemV2 extends WishlistItem {
  validator_score: number | null;
  validator_comment: string | null;
  validation: PurchaseValidation | null;
  recommended_links: ShoppingLink[];
}

export interface OutfitLog {
  id: string;
  worn_date: string; // YYYY-MM-DD
  outfit_id: string | null;
  item_ids: string[];
  weather_summary: string | null;
  selfie_key: string | null;
  rating: number | null; // 1~5
  occasion_tags: string[];
  note: string | null;
  created_at: string;
}

export interface OotdCandidate {
  item_id: string;
  /** 0~1 */
  confidence: number;
}

export interface OotdPiece {
  category: Category;
  description: string;
  /** 확신이 높은 순. 옷장에 비슷한 게 없으면 빈 배열 */
  candidates: OotdCandidate[];
}

export interface OotdAnalysis {
  image_key: string;
  summary: string;
  pieces: OotdPiece[];
  /** 각 piece에서 확신 0.5 이상인 1순위 후보만 모은 것 (기록 화면의 기본 선택값) */
  suggested_item_ids: string[];
  /** 후보 옷 사진까지 보내 한 번 더 확인했는지 */
  verified: boolean;
  analyzed_at: string;
  cached: boolean;
}

export interface TripDayWeather {
  date: string;
  temp_min: number;
  temp_max: number;
  precip_probability: number | null;
  weather_code: number | null;
  description: string;
}

export interface TripWeather {
  /** forecast = 전 일정 예보 있음, partial = 일부 날짜만, unavailable = 예보 없음(계절/메모 기준으로 계획) */
  status: "forecast" | "partial" | "unavailable";
  message: string;
  location_name: string | null;
  days: TripDayWeather[];
}

export interface TripDayPlan {
  day: number; // 1부터
  date: string;
  item_ids: string[];
  note: string;
}

export interface TripPlan {
  summary: string;
  capsule_item_ids: string[];
  days: TripDayPlan[];
  tips: string[];
  weather: TripWeather;
  generated_at: string;
}

export interface ChecklistEntry {
  id: string;
  kind: "item" | "extra";
  item_id: string | null;
  label: string;
  packed: boolean;
  /** plan = 캡슐 옷, ai = AI가 제안한 준비물, user = 직접 추가 */
  source: "plan" | "ai" | "user";
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  location_name: string | null;
  lat: number | null;
  lon: number | null;
  start_date: string;
  end_date: string;
  notes: string | null;
  plan: TripPlan | null;
  checklist: ChecklistEntry[];
  created_at: string;
  updated_at: string;
}

export type TryOnStatusValue = "queued" | "processing" | "succeeded" | "failed";

export interface TryOnAvailability {
  available: boolean;
  provider: "replicate" | "gemini" | null;
  model: string | null;
  /** 사용할 수 없을 때의 이유 (한국어). 사용할 수 있으면 null */
  reason: string | null;
  /** 켜는 방법 안내 (한국어). 사용할 수 있으면 null */
  setup_hint: string | null;
}

export interface TryOn {
  id: string;
  status: TryOnStatusValue;
  provider: "replicate" | "gemini";
  model: string;
  person_image_key: string;
  garment_image_key: string;
  garment_item_id: string | null;
  garment_wish_id: string | null;
  category: Category | null;
  result_image_key: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
