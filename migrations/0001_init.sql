-- 옷장 아이템
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,           -- outer | top | bottom | dress | shoes | bag | accessory
  sub_category TEXT,
  colors TEXT NOT NULL DEFAULT '[]',     -- JSON 배열 (색 이름)
  material TEXT,
  fit TEXT,
  season TEXT NOT NULL DEFAULT '[]',     -- JSON: spring/summer/fall/winter
  style_tags TEXT NOT NULL DEFAULT '[]', -- JSON
  warmth INTEGER,                        -- 1(아주 얇음) ~ 5(아주 따뜻함)
  image_key TEXT,
  original_shop_url TEXT,
  purchase_price INTEGER,
  wear_count INTEGER NOT NULL DEFAULT 0,
  last_worn_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

-- 저장한 코디
CREATE TABLE IF NOT EXISTS outfits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  item_ids TEXT NOT NULL DEFAULT '[]',   -- JSON 배열
  source TEXT NOT NULL DEFAULT 'manual', -- manual | ai | reference
  reason TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 실제로 입은 기록 (착용 횟수 / CPW 용)
CREATE TABLE IF NOT EXISTS outfit_logs (
  id TEXT PRIMARY KEY,
  worn_date TEXT NOT NULL,
  outfit_id TEXT,
  item_ids TEXT NOT NULL DEFAULT '[]',
  weather_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON outfit_logs(worn_date);

-- 인스타/핀터레스트 등에서 저장한 레퍼런스 코디 사진
CREATE TABLE IF NOT EXISTS inspirations (
  id TEXT PRIMARY KEY,
  image_key TEXT NOT NULL,
  source_url TEXT,
  note TEXT,
  analysis TEXT,                         -- JSON (Gemini 분석 결과 캐시)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 위시리스트
CREATE TABLE IF NOT EXISTS wishlist (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  colors TEXT NOT NULL DEFAULT '[]',
  estimated_price INTEGER,
  image_key TEXT,
  image_url TEXT,                        -- 쇼핑몰 원본 이미지 URL
  shop_url TEXT,
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'wanted', -- wanted | bought | dropped
  bought_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI 응답 캐시 (같은 입력이면 재호출하지 않음)
CREATE TABLE IF NOT EXISTS ai_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 단일 사용자 설정 (기본 위치 등)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
