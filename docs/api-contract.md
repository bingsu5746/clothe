# API 계약서 (clothe)

프런트엔드가 이 문서와 `shared/types.ts`만 보고 화면을 만들 수 있도록 **실제 코드와 똑같이** 적은 문서입니다.
코드를 바꾸면 이 문서도 같이 고쳐 주세요. 타입 이름(예: `Item`, `Profile`)은 모두 `shared/types.ts`에 있습니다.

## 0. 공통 규칙

- 모든 경로 앞에 `/api`가 붙습니다. (예: `GET /api/items`)
- **인증**: `POST /auth/login`으로 받은 `clothe_session` 쿠키(HttpOnly, 180일)가 필요합니다. 예외는 `/auth/login`, `/auth/logout`, `/webhook/shortcut`(토큰 헤더), `/public/images/...`(서명 주소)뿐입니다. 쿠키가 없거나 틀리면 `401 { "error": "로그인이 필요해요" }`.
- **오류 형식**: 실패하면 항상 `{ "error": "한국어 메시지" }` 하나입니다. 상태 코드:
  - `400` 입력 오류 (메시지에 어느 필드가 왜 틀렸는지: 예 `"평점: 5 이하여야 해요"`)
  - `401` 로그인 필요 / PIN·토큰 틀림, `403` 서명 주소 만료
  - `404` 없음 (없는 id, 형식이 이상한 id 포함 — id는 `[A-Za-z0-9_-]{1,64}`), 없는 API는 `"없는 API예요"`
  - `409` 중복 (체크리스트 같은 이름 준비물)
  - `413` 요청이 너무 큼, `415` 지원하지 않는 이미지 형식
  - `422` AI가 처리를 거절(안전 필터)했거나 사진에서 옷을 못 찾음
  - `429` 사용 한도 초과 (Gemini 무료 한도, PIN 잠금, Replicate)
  - `502` 외부 서비스 오류 / AI 응답을 해석하지 못함, `503` 필요한 시크릿이 없음, `504` 외부 서비스 시간 초과
- **본문 크기**: 전체 요청 최대 9MB(이미지 업로드용). JSON 본문은 최대 64KB(로그인은 1KB). JSON이 아니거나 객체(`{}`)가 아니면 400.
- **입력 규칙** (모든 JSON 필드 공통): 필드를 **보내지 않으면 "바꾸지 않음"**, `null` 또는 `""`를 보내면 **"비움(null)"**. 문자열은 앞뒤 공백을 자릅니다. 모르는 필드는 무시합니다. 문자열 배열은 빈 값·중복을 없앱니다.
- **이미지 key**: `img/<uuid>.<ext>`(업로드) 또는 `tryon/<id>.<ext>`(피팅 결과). 다른 모양의 key는 400. 화면에서는 `/api/images/{key}`로 표시합니다.
- **날짜**: `YYYY-MM-DD`(실제 있는 날짜만). `created_at`/`updated_at`은 SQLite `datetime('now')` 형식 `"YYYY-MM-DD HH:MM:SS"`(UTC). AI 결과의 `analyzed_at`/`validated_at`/`generated_at`은 ISO 8601(UTC).
- **AI 호출**: Gemini(`GEMINI_MODEL`, 기본 `gemini-flash-latest`). 타임아웃 45초, 5xx·네트워크 오류면 한 번 재시도, 429는 재시도하지 않고 429로 돌려줍니다. 결과는 D1에 저장하므로 같은 입력이면 다시 호출하지 않습니다(각 엔드포인트의 `force`/`refresh`로 강제 재호출).
- AI 응답의 id는 서버가 항상 옷장에 실제로 있는 id만 남기고 정리합니다(없는 옷을 지어내도 화면에 나오지 않음).

### 시크릿 / 변수

| 이름 | 종류 | 필수 | 효과 |
|---|---|---|---|
| `APP_PIN` | 시크릿 | 필수 | 로그인 PIN. 없으면 로그인/인증 경로가 503 |
| `GEMINI_API_KEY` | 시크릿 | AI 기능에 필수 | 없으면 AI 엔드포인트가 `503` "GEMINI_API_KEY가 설정되지 않았어요…" |
| `SESSION_SECRET` | 시크릿 | 선택 | 쿠키·서명 주소 서명 키 (없으면 APP_PIN 사용) |
| `SHORTCUT_TOKEN` | 시크릿 | 선택 | iOS 단축어 webhook. 없으면 webhook은 항상 401 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 시크릿 | 선택 | 네이버 쇼핑 검색 API 결과. 없으면 쇼핑몰 검색 링크만 |
| `REPLICATE_API_TOKEN` | 시크릿 | 선택 | 가상 피팅(Replicate IDM-VTON). 유료 |
| `TRYON_PROVIDER` | 변수 | 선택 | `replicate` \| `gemini` \| 비움. `gemini`는 결제가 연결된 GEMINI 키 필요(이미지 모델은 무료 티어 없음) |
| `TRYON_MODEL` | 변수 | 선택 | 피팅 모델 덮어쓰기 (비우면 기본값) |
| `GEMINI_MODEL` | 변수 | 선택 | 텍스트/비전 모델 (기본 `gemini-flash-latest`) |

