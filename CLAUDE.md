# Project Overview: My AI Closet & Stylist (개인용 스마트 옷장 및 코디 추천 PWA)

이 프로젝트는 개인 사용을 목적으로 하는 크로스 플랫폼(iPhone, iPad, Mac) AI 기반 스마트 옷장 관리 및 스타일링 어시스턴트 웹 애플리케이션입니다. iOS/macOS의 '홈 화면에 추가(PWA)' 기능을 통해 네이티브 앱과 유사한 UX를 제공하며, Cloudflare 생태계를 기반으로 서버리스 아키텍처로 구동됩니다.

## 1. 기술 스택 및 인프라 아키텍처 (Tech Stack & Infrastructure)

* **Frontend:** Next.js (App Router) 또는 React (Vite) + Tailwind CSS
  * **PWA (Progressive Web App):** `manifest.json` 및 Service Worker 구성을 통해 iOS/iPadOS 홈 화면 설치 시 상단 주소창 제거(`display: standalone`), Safe Area 대응, 스플래시 스크린 및 앱 아이콘 적용.
  * **Responsive UI:** 모바일(iPhone), 태블릿(iPad), 데스크톱(Mac) 화면 크기에 맞춘 반응형 레이아웃 (모바일은 하단 탭 바, 데스크톱/태블릿은 사이드바 네비게이션).
* **Backend & Hosting (Cloudflare Ecosystem):**
  * **Hosting & Serverless API:** Cloudflare Pages & Cloudflare Workers
  * **Database:** Cloudflare D1 (SQLite 기반 서버리스 DB - 옷장 데이터, 코디 기록, 위시리스트, 착용 횟수/가격 메타데이터 저장)
  * **Object Storage:** Cloudflare R2 (사용자 전신/얼굴 사진, 옷 이미지, 레퍼런스 코디, OOTD 거울 셀카 이미지 저장)
* **External APIs (무료 티어 및 개인 API 키 활용):**
  * **Vision & LLM:** Google Gemini API (무료 티어 활용) 또는 OpenAI API — 옷 사진 분석, 속성 추출, 퍼스널 컬러/체형 진단, 상황별 코디 추천, 시밀러룩 매칭, OOTD 셀카 역인식.
  * **Weather API:** OpenWeatherMap API 또는 기상청 API (무료) — 실시간 기온, 강수 확률, 낮/밤 일교차 데이터 수집.
  * **Virtual Try-On (가상 피팅):** Replicate API 또는 Hugging Face Inference API (IDM-VTON, OOTDiffusion 등 오픈소스 모델 엔드포인트 연동) + 배경 제거 도구(`@imgly/background-removal` 클라이언트 사이드 처리 또는 API).
  * **Shopping / Metadata:** OpenGraph/메타태그 파서 (무신사, 29CM 등 쇼핑몰 URL 입력 시 상품명/가격/이미지 자동 추출) 및 Naver Shopping API (유사 상품 검색 및 구매 링크 매칭).

---

## 2. 핵심 기능 명세 (Core Features)

### 2.1. 디지털 옷장 구축 & 가성비 트래킹 (Digital Wardrobe & CPW Tracker)
* **URL 기반 자동 등록:** 쇼핑몰(무신사 등) 상품 링크 입력 시 웹 스크래핑(Cheerio/HTMLRewriter)을 통해 상품 이미지, 브랜드, 제품명, **구매 가격**, 카테고리 자동 파싱 및 등록.
* **사진 촬영/업로드 기반 AI 등록:** 직접 찍은 옷 사진을 업로드하면 자동으로 배경을 제거(누끼)하고, Vision AI가 분석하여 메타데이터를 자동 태깅 (대분류/소분류, 주색상/보조색상, 소재/원단 느낌, 핏, 계절감, 스타일 태그).
* **1회 착용당 가격 계산기 (Cost-Per-Wear 트래커):** 
  * 옷 등록 시 구매 가격을 입력하면 착용 횟수가 늘어날 때마다 실시간으로 `CPW = 구매 가격 ÷ 착용 횟수`를 계산하여 시각화(뽕 뽑기 게이지).
  * 구매 후 오랫동안 입지 않거나 CPW가 지나치게 높은 '장롱템'을 자동 발굴하여 코디 추천 시 우선적으로 섞어주는 기능.

