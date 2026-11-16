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

-- 착용 기록 밖에서 알게 된 마지막 착용일 (예전 데이터, 옷 수정 화면에서 직접 입력한 값).
-- last_worn_date = max(base_last_worn_date, 남은 착용 기록 중 가장 늦은 날짜) 로 계산해서, 기록을 지워도 예전 값이 사라지지 않게 한다.
ALTER TABLE items ADD COLUMN base_last_worn_date TEXT;
-- 기존 행: 마지막 착용일이 어떤 착용 기록으로도 설명되지 않으면 그 값을 기준값으로 보존
UPDATE items SET base_last_worn_date = last_worn_date
WHERE base_last_worn_date IS NULL AND last_worn_date IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM outfit_logs l, json_each(CASE WHEN json_valid(l.item_ids) THEN l.item_ids ELSE '[]' END) j
  WHERE j.value = items.id AND l.worn_date = items.last_worn_date
);

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