### DB 스키마 업그레이드 (런타임 마이그레이션)

배포 때 마이그레이션 명령을 돌리지 않습니다. Worker가 첫 요청에서 `worker/lib/migrate.ts`로 `migrations/000N_*.sql`을 순서대로 적용하고 `schema_migrations(version, name, applied_at)` 표에 기록합니다. 한 버전은 D1 batch(트랜잭션) 하나로 적용되어 실패하면 통째로 되돌려집니다. `ALTER TABLE … ADD COLUMN`은 컬럼이 이미 있으면 건너뜁니다. 버전 1(0001)은 전부 `IF NOT EXISTS`라 기존 운영 DB에서는 아무것도 바꾸지 않습니다. **`wrangler d1 migrations apply`는 쓰지 마세요.**

---

## 1. 인증

### `POST /auth/login`
- 요청: `{ "pin": "1234" }` (문자열 또는 숫자)
- 응답 200: `{ "ok": true }` + `Set-Cookie: clothe_session=…`
- 오류: 401 `"PIN이 맞지 않아요"`, 429 `"PIN을 너무 많이 틀렸어요. N분 뒤에 다시 시도해 주세요."`(15분에 5번), 503 APP_PIN 없음

### `POST /auth/logout`
- 응답: `{ "ok": true }` (쿠키 삭제)

### `GET /auth/me`
- 응답: `{ "ok": true }` (로그인 확인용)

---

## 2. 이미지

### `POST /images`
- 요청: `multipart/form-data`, 필드 `file` (webp/jpeg/png/heic/heif/gif/avif, 1바이트~8MB)
- 응답 201: `{ "key": "img/<uuid>.webp" }`
- 오류: 400 파일 없음/빈 파일/multipart 아님, 413 8MB 초과, 415 형식

### `GET /images/{dir}/{name}`
- 이미지 바이트. 헤더: `Cache-Control: private, max-age=31536000, immutable`, `ETag`. `If-None-Match`가 같으면 `304`(본문 없음).
- 오류: 404 `{ "error": "이미지를 찾을 수 없어요" }`

### `GET /public/images/{exp}/{sig}/{dir}/{name}` (로그인 불필요)
- 서버가 만든 15분짜리 서명 주소. 가상 피팅 때 Replicate가 입력 사진을 받아 가는 용도. 프런트에서 쓸 일 없음.
- 오류: 403 만료/서명 틀림

### 이미지 정리 규칙
옷/스크랩/위시/착용기록/프로필/피팅 행을 지우거나 사진을 바꾸면, **다른 어떤 행도 쓰지 않는 경우에만** R2에서 지웁니다(예: 스크랩 사진을 위시리스트가 같이 쓰면 남음).

---

## 3. 옷장 `Item`

`Item` 필드는 예전과 같습니다: `id, name, brand, category, sub_category, colors[], material, fit, season[], style_tags[], warmth(1~5|null), image_key, original_shop_url, purchase_price, wear_count, last_worn_date, notes, created_at`.

### `GET /items` → `Item[]` (최근 등록 순)

### `GET /items/{id}` → `Item` | 404 `"옷을 찾을 수 없어요"`

### `POST /items` → 201 `Item`
- 요청 필드(모두 선택, 단 `name`·`category` 필수):

| 필드 | 형식 |
|---|---|
| `name` | 문자열 ≤120 (필수) |
| `category` | `outer\|top\|bottom\|dress\|shoes\|bag\|accessory` (필수) |
| `brand` ≤80, `sub_category` ≤60, `material` ≤80, `fit` ≤60, `notes` ≤1000, `original_shop_url` ≤2000 | 문자열 |
| `colors` | 문자열 배열 ≤10개, 각 ≤30자 |
| `season` | `spring\|summer\|fall\|winter` 배열 |
| `style_tags` | 문자열 배열 ≤15개 |
| `warmth` | 정수 1~5 |
| `image_key` | 이미지 key |
| `purchase_price` | 정수 0 이상 |
| `wear_count` | 정수 0 이상 (null이면 0) |
| `last_worn_date` | `YYYY-MM-DD` |

- 오류: 400 `"이름을 입력해 주세요"`, `"카테고리를 골라 주세요"`, `"카테고리가 올바르지 않아요"`, 필드별 형식 오류

### `PATCH /items/{id}` → `Item`
- 보낸 필드만 바꿈(위 표와 같은 규칙). `name: ""`이면 400. 사진을 바꾸면 예전 사진 정리.
- `wear_count`/`last_worn_date`만 바꾸면 AI 캐시(옷장 시그니처)가 무효화되지 않습니다.

### `DELETE /items/{id}` → `{ "ok": true }`

