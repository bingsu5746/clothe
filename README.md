# 내 옷장 (clothe)

개인용 AI 옷장 & 코디 추천 웹앱(PWA). Cloudflare Workers 하나에 화면(React)과 API(Hono)가 같이 올라가고, D1(DB)과 R2(사진)를 씁니다.

## 지금 들어 있는 기능

| 탭 | 기능 |
|---|---|
| 오늘 | 날씨·일교차 카드, 키워드 기반 AI 코디 추천 3개, 저장한 코디를 오늘 기온에 맞는 순으로 보여 주기, "오늘 입을래요" 착용 기록 |
| 옷장 | 사진 업로드 → Gemini 자동 태깅 / 쇼핑몰 링크로 가져오기 / 직접 입력, 착용 횟수·1회당 가격(CPW), 장롱템 정렬 |
| 코디 | 저장한 코디 목록, 직접 조합 만들기, 옷 바꾸기 |
| 스크랩 | 인스타·핀터레스트 코디 사진 저장 → AI가 옷을 하나씩 나누고 내 옷장의 비슷한 옷과 매칭, 없는 옷은 위시리스트로, "내 옷으로 따라 입기" |
| 위시 | 사고 싶은 옷 + 총액, "이걸 사면 만들 수 있는 코디" AI 확인, "샀어요" → 옷장으로 이동 |
| 설정 | 날씨 위치, iPhone 단축어 연결 방법, 로그아웃 |

아직 없는 것 (기획서의 뒷단계): 퍼스널 컬러/체형 진단, 가상 피팅, 여행 짐 싸기, 거울 셀카 자동 기록, 옷 사진 배경 제거.

## 배포 (Life 앱과 같은 방식)

GitHub에 코드가 올라가면 Cloudflare가 알아서 빌드하고 배포합니다. 처음 한 번만 Cloudflare 대시보드에서:

1. Workers & Pages → `clothe` → Settings → Build → **Connect** → GitHub 저장소 `bingsu5746/clothe` 선택
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
2. Settings → Variables and Secrets 에 Secret 2개 추가
   - `APP_PIN`: 로그인 PIN (공개 주소라 6자리 이상 권장. 15분에 5번 틀리면 15분 잠김)
   - `GEMINI_API_KEY`: [Google AI Studio](https://aistudio.google.com/apikey)에서 발급
   - (선택) `SHORTCUT_TOKEN`: iPhone 단축어용 아무 긴 문자열. 없으면 단축어 저장이 꺼져 있어요.
   - (선택) `SESSION_SECRET`: 없으면 APP_PIN으로 대신해요.

D1 데이터베이스(`clothe-db`)와 R2 버킷(`clothe-images`)은 첫 배포 때 wrangler가 자동으로 만들고, DB 테이블은 앱이 첫 요청 때 자동으로 만들어요. 따로 실행할 명령은 없어요.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars   # 값 채우기
npm run dev
```

`npm test` 로 단위 테스트, `npm run typecheck` 로 타입 검사.

## 참고

- Gemini 모델은 `wrangler.jsonc`의 `GEMINI_MODEL`(기본 `gemini-flash-latest`, Google이 최신 Flash로 자동 교체하는 별칭)로 바꿀 수 있어요. 무료 티어 한도는 프로젝트마다 다르니 AI Studio에서 확인하세요. 같은 요청은 D1에 캐시해서 다시 호출하지 않아요.
- 날씨는 [Open-Meteo](https://open-meteo.com/) 무료 API(비상업용, 키 불필요)를 브라우저에서 직접 호출해요. Worker 공용 IP의 요청 한도를 피하려는 것이고, 실패하면 서버를 거쳐요.
- 사진은 업로드 전에 브라우저에서 최대 1280px로 줄여 WebP(지원 안 되면 JPEG)로 압축해요.
- iPhone 공유 시트: iOS는 웹앱을 공유 목록에 직접 넣는 기능(Web Share Target)을 지원하지 않아서, 단축어 → `POST /api/webhook/shortcut` (헤더 `X-Shortcut-Token`)으로 저장해요. 자세한 설정은 앱의 설정 탭에 있어요.
