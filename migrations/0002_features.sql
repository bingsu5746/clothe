-- 2차 기능: 프로필/진단, OOTD 기록 확장, 살까 말까 판독, 여행 짐 싸기, 가상 피팅
-- 이 파일은 Worker가 첫 요청 때 직접 적용한다 (worker/lib/migrate.ts).
-- ALTER TABLE ... ADD COLUMN 은 이미 있는 컬럼이면 건너뛰므로 여러 번 실행해도 안전하다.
-- 주의: `wrangler d1 migrations apply`로 따로 돌리지 말 것 (런타임 마이그레이터가 schema_migrations 표로 관리).

-- 단일 사용자 프로필 (항상 id = 'me' 한 줄)
CREATE TABLE IF NOT EXISTS profile (
  id TEXT PRIMARY KEY CHECK (id = 'me'),
  height_cm REAL,
  weight_kg REAL,
  face_image_key TEXT,
  body_image_key TEXT,
  mannequin_images TEXT NOT NULL DEFAULT '[]', -- JSON 배열 (R2 key)
  color_analysis TEXT,                         -- JSON (퍼스널 컬러 진단 결과)
  body_analysis TEXT,                          -- JSON (체형 진단 결과)
  version INTEGER NOT NULL DEFAULT 0,          -- 진단/신체 정보가 바뀔 때마다 +1 (AI 캐시 키)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OOTD 기록 확장
ALTER TABLE outfit_logs ADD COLUMN selfie_key TEXT;
ALTER TABLE outfit_logs ADD COLUMN rating INTEGER;
ALTER TABLE outfit_logs ADD COLUMN occasion_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE outfit_logs ADD COLUMN note TEXT;

-- 살까 말까 판독 + 구매 링크
ALTER TABLE wishlist ADD COLUMN validator_score INTEGER;
ALTER TABLE wishlist ADD COLUMN validator_comment TEXT;
ALTER TABLE wishlist ADD COLUMN validation TEXT;      -- JSON (점수 내역)
ALTER TABLE wishlist ADD COLUMN validation_key TEXT;  -- 판독 당시의 (옷 설명 + 옷장 + 프로필) 해시
ALTER TABLE wishlist ADD COLUMN recommended_links TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_wishlist_status ON wishlist(status, created_at);

-- 여행 짐 싸기
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  destination TEXT NOT NULL,
  location_name TEXT,
  lat REAL,
  lon REAL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  notes TEXT,
  plan TEXT,                             -- JSON (캡슐 옷 + 일차별 코디 + 날씨)
  plan_key TEXT,                         -- 계획 생성 당시의 입력 해시
  checklist TEXT NOT NULL DEFAULT '[]',  -- JSON (챙김 여부 포함)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trips_start ON trips(start_date);

-- 가상 피팅 작업/기록
CREATE TABLE IF NOT EXISTS tryons (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | succeeded | failed
  provider TEXT NOT NULL,                -- replicate | gemini
  model TEXT NOT NULL,
  person_image_key TEXT NOT NULL,
  garment_image_key TEXT NOT NULL,
  garment_item_id TEXT,
  garment_wish_id TEXT,
  category TEXT,
  description TEXT,
  external_id TEXT,                      -- Replicate prediction id
  result_image_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tryons_created ON tryons(created_at);

CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_outfits_created ON outfits(created_at);
CREATE INDEX IF NOT EXISTS idx_inspirations_created ON inspirations(created_at);