### `GET /items/dormant` → `DormantItem[]` (장롱템, 점수 높은 순, 최대 50개)
`DormantItem = { item_id, reasons: ("never_worn"|"long_unworn"|"high_cpw")[], reason: "등록한 지 45일째 한 번도 안 입었어요", days_idle: number|null, cpw: number|null, score: number }`

장롱템 기준:
- `never_worn`: 등록 30일 이상 + 한 번도 안 입음
- `long_unworn`: 마지막 착용 후 60일 이상
- `high_cpw`: 가격 있음 + 1회당 가격(가격÷착용횟수, 0회면 가격) ≥ 20,000원 + 착용 10회 미만 + 등록 30일 이상

### `POST /items/analyze` (AI) → `ItemTagging`
- 요청: `{ "image_key": "img/…" }`
- 응답: `{ name, category, sub_category, colors[], material, fit, season[], style_tags[], warmth }` (서버가 범위를 정리함). 이미지별로 캐시.
- 오류: 400, 404 이미지 없음, 413, 422/429/502/503/504(AI)

### `POST /items/import-url` → `UrlImport & { image_key: string|null }`
- 요청: `{ "url": "https://…" }` (공개 http(s)만. localhost·사설 IP는 400)
- 응답: `{ name, brand, price, image_url, url, image_key }`
- 오류: 400 URL, 502 `"페이지를 불러오지 못했어요 (403)"` 등

### `POST /items/wear` (예전 엔드포인트, 계속 지원) → `{ ok: true, log_id: string, duplicate: boolean }`
- 요청: `{ item_ids: string[] (1~30), date?: "YYYY-MM-DD" (기본: 한국 오늘), outfit_id?, weather_summary? (≤200) }` + `POST /logs`와 같은 선택 필드
- 동작은 `POST /logs`와 동일(아래 착용 기록 규칙). 같은 날짜 + 같은 옷 조합이 이미 기록돼 있으면 새로 만들지 않고 `duplicate: true`.
- 오류: 400 `"입은 옷을 골라 주세요"`, `"옷장에 없는 옷이 들어 있어요…"`, 날짜 형식, `"날짜: 미래 날짜에는 기록할 수 없어요"`(내일까지 허용)

---

## 4. 착용 기록 / OOTD 달력 `OutfitLog`

`OutfitLog = { id, worn_date, outfit_id, item_ids[], weather_summary, selfie_key, rating (1~5|null), occasion_tags[], note, created_at }`

### 착용 기록 규칙 (wear_count / last_worn_date)
1. **옷 하나는 하루에 한 번만 셉니다.** 같은 날짜의 여러 기록에 같은 옷이 있어도 `wear_count`는 1만 오릅니다.
2. 기록을 지우거나 고치면, 그 날짜에 그 옷을 입은 **다른 기록이 남아 있지 않을 때만** `wear_count`를 1 줄입니다(0 미만 없음).
3. `last_worn_date` = max(**기준값**, 그 옷이 들어 있는 남은 기록 중 가장 늦은 날짜). 기준값은 기록 밖에서 알게 된 날짜입니다: 업그레이드 전부터 있던 값(어떤 기록으로도 설명되지 않는 날짜만), 그리고 옷 수정(`POST/PATCH /items`)에서 직접 입력한 `last_worn_date`. 그래서 기록을 넣었다 지우면 원래 날짜로 정확히 돌아옵니다. 기록도 기준값도 없으면 null. (기준값은 내부 컬럼이라 `Item`에는 나오지 않습니다.)
4. 옷 수정 화면에서 직접 고친 `wear_count`는 존중합니다(기록으로 다시 세지 않고 위 규칙대로 더하고 빼기만 함).
5. 같은 날짜에 **똑같은 옷 조합**을 다시 기록하면 새 기록을 만들지 않고, 보낸 셀카/평점/태그/메모/날씨를 기존 기록에 채웁니다(`duplicate: true`).

### `GET /logs`
- `?month=YYYY-MM` → 그 달 기록 (달력용)
- `?from=YYYY-MM-DD&to=YYYY-MM-DD` → 기간(최대 370일)
- 쿼리 없음 → 최근 60개
- 응답: `OutfitLog[]` (날짜 내림차순). 오류 400 형식.

### `GET /logs/{id}` → `OutfitLog` | 404 `"착용 기록을 찾을 수 없어요"`

### `POST /logs` → 201 `OutfitLog & { duplicate: false }` 또는 200 `OutfitLog & { duplicate: true }`
- 요청:

| 필드 | 형식 |
|---|---|
| `item_ids` | 문자열 배열 1~30 (필수, 옷장에 있는 id) |
| `date` | `YYYY-MM-DD` (기본 한국 오늘, 내일 이후 불가) |
| `outfit_id` | 문자열 ≤64 |
| `weather_summary` | 문자열 ≤200 (예: `"최저 3°C / 최고 12°C, 맑음"`) |
| `selfie_key` | 이미지 key (OOTD 셀카) |
| `rating` | 정수 1~5 |
| `occasion_tags` | 문자열 배열 ≤10개, 각 ≤30자 |
| `note` | 문자열 ≤500 |