### 2.2. AI 퍼스널 컬러/체형 자동 진단 및 가상 피팅룸 (AI Diagnosis & Virtual Try-On)
* **AI 퍼스널 컬러 & 체형 자동 진단기 (자가 진단 도구):**
  * 사용자가 본인의 퍼스널 컬러를 몰라도 앱 내에서 직접 알아낼 수 있는 온보딩 기능.
  * 자연광에서 찍은 얼굴 사진을 업로드하면 피부 톤(명도, 채도, 붉은기/노란기), 눈동자 색, 머리색의 HEX 값을 추출 및 Vision AI로 분석하여 **사계절 퍼스널 컬러(봄 웜, 여름 쿨, 가을 뮤트, 겨울 쿨 등)와 베스트/워스트 컬러 팔레트**를 자동 도출.
  * 마네킹용 전신 사진을 분석하여 어깨너비, 상·하체 비율 등 **체형 특징(스트레이트, 웨이브, 내추럴 등)**을 진단하고 보완할 수 있는 핏 가이드를 프로필에 저장.
* **내 마네킹 관리 및 AI 가상 피팅:** 사용자의 전신 사진에 내 옷장 속 옷이나 구매 예정인 온라인 쇼핑몰 옷을 자연스럽게 합성(Virtual Try-On) 및 2D 캔버스 콜라주 보드 제공.

### 2.3. 날씨 연동 & 상황 맞춤형 AI 코디네이터 (Weather-Sync & Context Stylist)
* **실시간 날씨 및 일교차 연동 브리핑 (Weather-Sync):**
  * 앱 실행 시 오늘 방문할 지역의 최저/최고 기온, 강수량, **'낮과 밤의 일교차'**를 자동 계산.
  * 일교차가 클 경우 레이어드 룩이나 탈착 가능한 아우터(가디건, 자켓 등)를 필수 포함한 코디를 브리핑 형태로 제안.
* **TPO 및 분위기 기반 코디 생성:** 데이트 장소의 분위기, 활동량 등을 자연어로 입력하면 내 옷장 DB 내에서 최적의 착장을 2~3가지 조합해 제안.
* **시밀러룩 / 커플룩 매칭:** 친구나 연인이 입고 올 옷의 사진이나 설명을 입력하면, 내 옷장 아이템 중 색감/소재/무드가 가장 잘 어우러지는 시밀러룩 코디를 추천.
* **스마트 여행 짐 싸기 패킹 리스트 (Travel Capsule Packer):**
  * *"3박 4일 도쿄 여행, 하루 2만 보 걷기"*처럼 여행지, 일정, 일기예보를 입력하면 부피를 최소화하면서 상·하의를 돌려 입어 매일 다른 느낌을 낼 수 있는 최소한의 아이템 조합(캡슐 워드로브)과 패킹 체크리스트를 생성.

### 2.4. 레퍼런스 분석, '살까 말까' 판독기 & 위시리스트 (Smart Wishlist & Validator)
* **핀터레스트/인스타 코디 분석 및 위시리스트 자동화:** 마음에 드는 코디 사진을 올리면 상의, 하의, 신발 등을 개별 분리하여 내 옷장에 비슷한 옷이 있는지 매칭해주고, 없는 옷은 **'위시리스트'** 탭에 자동 등록 후 쇼핑 API로 구매 링크 추천.
* **'살까 말까' AI 쇼핑 판독기 (Purchase Validator):**
  * 쇼핑몰에서 사려는 옷의 캡처나 링크를 올리면 구매 전 AI가 다각도로 판독하여 **'구매 추천 점수(0~100점)'**를 산출:
    1. **중복 판독:** 내 옷장에 이미 비슷한 디자인/색상의 옷이 있는지 경고.
    2. **매칭 시너지:** 이 옷을 샀을 때 현재 내 옷장에 있는 아이템들과 몇 가지의 새로운 코디 조합이 생성되는지 시뮬레이션.
    3. **퍼스널 컬러/체형 적합도:** 2.2에서 진단된 내 퍼스널 컬러 팔레트 및 체형 보완 핏에 부합하는지 코멘트.
* **iOS 단축어(Shortcuts) & 공유 시트 Webhook 연동:**
  * 아이폰에서 인스타/무신사 구경 중 앱을 켤 필요 없이 iOS 기본 **'공유하기' -> 단축어 실행**만으로 이미지나 URL을 Cloudflare Workers 전용 API 엔드포인트(`POST /api/webhook/shortcut`)로 즉시 전송해 위시리스트나 옷장에 백그라운드 등록.

### 2.5. OOTD 거울 셀카 자동 아카이빙 (Mirror Selfie Auto-Logger)
* 외출 전 입은 옷을 거울 셀카로 찍어 업로드하면, Vision AI가 사진 속 착장을 분석해 **내 옷장 DB에 등록된 어떤 아이템들을 입었는지 역으로 자동 매칭**.
* 매칭된 옷들의 **착용 횟수(`wear_count`)를 자동으로 +1 증가**시켜 CPW(1회 착용당 가격)를 갱신하고, 캘린더에 오늘 날짜의 OOTD 기록으로 자동 저장.

