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