### `PATCH /logs/{id}` → `OutfitLog`
- 위 필드 중 보낸 것만 바꿈. `item_ids`/`date`가 바뀌면 착용 횟수를 규칙대로 조정. `item_ids: []`는 400. 셀카를 바꾸면 예전 셀카 정리.

### `DELETE /logs/{id}` → `{ "ok": true }`
- 착용 횟수/마지막 착용일 되돌림 + 셀카 정리. 404.

---

## 5. OOTD 거울 셀카 자동 매칭

흐름: `POST /images`(셀카 업로드) → `POST /ootd/analyze` → 사용자가 후보 확인/수정 → `POST /logs`(`selfie_key` 포함)로 저장.

### `POST /ootd/analyze` (AI) → `OotdAnalysis`
- 요청: `{ "image_key": "img/…", "force"?: boolean, "verify"?: boolean (기본 true) }`
- 응답:
```json
{
  "image_key": "img/…",
  "summary": "캐주얼한 데일리룩",
  "pieces": [
    { "category": "top", "description": "밝은 티셔츠", "candidates": [{ "item_id": "…", "confidence": 0.9 }, { "item_id": "…", "confidence": 0.4 }] }
  ],
  "suggested_item_ids": ["…"],
  "verified": true,
  "analyzed_at": "2026-11-15T09:00:00.000Z",
  "cached": false
}
```
- `candidates`: 확신 높은 순, piece당 최대 3개, 옷장에 있는 id만. `confidence` 0~1.
- `suggested_item_ids`: 각 piece의 1순위 후보 중 confidence ≥ 0.5 (기록 화면의 기본 체크값).
- `verify`: 1단계(셀카 + 옷장 글 목록)에서 1순위가 확실하지 않은 piece(0.8 미만 또는 2순위와 0.25 미만 차이)가 있으면, 그 후보들의 옷 사진(장당 1.5MB 이하, 최대 6장)을 셀카와 함께 한 번 더 보내 고릅니다(Gemini 2회). 2단계가 실패하면 1단계 결과를 그대로 씁니다(`verified: false`).
- 같은 사진 + 같은 옷장이면 캐시(`cached: true`), `force: true`면 다시 분석.
- 오류: 400 사진 없음/`"옷장에 옷을 먼저 등록해 주세요"`, 404 이미지, 422 `"사진에서 옷을 찾지 못했어요…"`, AI 오류

---

## 6. 저장한 코디 `Outfit`

### `GET /outfits` → `Outfit[]`
### `GET /outfits/{id}` → `Outfit` | 404 `"코디를 찾을 수 없어요"`
### `POST /outfits` → 201 `Outfit`
- 요청: `{ item_ids: string[] (1~30, 필수), name?: string ≤80 (기본 "내 코디"), source?: "manual"|"ai"|"reference", reason?: ≤1000, tags?: string[] ≤15 }`
- 오류: 400 `"옷을 하나 이상 골라 주세요"`
### `PATCH /outfits/{id}` → `Outfit` (`name`, `item_ids`(빈 배열 불가), `tags`)
### `DELETE /outfits/{id}` → `{ "ok": true }`

---

## 7. 스크랩(레퍼런스 코디 사진) `Inspiration`

### `GET /inspirations` → `Inspiration[]`
### `GET /inspirations/{id}` → `Inspiration` | 404 `"저장한 코디 사진을 찾을 수 없어요"`
### `POST /inspirations` → 201 `Inspiration`
- 요청: `{ image_key (필수), source_url?: ≤2000, note?: ≤500 }`
### `PATCH /inspirations/{id}` → `Inspiration`
- `{ note?, source_url? }` — 예전 동작 그대로 `null`/빈 값은 "바꾸지 않음"
### `DELETE /inspirations/{id}` → `{ "ok": true }`
### `POST /inspirations/{id}/analyze[?force=true]` (AI) → `Inspiration` (analysis 채워짐)
- 이미 분석돼 있으면 그대로 돌려줌. piece당 `matched_item_ids` 최대 3개(옷장에 있는 id만). 다시 분석해도 piece별 `wishlist_id`는 유지.
- 오류: 422 옷을 못 찾음, AI 오류
### `POST /inspirations/{id}/pieces/{index}/wishlist` → 201 `{ wishlist_id }` (이미 추가됐으면 200 같은 값)
- 오류: 400 `"먼저 사진을 분석해 주세요"`(분석 없음/없는 index)

---

## 8. 위시리스트 `WishlistItemV2` / 살까 말까 판독 / 구매 링크