---

## 3. 데이터베이스 스키마 초안 (Cloudflare D1 - SQLite)

* `users_profile`: 
  * `id`, `height`, `weight`, `body_type` (AI 체형 분석 결과), `personal_color` (AI 진단 결과 - 예: Autumn Mute), `best_colors` (JSON HEX 배열), `worst_colors` (JSON HEX 배열), `mannequin_images` (JSON R2 URLs).
* `wardrobe_items`: 
  * `id`, `name`, `brand`, `category`, `sub_category`, `colors` (JSON), `material`, `fit`, `season` (JSON), `style_tags` (JSON), `image_url` (R2), `original_shop_url`, `purchase_price` (정수), `wear_count` (정수, 기본값 0), `last_worn_date`, `created_at`.
* `outfits_log`: 
  * `id`, `worn_date`, `item_ids` (JSON 배열), `ootd_selfie_url` (R2), `weather_summary` (기온/날씨 기록), `occasion_tags`, `tryon_image_url`, `rating`.
* `wishlist_items`: 
  * `id`, `reference_image_url`, `target_item_description`, `category`, `estimated_price`, `validator_score` (살까말까 판독 점수), `validator_comment` (중복 여부, 퍼스널컬러 매칭 코멘트, 예상 조합 수), `matched_wardrobe_items` (JSON), `recommended_links` (JSON).
* `travel_packs`:
  * `id`, `trip_name`, `destination`, `start_date`, `end_date`, `selected_item_ids` (JSON 배열), `daily_outfit_plan` (JSON - 일차별 코디 매핑), `is_packed_status` (JSON).

---

## 4. 개발 단계별 마일스톤 (Development Phases for Claude Code)

1. **Phase 1 (Project Setup & PWA):** Next.js(또는 React) + Tailwind 초기화, iOS/iPad/Mac 반응형 네비게이션 및 PWA Manifest 구성, Cloudflare D1/R2 로컬 개발 환경(Wrangler) 및 스키마 마이그레이션 세팅.
2. **Phase 2 (Profile & AI Self-Diagnosis):** 전신 마네킹 사진 등록 및 얼굴/전신 사진 기반 **AI 퍼스널 컬러 & 체형 자동 진단 파이프라인** 구현.
3. **Phase 3 (Wardrobe CRUD, CPW & iOS Shortcut API):** 옷 사진 배경 제거 및 Vision AI 자동 태깅, 쇼핑몰 URL 파서, 가격/착용 횟수 기반 **CPW(1회 착용당 가격) 트래커**, iOS 단축어 연동용 Webhook API(`POST /api/webhook/shortcut`) 구현.
4. **Phase 4 (Weather-Sync Stylist & Travel Packer):** 날씨 API 연동 일교차 브리핑, TPO/시밀러룩 코디 추천, **여행 일정 기반 캡슐 패킹 리스트 생성기** 구현.
5. **Phase 5 (Reference to Wishlist & Purchase Validator):** 코디 사진 분할 분석 -> 위시리스트 자동 등록 -> **'살까 말까' AI 쇼핑 판독기(중복 검사, 기존 옷 매칭 수 계산, 퍼스널컬러 부합도)** 및 네이버 쇼핑 API 연동.
6. **Phase 6 (OOTD Auto-Logger & Virtual Try-On):** 거울 셀카 업로드 시 보유 옷 자동 매칭 및 착용 횟수/CPW 자동 차감 기능, 마네킹 기반 Virtual Try-On 합성 연동.

---

## 5. 코딩 컨벤션 및 주의사항 (Guidelines for Claude)

* **인증 및 보안:** 개인용 단일 사용자 앱이므로 환경변수 기반의 간단한 PIN 번호/API 토큰 인증을 적용하되, iOS 단축어(Shortcuts)에서 호출할 Webhook 엔드포인트는 헤더에 `X-Shortcut-Token`을 넣어 인증하도록 구현할 것.
* **iOS PWA 최적화:** iOS Safari에서 홈 화면에 추가했을 때 하단 홈 바(Home Indicator)나 상단 노치(Safe Area)에 UI가 가려지지 않도록 `env(safe-area-inset-*)` 패딩을 철저히 적용할 것.
* **비용 및 성능 최적화:** 외부 API 비용과 Cloudflare R2 용량을 아끼기 위해 모든 이미지는 업로드 전 클라이언트(브라우저) 단에서 WebP 포맷 및 적절한 해상도로 압축/리사이징할 것. AI 분석 결과는 반드시 D1 DB에 캐싱하여 동일 작업에 대한 재호출을 방지할 것.