`GET`/`POST`/`PATCH` 응답은 예전 `WishlistItem` 필드 전부 + 아래 필드(`WishlistItemV2`):
- `validator_score: number|null` (0~100), `validator_comment: string|null` (여러 줄 요약)
- `validation: PurchaseValidation|null` (점수 내역. `stale: true`면 판독 뒤 옷장/프로필/옷 정보가 바뀌어 다시 판독 권장)
- `recommended_links: ShoppingLink[]`

### `GET /wishlist` → `WishlistItemV2[]` (wanted 먼저, 최근 순)
### `GET /wishlist/{id}` → `WishlistItemV2` | 404 `"위시리스트 항목을 찾을 수 없어요"`
### `POST /wishlist` → 201 `WishlistItemV2`
- 요청: `{ name? ≤200 (기본 "이름 없는 옷"), category?, description? ≤1000, colors?, estimated_price? (정수 ≥0), image_key?, image_url? ≤2000, shop_url? ≤2000 }`
### `POST /wishlist/from-url` → 201 `WishlistItemV2`
- 요청 `{ url }` → 상품 페이지에서 이름/가격/사진을 가져와 추가. 오류 400 URL, 502 페이지 실패.
### `PATCH /wishlist/{id}` → `WishlistItemV2`
- 위 필드 + `status: "wanted"|"bought"|"dropped"` + `recommended_links: ShoppingLink[]`(직접 편집; http(s) URL만 남김, 최대 20개, `source` 생략 시 `"custom"`)
### `DELETE /wishlist/{id}` → `{ "ok": true }`

### `POST /wishlist/{id}/combos[?force=true]` (AI, 예전 그대로) → `WishCombos`
`{ verdict: string, similar_item_ids: string[], outfits: SuggestedOutfit[] }` — 모든 코디에 `"NEW"`(이 옷)가 들어 있음. 옷장이 같으면 캐시. `/validate`를 먼저 했다면 그 결과를 재사용(추가 호출 없음).
- 오류: 400 `"옷장에 옷을 먼저 등록해 주세요"`, AI 오류

### `POST /wishlist/{id}/validate[?force=true]` (AI) → `PurchaseValidation & { cached: boolean }`
```json
{
  "score": 60, "label": "추천", "verdict": "…", "validated_at": "…", "stale": false, "cached": false,
  "breakdown": {
    "duplicate":      { "score": 22, "max": 30, "available": true, "comment": "…", "similar": [{ "item_id": "…", "level": "similar" }] },
    "synergy":        { "score": 20, "max": 40, "available": true, "comment": "…", "new_outfit_count": 2, "outfits": [SuggestedOutfit] },
    "personal_color": { "score": null, "max": 15, "available": false, "comment": "프로필 없음 — 퍼스널 컬러 진단을 하면 점수에 반영돼요.", "level": null },
    "body_fit":       { "score": null, "max": 15, "available": false, "comment": "프로필 없음 — 체형 진단을 하면 점수에 반영돼요.", "level": null }
  }
}
```
점수 계산 (서버 코드가 계산, AI는 판단만):

| 항목 | 만점 | 계산 |
|---|---|---|
| 중복 | 30 | 30 − (거의 같은 옷 `same` × 20) − (비슷한 옷 `similar` × 8), 최소 0 |
| 시너지 | 40 | 새 코디 수 0/1/2/3/4/5+ → 0/10/20/28/35/40 |
| 퍼스널 컬러 | 15 | `best` 15 / `good` 12 / `neutral` 8 / `poor` 3 / `worst` 0 — 컬러 진단이 없으면 제외 |
| 체형 | 15 | `great` 15 / `good` 11 / `neutral` 8 / `poor` 3 — 체형 진단이 없으면 제외 |

`score = round(얻은 점수 / 포함된 항목 만점 합 × 100)`. `label`: 80↑ 강력 추천, 60↑ 추천, 40↑ 고민 필요, 그 아래 비추천.
결과는 위시리스트 행에 저장(`validator_score`, `validator_comment`, `validation`). (옷 설명 + 옷장 + 프로필 버전)이 같으면 다시 호출하지 않음(`cached: true`). 옷 사진이 있으면 같이 보냄.
- 오류: 400 `"옷장에 옷을 먼저 등록해 주세요"`, AI 오류

### `POST /wishlist/{id}/links` → `{ query, source: "naver"|"links", notice: string|null, recommended_links: ShoppingLink[] }`
- 요청(선택): `{ "query"?: string ≤100 }` — 없으면 위시 이름으로 검색하고, 이름에 들어 있지 않은 첫 번째 색을 앞에 붙임 (예: 이름 "울 코트" + 색 ["카멜"] → `"카멜 울 코트"`)
- 네이버 API 결과(최대 5개, `source: "naver_item"`) + 검색 링크 3개를 `recommended_links`에 **덮어써서** 저장. 본문 없이 보내도 됨.

### `POST /wishlist/{id}/bought` → 201 `{ item_id, item: Item }` (이미 샀으면 200 `{ item_id }`)
- 요청(선택): `{ purchase_price?: 정수 ≥0 }` (없으면 `estimated_price`)

---

## 9. 쇼핑 검색

### `GET /shopping/status` → `{ "naver_enabled": boolean }`

### `GET /shopping/search?q=검색어[&limit=10]` → `ShoppingSearch`
```json
{ "query": "울 코트", "source": "naver", "naver_enabled": true, "results": [ShoppingResult], "links": [ShoppingLink×3], "notice": null }
```
- `q` 1~100자 필수, `limit` 1~30 (기본 10). 오류 400.
- 네이버 키가 없거나 네이버가 실패하면 **200**으로 `source: "links"`, `results: []`, `notice`에 이유(예: `"네이버 API 키가 올바르지 않아요…"`).
- `links`는 항상 3개: 네이버 쇼핑 `https://search.shopping.naver.com/search/all?query=…`, 무신사 `https://www.musinsa.com/search/goods?keyword=…`, 29CM `https://www.29cm.co.kr/store/search?keyword=…`.
- `ShoppingResult = { title(태그 제거), url, image_url, price(최저가, 0이면 null), mall, brand, category[], product_id }`
- 네이버 호출: `GET https://openapi.naver.com/v1/search/shop.json?query=…&display=limit&start=1&sort=sim&exclude=used:rental` (헤더 `X-Naver-Client-Id`, `X-Naver-Client-Secret`, 하루 25,000회). 출처: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md

---

## 10. 스타일리스트

### `GET /stylist/weather?lat=&lon=&name=` → `Weather`
- 오류: 400 `"위치가 필요해요"`(범위 밖 포함), 502 날씨 실패

### `GET /stylist/geocode?q=` → `{ name, admin1?, country?, latitude, longitude }[]` (q 없으면 `[]`)

### `POST /stylist/today` (AI) → `TodayResult`
- 요청(모두 선택, 예전 그대로): `{ weather?: Weather, lat?, lon?, location_name?, keywords?: ≤300, refresh?: boolean }` — 본문 없이도 됨
- 응답: `{ weather: Weather|null, briefing, outfits: SuggestedOutfit[], dormant: DormantItem[], profile_used: boolean }`
  - 새 필드 `dormant`: 이번 추천에 "하나 섞어 달라"고 넘긴 장롱템(최대 8개). 코디 안에 들어갔는지는 `outfits[].item_ids`와 비교.
  - `profile_used`: 퍼스널 컬러/체형 진단이 프롬프트에 반영됐는지.
- 캐시: (한국 날짜, 날씨 최저/최고/코드, 키워드, 옷장, 프로필 버전)이 같으면 재사용. `refresh: true`면 새로.
- 오류: 400 `"추천을 받으려면 옷장에 옷을 2벌 이상 등록해 주세요"`, 502 `"추천 결과가 비어 있어요…"`, AI 오류

### `POST /stylist/similar` (AI) → `SimilarLookResult` (시밀러룩/커플룩)
- 요청: `{ partner_image_key?: 이미지 key, partner_description?: ≤500, mode?: "similar"|"couple" (기본 similar), keywords?: ≤300, weather?, lat?, lon?, location_name?, refresh?: boolean }` — 사진이나 설명 중 하나는 필수
- 응답: `{ mode, partner_summary, outfits: SuggestedOutfit[], cached: boolean }`
- 오류: 400 `"상대가 입을 옷의 사진이나 설명을 넣어 주세요"`, 옷 2벌 미만, 404 사진, AI 오류

---

## 11. 프로필 / AI 진단 `Profile`

`Profile` 전체 필드는 `shared/types.ts` 참고. 핵심: `height_cm, weight_kg, face_image_key, body_image_key, mannequin_images[], personal_color("가을 웜 뮤트"|null), body_type, best_colors[], worst_colors[], color_analysis, body_analysis, color_analysis_stale, body_analysis_stale, version, updated_at`.
- `*_stale: true` = 진단 뒤에 사진을 바꿈 (다시 진단 권장)
- `version`: 진단·키·몸무게가 바뀔 때마다 +1 (추천/판독 캐시 키)

### `GET /profile` → `Profile` (아직 없으면 빈 값들, `version: 0`)

### `PUT /profile` 또는 `PATCH /profile` → `Profile` (둘 다 "보낸 필드만 바꿈")
- `height_cm` 50~250, `weight_kg` 20~300 (소수 가능), `face_image_key`, `body_image_key`, `mannequin_images` (이미지 key 배열 ≤6, 첫 번째가 가상 피팅 기본 사진)
- 바뀐 사진 중 다른 곳에서 안 쓰는 것은 R2에서 정리

### `POST /profile/analyze-color` (AI) → `Profile & { cached: boolean }`
- 요청(모두 선택): `{ image_key?: 얼굴 사진 (없으면 프로필 face_image_key), samples?: { skin?: "#RRGGBB", hair?, eye? }, force?: boolean }`
  - `samples`: 프런트가 화이트밸런스 보정 후 뽑은 HEX. 있으면 1차 근거로 쓰고 결과 `*_hex`에 그대로 저장(`hex_source: "client"`). 형식이 틀린 값은 무시.
- 결과 `ColorAnalysis`: `season (spring|summer|autumn|winter)`, `sub_tone (라이트|브라이트|뮤트|딥|null)`, `label`, `undertone`, `summary`, `skin_hex/hair_hex/eye_hex`, `best_colors[{hex,name}]`, `worst_colors`, `tips[]`, `confidence`, `caveat`, `image_key`, `analyzed_at`
- 같은 사진으로 이미 진단했으면 다시 부르지 않음(`cached: true`), `force: true`면 다시. 성공 시 `face_image_key`도 그 사진으로.
- 오류: 400 `"얼굴 사진을 먼저 올려 주세요"`, 404 이미지, 502 해석 실패, AI 오류

### `POST /profile/analyze-body` (AI) → `Profile & { cached: boolean }`
- 요청(모두 선택): `{ image_key?: 전신 사진 (없으면 body_image_key → mannequin_images[0]), force?: boolean }`
- 결과 `BodyAnalysis`: `body_type (straight|wave|natural)`, `body_type_label`, `proportions`, `features[]`, `fit_tips[]`, `avoid[]`, `confidence`, `caveat`, `image_key`, `analyzed_at`. 키/몸무게가 있으면 프롬프트에 포함.
- 오류: 400 `"전신 사진을 먼저 올려 주세요"`, 404, 502, AI 오류

### `DELETE /profile/analysis/{color|body}` → `Profile` (진단 결과만 지움)

---

## 12. 여행 짐 싸기 `Trip`

`Trip = { id, name, destination, location_name, lat, lon, start_date, end_date, notes, plan: TripPlan|null, checklist: ChecklistEntry[], created_at, updated_at }`

### `GET /trips` → `Trip[]` (출발일 내림차순)
### `GET /trips/{id}` → `Trip` | 404 `"여행을 찾을 수 없어요"`
### `POST /trips` → 201 `Trip`
- 요청: `{ destination (필수, ≤100), start_date, end_date (필수, 최대 21일, end ≥ start), name? ≤80 (기본 "<여행지> 여행"), notes? ≤1000 (예: "하루 2만 보 걷기"), lat?, lon? (같이), location_name? }`
- `lat/lon`을 안 주면 계획 생성 때 Open-Meteo 지오코딩으로 찾음
### `PATCH /trips/{id}` → `Trip` (같은 필드. 여행지만 바꾸면 저장된 좌표를 지워 다시 찾음)
### `DELETE /trips/{id}` → `{ "ok": true }`

### `POST /trips/{id}/plan[?force=true]` (AI) → `Trip & { cached: boolean }`
- 요청(선택): `{ force?: boolean }`. (여행 정보, 옷장, 프로필)이 같으면 저장된 계획(`cached: true`). 예보를 새로 반영하려면 `force`.
- 날씨: 오늘(UTC)부터 14일 이내 날짜만 Open-Meteo 예보를 받습니다(문서상 최대 16일, 경계 오류를 피하려고 여유). `plan.weather`:
  - `status: "forecast"` 전 일정 예보, `"partial"` 일부 날짜만, `"unavailable"` 없음(범위 밖/위치 못 찾음/날씨 서버 실패 — `message`에 이유)
  - `days[]`에는 **실제 예보가 있는 날만** 들어갑니다. 예보가 없는 날의 기온은 만들지 않습니다.
- `plan = { summary, capsule_item_ids[], days: [{ day (1부터), date, item_ids[], note }] (여행 일수만큼, 빠진 날은 빈 배열), tips[], weather, generated_at }`
- 체크리스트를 다시 만듭니다: 캡슐 옷(`kind: "item", source: "plan"`) + AI 준비물(`kind: "extra", source: "ai"`) + 직접 추가한 준비물(`source: "user"`, 항상 유지). 이전에 챙김 표시한 항목은 표시가 유지됩니다.
- 오류: 400 `"짐을 싸려면 옷장에 옷을 2벌 이상 등록해 주세요"`, 404, 502 빈 계획, AI 오류

### 체크리스트 `ChecklistEntry = { id, kind: "item"|"extra", item_id, label, packed, source: "plan"|"ai"|"user" }`
- `POST /trips/{id}/checklist` `{ label: ≤60 }` → 201 `Trip` (준비물 추가). 409 같은 이름 있음, 400 이름 없음/150개 초과
- `PATCH /trips/{id}/checklist/{entryId}` `{ packed?: boolean, label?: string }` → `Trip`. 옷 항목 이름 변경은 400. 404 항목 없음
- `PUT /trips/{id}/checklist` `{ packed: boolean }` → `Trip` (전체 체크/해제)
- `DELETE /trips/{id}/checklist/{entryId}` → `Trip`

---

## 13. 가상 피팅 `TryOn` (비동기 작업)

### `GET /tryon/status` → `TryOnAvailability`
```json
{ "available": false, "provider": null, "model": null,
  "reason": "가상 피팅용 API 키가 설정되지 않아서 꺼져 있어요.",
  "setup_hint": "켜려면 Cloudflare 대시보드 → … 설정 전에는 2D 콜라주 보드만 쓸 수 있어요." }
```
- `available: false`면 프런트는 2D 콜라주 보드만 보여 주세요.
- 켜지는 조건: `REPLICATE_API_TOKEN`이 있으면 `replicate`(기본 모델 `cuuupid/idm-vton:0513734a…`), 또는 `TRYON_PROVIDER=gemini` + `GEMINI_API_KEY`(기본 모델 `gemini-nano-banana-2.1`, 유료 키 필요).

### `POST /tryon` → 202 `TryOn`
- 요청: 입힐 옷은 셋 중 **정확히 하나**: `item_id` | `wish_id` | `garment_image_key`. 선택: `person_image_key`(없으면 프로필 `mannequin_images[0]` → `body_image_key`), `category`(없으면 옷의 카테고리), `description` ≤200.
- Replicate는 상의·아우터·하의·원피스만 지원(신발/가방/액세서리는 400). Gemini는 모든 종류.
- 응답: `{ id, status: "processing"(replicate) | "queued"(gemini), provider, model, person_image_key, garment_image_key, garment_item_id, garment_wish_id, category, result_image_key: null, error: null, created_at, updated_at }`
- 오류: 503 `reason`(꺼져 있음), 400 옷 선택/사진 없음/`"전신 사진을 먼저 등록해 주세요…"`, 404, 502 Replicate 키/결제 오류(기록 남기지 않음), 429

### `GET /tryon/{id}` → `TryOn` (폴링: 2~3초 간격 권장)
- `succeeded`면 `result_image_key`(`tryon/<id>.png` 등) → `/api/images/{key}`로 표시. `failed`면 `error`에 한국어 이유.
- **Gemini는 첫 폴링 요청에서 이미지를 생성하므로 그 응답이 수십 초 걸릴 수 있습니다**(그동안 다른 폴링은 `processing`을 바로 받음). Replicate는 매 폴링이 빠름. Replicate 15분/Gemini 4분 넘게 진행 중이면 `failed`로 정리.

### `GET /tryon` → `TryOn[]` (최근 50개)
### `DELETE /tryon/{id}` → `{ "ok": true }` (결과 이미지 정리, 프로필/옷 사진은 남음)

---

## 14. 설정

### `GET /settings` → `{ [key]: any }` (로그인 잠금 정보 제외)
### `PUT /settings/{key}` → `{ "ok": true }`
- key: `^[a-z][a-z0-9_]{0,39}$`, `login_`으로 시작 불가. 본문: 아무 JSON 값(≤8KB).

---

## 15. iOS 단축어 webhook

### `POST /webhook/shortcut` (헤더 `X-Shortcut-Token`)
- 본문: `multipart/form-data`(`file`, `url`, `target`, `note`) / JSON `{ url, target?, note? }` / 이미지 바이트(`Content-Type: image/*`) / 텍스트(안의 첫 URL)
- `target`: `"inspiration"` | `"wishlist"` (생략 시: 이미지 → 스크랩, 인스타/핀터레스트 등 → 스크랩, 그 밖의 URL → 위시리스트)
- 응답: `{ ok: true, type: "inspiration"|"wishlist", id, message }`
- 오류: 401 토큰, 400 이미지/URL 없음(사설 IP 포함), 422 링크에서 사진을 못 가져옴

---

## 16. 프런트엔드 참고

- 기존 화면이 쓰는 엔드포인트·필드는 그대로입니다(필드 추가만 있음). `GET /wishlist`는 이제 `WishlistItemV2`(추가 필드 4개).
- `POST /items/wear` 응답에 `log_id`, `duplicate`가 추가됐습니다. `duplicate: true`면 "오늘 이미 기록한 코디예요" 정도로 안내하면 됩니다.
- OOTD 기록 화면: `/ootd/analyze` → `suggested_item_ids`를 기본 체크, `pieces[].candidates`로 바꿀 수 있게 → `POST /logs`.
- 달력: `GET /logs?month=YYYY-MM`. 기록 수정/삭제는 `PATCH`/`DELETE /logs/{id}` (착용 횟수 자동 조정).
- 퍼스널 컬러: 사진 업로드 → (선택) 캔버스로 화이트밸런스 보정 후 피부/머리/눈 HEX 추출 → `POST /profile/analyze-color { image_key, samples }`.
- 위시 상세: `POST /wishlist/{id}/validate` 결과의 `breakdown` 4항목을 그대로 보여 주면 "투명한 점수 내역"이 됩니다. `validation.stale`이면 "다시 판독" 버튼.
- 가상 피팅: 먼저 `GET /tryon/status`. 불가면 `setup_hint`를 설정 화면에 보여 주고 2D 콜라주만.
