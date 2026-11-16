# 내 옷장 디자인 시스템

새 화면을 만들 때 이 문서의 토큰·컴포넌트·패턴만으로 조립하면 기존 화면과 같은 결이 나옵니다.
토큰은 `src/index.css`, 컴포넌트는 `src/components/`(한 번에 `import … from "../components/ui"`), 내비게이션은 `src/nav.ts` 에 있습니다.

## 1. 원칙

1. **종이와 잉크.** 색은 배경(종이)·글자(잉크)·위험(빨강) 세 가지뿐. 브랜드 색, 그라데이션, 이모지 장식 없음. 색은 옷 사진이 냅니다.
2. **사진 먼저.** 옷은 3:4 타일, 스크랩은 4:5 타일. 사진 자리는 항상 먼저 잡아 두고(비율 상자) 불러온 뒤 페이드인.
3. **글자로 위계를.** 굵기와 크기 대비로 구조를 만들고, 테두리·그림자는 최소한(0.5~1px 선).
4. **네이티브처럼.** 큰 제목이 스크롤에 접히는 머리, 아래 탭 바, 끌어내려 닫는 시트, 눌림 피드백, 안전 영역.
5. **기다림은 뼈대로.** 내용이 올 자리는 스피너 대신 스켈레톤. 값싼 동작(착용 +1, 코디 저장, 이름 변경)은 화면을 먼저 바꾸고 실패하면 되돌림.
6. **한국어.** 모든 문구는 한국어 해요체. `word-break: keep-all` 이 전역이라 어절 단위로 줄바꿈됩니다.

## 2. 토큰

### 색 (`bg-*`, `text-*`, `border-*` 유틸리티로 사용)

| 토큰 | 라이트 | 다크 | 쓰임 |
|---|---|---|---|
| `bg` | `#faf9f7` | `#0f0f0e` | 화면 배경 |
| `surface` | `#ffffff` | `#191918` | 카드, 대화상자 |
| `surface-2` | `#f1efeb` | `#222220` | 입력칸, 칩, 보조 버튼, 사진 자리 |
| `surface-3` | `#e7e4de` | `#2e2e2b` | surface-2 의 hover, 스위치 꺼짐 |
| `ink` | `#141413` | `#f4f3ef` | 본문·제목 |
| `ink-2` | `#44423e` | `#cfcdc6` | 덜 중요한 본문 |
| `muted` | `#6b6862` | `#9c9991` | 보조 설명 (배경 대비 4.5:1 이상) |
| `faint` | `#a29e96` | `#6a6862` | placeholder, 비활성 아이콘 전용 (본문에 쓰지 말 것) |
| `line` / `line-strong` | 잉크 9% / 18% | 잉크 10% / 20% | 구분선 / 바 경계선 |
| `accent` / `accent-ink` | 잉크 / 종이 | 종이 / 잉크 | 주 버튼, 선택 표시 (= 잉크 반전) |
| `danger` / `danger-soft` | `#b3261e` | `#ff7a6b` | 삭제, 오류 |
| `scrim` | 잉크 38% | 검정 60% | 모달 뒤 가림막 |

테마: `<html data-theme="light|dark">`. 기본은 시스템을 따르고 설정에서 고정할 수 있습니다(`localStorage["clothe:theme"]`). `index.html` 의 인라인 스크립트가 첫 페인트 전에 적용하고, 이후 변경은 `src/lib/theme.ts` 의 `useThemeMode()`. 다크 전용 스타일은 `dark:` 변형.

### 글자 (`text-*`)

| 유틸리티 | 크기/줄높이 | 굵기 | 쓰임 |
|---|---|---|---|
| `text-display` | 56 / 1.0 | 600 | 기온 같은 큰 숫자 하나 |
| `text-large-title` | 32 / 1.15 (md 이상 40) | 700 | 최상위 화면 제목 |
| `text-title-1` | 24 / 1.25 | 700 | 상세 화면의 이름 |
| `text-title-2` | 20 / 1.3 | 650 | 구역 제목 |
| `text-headline` | 17 / 1.4 | 600 | 카드 제목, 바의 작은 제목 |
| `text-body` | 16 / 1.55 | 400 | 본문 |
| `text-callout` | 15 / 1.5 | 400 | 버튼, 보조 본문 |
| `text-subhead` | 14 / 1.45 | 400 | 메타 정보, 칩 |
| `text-footnote` | 13 / 1.4 | 400 | 라벨, 캡션 |
| `text-caption` | 12 / 1.35 | 400 | 아주 작은 보조 글 |
| `text-eyebrow` | 11 / 1.3, 자간 +0.06em | 600 | 카테고리·브랜드 머리말 (`<Eyebrow>`) |

글꼴은 Pretendard Variable(없으면 시스템 글꼴). 숫자가 나란히 놓이는 곳(가격, 횟수)은 `tabular` 유틸리티. 입력칸은 iOS 확대 방지를 위해 항상 16px 이상.

### 간격·모서리·그림자

- 간격은 Tailwind 4px 단위. 화면 좌우 여백은 `--gutter`(모바일 20 / 태블릿 32 / 데스크톱 40px) → `px-gutter`. 구역 사이 32~40px(`space-y-8`/`space-y-10`), 카드 안 16~20px, 격자 간격 가로 12~16 / 세로 24~32px.
- 모서리: `rounded-xs` 6 · `rounded-sm` 10(작은 썸네일) · `rounded-md` 14(사진 타일, 입력칸) · `rounded-lg` 20(카드) · `rounded-xl` 28(시트, 대화상자) · `rounded-full`(버튼, 칩).
- 그림자: `shadow-1`(거의 없음) · `shadow-2`(떠 있는 작은 것: 세그먼트 손잡이, 새로고침 표시) · `shadow-3`(시트, 대화상자, 토스트). 카드는 그림자 대신 `shadow-[0_0_0_1px_var(--line)]` 한 줄 선.

### 움직임

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--dur-fast` | 120ms | 눌림, hover |
| `--dur-base` | 200ms | 색·투명도 전환 |
| `--dur-slow` | 320ms | 세그먼트 손잡이, 사진 페이드인, 모달 |
| `--dur-sheet` | 440ms | 시트 올라오기 |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | 기본 |
| `ease-emphasized` | `cubic-bezier(.32,.72,0,1)` | 시트, 화면 밀기 (iOS 곡선) |
| `ease-exit` | `cubic-bezier(.4,0,1,1)` | 사라질 때 |

`duration-(--dur-base) ease-emphasized` 처럼 씁니다. 준비된 애니메이션: `animate-fade-in/out`, `animate-rise-in`, `animate-pop-in/out`, `animate-sheet-in/out`. `prefers-reduced-motion` 이면 모든 애니메이션·화면 전환이 꺼집니다(전역 처리, 따로 할 일 없음).

### 레이아웃 변수와 유틸리티

- `--safe-top/bottom/left/right` = `env(safe-area-inset-*)`. 유틸리티 `pt-safe` `pb-safe` `pl-safe` `pr-safe`.
- `--bar-h`(머리 바 48/56px), `--tabbar-h`(52px), `--nav-w`(사이드바 0 / 84 / 248px), `--bottom-inset`(탭 바 + 홈 인디케이터. 탭 바가 없는 폭에서는 0).
- `px-gutter`, `bleed-gutter`(부모 여백을 뚫고 화면 끝까지 — 가로 스크롤 줄), `scroll-x`(가로 스크롤, 스크롤바 숨김), `scroll-y`, `pressable`(버튼 눌림), `pressable-soft`(카드·타일 눌림), `bar-material`(반투명 블러 바), `hairline-t/b`, `skeleton`, `tabular`.
- 중단점: `md` 768(사이드바 레일 + 분할 보기 시작) · `nav` 1100(전체 사이드바) · `xl` 1280(3열·2단 구성).

## 3. 컴포넌트

모두 `src/components/ui.tsx` 에서 내보냅니다. 옷 관련은 `src/components/items.tsx`, 아이콘은 `src/components/icons.tsx`.

### 동작

| 컴포넌트 | 주요 props | 메모 |
|---|---|---|
| `Button` | `variant: primary \| secondary(기본) \| outline \| ghost \| danger`, `size: sm \| md \| lg`, `block`, `loading`, `icon` | 화면당 `primary` 는 하나. `sm` 도 터치 영역은 44px |
| `ButtonLink` | `to` + Button 과 같은 모양 props | 앱 안 이동 |
| `IconButton` | `label`(필수), `variant: ghost \| filled \| primary`, `loading` | 머리 바의 동작. 보이는 크기 36, 터치 44 |
| `buttonClass()` / `iconButtonClass()` | 같은 옵션 | `<a>`, `PhotoInput` 등에 버튼 모양을 입힐 때 |
| `Spinner` | `size` | 버튼 안이나 사진 위 진행 표시에만 |

```tsx
<Button variant="primary" size="lg" block loading={saving} onClick={save}>옷장에 넣기</Button>
<IconButton label="코디 만들기" variant="primary" onClick={open}><PlusIcon size={20} /></IconButton>
```

### 입력

| 컴포넌트 | 주요 props | 메모 |
|---|---|---|
| `Field` | `label`, `hint`, `group` | 라벨 + 입력. 칩·세그먼트를 감쌀 때는 `group` |
| `Input`, `Textarea`, `SearchInput` | 기본 input 속성 | `inputCls` 로 같은 모양을 직접 줄 수도 있음 |
| `Switch` | `checked`, `onChange`, `label` | 켜고 끄기 |
| `Chip` / `ChipRow` | `active`, `onClick` / `wrap`, `label` | 여러 개 고르기·필터. `ChipRow` 는 모바일에서 화면 끝까지 가로 스크롤, `wrap` 이면 줄바꿈 |
| `Segmented` | `value`, `onChange`, `options: {value,label}[]`, `label` | 하나만 고르기(2~5개). 좌우 화살표 키 지원 |

```tsx
<Field label="보온성" hint="1 아주 얇음 – 5 아주 따뜻함" group>
  <Segmented label="보온성" value={warmth} onChange={setWarmth} options={[1,2,3,4,5].map((v) => ({ value: v, label: String(v) }))} />
</Field>
```

### 담는 것

| 컴포넌트 | 주요 props | 메모 |
|---|---|---|
| `Page` | `title`, `eyebrow`, `subtitle`, `back`, `backStyle`, `right`, `large`, `width: narrow \| default \| wide` | 모든 화면의 뼈대 (아래 4장) |
| `Section` | `title`, `description`, `action` | 화면 안 한 구역 |
| `Card` | `padded`, `as` | 표면 + 1px 선 |
| `ListGroup` / `ListRow` | `title`, `footer` / `icon`, `title`, `subtitle`, `trailing`, `to`, `onClick`, `destructive` | 설정식 묶음 목록 |
| `Stat` | `label`, `value` | 숫자 하나 |
| `Badge` | `tone: neutral \| solid \| danger` | 상태 꼬리표 |
| `Eyebrow` | – | 작은 머리말 |
| `Img` | `src`, `ratio`, `fit`, `loading`, `fallback`, `onNaturalSize` | 비율 상자 + 페이드인. 목록은 lazy(기본), 화면 맨 위 큰 사진만 `loading="eager"` |

### 상태·피드백

| 컴포넌트 | 주요 props | 메모 |
|---|---|---|
| `Skeleton`, `SkeletonText`, `SkeletonTile`, `SkeletonGrid` | `className`, `lines`, `count`, `ratio` | 실제 레이아웃과 같은 격자 클래스를 넘겨 자리가 밀리지 않게 |
| `Empty` | `icon`, `title`, `children`, `action` | 빈 상태. **반드시 다음 행동(action)을 줍니다** |
| `Notice` | `tone: error \| info`, `title`, `action` | 화면 안 알림 띠. AI 실패는 `title` + 서버 메시지 + "다시 시도" 버튼 |
| `toast(msg, { tone, action, duration })`, `toast.error(msg)` | – | 짧은 결과 알림. 탭 바 위에 뜸 |
| `confirmDialog({ title, message, confirmLabel, destructive })` → `Promise<boolean>` | – | `window.confirm` 대신 |
| `promptDialog({ title, message, defaultValue, placeholder, inputMode, allowEmpty })` → `Promise<string \| null>` | – | `window.prompt` 대신. 취소하면 `null` |
| `Sheet` | `open`, `onClose`, `title`, `footer`, `size: md \| lg` | 모바일은 아래 시트(손잡이를 끌어내려 닫기), 넓은 화면은 가운데 모달. 포커스 가두기·Esc·바깥 누르기 포함 |

```tsx
if (await confirmDialog({ title: "이 옷을 삭제할까요?", confirmLabel: "삭제", destructive: true })) { … }
const name = await promptDialog({ title: "코디 이름", defaultValue: "내 코디" });
toast("위시리스트에 추가했어요", { action: { label: "보기", onClick: () => nav(`/wishlist/${id}`) } });
```

`ToastHost` 와 `DialogHost` 는 `App.tsx` 에 이미 한 번씩 있습니다.

### 옷 관련 (`components/items.tsx`)

| 컴포넌트 | 메모 |
|---|---|
| `ItemImage` | 옷 사진 한 장(3:4). 사진이 없으면 옷걸이 아이콘 |
| `ItemCard` | 옷장 격자 카드(사진·브랜드·이름·착용/회당 가격). `selected` 면 테두리 |
| `OutfitCollage` | 코디 미리보기: 3:4 타일 4칸 한 줄, 넘치면 `+N`. `extra` 로 맨 앞 타일 추가 |
| `CategoryFilter` | 카테고리 칩 줄(개수 표시) |
| `ItemPicker` | 옷 여러 벌 고르는 시트 |
| `PhotoInput` | 사진 고르기/찍기(`capture`). 방향 보정·축소·압축된 Blob 을 `onPick` 으로 |
| `ITEM_RATIO` | `"3 / 4"` |

### 2차 화면에서 추가한 것

| 컴포넌트 | 위치 | 메모 |
|---|---|---|
| `Rating` | `components/Rating.tsx` (첫 화면 번들에 안 들어가도록 ui.tsx 에서 내보내지 않음) | 별점 1~5 고르기(radiogroup, 좌우 화살표, 같은 별을 다시 누르면 지움). 별 하나가 44px |
| `Stars` | `components/Rating.tsx` | 읽기 전용 별점 (`role="img"`, "4점") |
| `TagEditor` | `components/Rating.tsx` | 자주 쓰는 태그 칩 + 직접 입력(Enter/쉼표). OOTD 상황 태그 |
| `OutfitsTabs` | `components/OutfitsTabs.tsx` | 코디 화면 "저장한 코디 \| OOTD 캘린더" 세그먼트(경로 `/outfits` ↔ `/outfits/calendar`, replace 이동) |
| `TripForm` | `components/TripForm.tsx` | 여행 만들기/고치기 시트 (날짜 검사 21일, 메모 칩) |
| `CollageBoard` | `components/CollageBoard.tsx` | 2D 콜라주 보드. 피팅룸에서만 쓰여 그 화면 조각에 같이 묶임 |

데이터 도우미: `lib/profile.ts`(`useProfile`, `setProfile`, `patchProfile`), `lib/logs.ts`(`monthPath`, `applyLog`, `removeLog`, `dayLabel`), `lib/trips.ts`(`setTrip`, `dday`, `nightsLabel`), `lib/color.ts`(화이트밸런스·색 뽑기), `query.ts` 의 `invalidateQueries(match)`(보고 있는 화면이면 바로, 아니면 다음에 열 때 새로 받음). `wearItems()` 는 서버의 `WearResult` 로 옷 캐시를 맞추고 달력·장롱템 캐시를 무효화하며, 토스트 문구는 `wearToast(result)`(같은 날 같은 조합이면 "이미 기록돼 있어요").

패턴 메모:
- **사진 위에서 위치 고르기**(퍼스널 컬러 색 뽑기): 사진 상자에 `role="application"` + `tabIndex=0`, 누르면 그 자리, 화살표 키로 1%(Shift 5%) 이동. 표시는 흰 테두리 + 어두운 바깥선 원 + 이름표(어떤 사진 위에서도 보이게).
- **끌어 놓는 보드**(콜라주): 보드 하나가 pointer 이벤트를 받고 `touch-action: none`. 각 조각은 `<button>` 이라 Tab 으로 고르고 화살표·+/-·[ ]·R·Delete 로 다룬다. 같은 동작을 아래 도구 막대와 레이어 목록(위·아래·빼기 IconButton)으로도 할 수 있게 둔다.
- **달력**: `role="grid"`, 칸은 roving tabindex(포커스된 칸만 0). 화살표로 하루/일주일, PageUp/PageDown 으로 달, Home/End. 기록 있는 날은 셀카(없으면 첫 옷 사진)를 3:4 칸에 채우고 날짜는 위 그라데이션 위에.
- **AI 점수의 근거**(살까 말까): 큰 점수 링 + 항목별 `점수 / 만점` 막대 + 계산식 한 줄. 프로필이 없어 빠진 항목은 "점수에서 제외" 꼬리표와 프로필로 가는 링크.
- **오래 걸리는 외부 작업**(가상 피팅): 2.5초 폴링, 경과 시간 + 끝을 모르는 막대(`animate-[indeterminate_…]`, 동작 줄이기면 멈춘 막대), "화면을 떠나도 계속돼요" 안내, 다시 들어오면 진행 중인 작업을 이어서 보여 줌.
- **예보처럼 없을 수 있는 값**: 없는 날은 "예보 없음"으로 쓰고 숫자를 만들지 않는다.

### 아이콘

`icons.tsx` 의 선 아이콘(24 격자, 굵기 1.6). `<PlusIcon size={20} />`. 새 아이콘은 같은 파일에 `make(<path … />)` 로 추가합니다. 이모지를 아이콘으로 쓰지 않습니다.

## 4. 레이아웃 패턴

### 뼈대와 내비게이션

`Layout` 이 폭에 따라 내비게이션을 바꿉니다. 스크롤은 문서 전체가 맡습니다(상태 표시줄 탭 → 맨 위, 관성 스크롤).

| 폭 | 내비게이션 |
|---|---|
| < 768 (iPhone) | 아래 탭 바: 오늘 · 옷장 · 코디 · 스크랩 · 더보기 |
| 768–1099 (iPad 세로) | 왼쪽 아이콘 레일(84px) |
| ≥ 1100 (iPad 가로, Mac) | 왼쪽 사이드바(248px) |

**목적지는 `src/nav.ts` 한 곳에서 정합니다.** 새 화면을 붙이려면 ① `src/pages/` 에 화면 작성 ② `src/App.tsx` 의 `loaders` 에 `() => import(...)`, `lazy(...)` 상수, `<Route>` 를 추가 ③ `nav.ts` 에서 `enabled: true`. 모바일에서는 `mobile: "more"` 항목이 "더보기" 화면(`/more`)에 자동으로 나타납니다. 탭은 4개까지만 `mobile: "tab"` 으로 두세요.

### 화면 하나

```tsx
export default function Travel() {
  return (
    <Page title="여행" eyebrow="2건" right={<IconButton label="여행 추가" variant="primary">…</IconButton>}>
      …내용…
    </Page>
  );
}
```

- 최상위 화면은 큰 제목(기본). 스크롤하면 바에 작은 제목이 나타나고 반투명 배경이 깔립니다.
- 하위 화면은 `back="/부모경로"` → 큰 제목 없이 바에 제목. 뒤로 버튼은 직전 화면이 그 경로면 `history.back()`(스크롤 위치 복원), 아니면 그 경로로 이동.
- `width`: 폼·설정은 `narrow`(720px), 일반은 `default`(1200px), 격자가 화면을 다 쓰는 목록은 `wide`.
- `Page` 가 좌우 여백, 탭 바 높이만큼의 아래 여백, 상단 안전 영역을 처리합니다. 화면에서 `env(safe-area-inset-*)` 를 직접 쓸 일은 화면 아래에 고정되는 요소를 만들 때뿐입니다(`bottom-[calc(var(--bottom-inset)+16px)]`).

### 분할 보기 (목록 + 상세)

옷장(`pages/Closet.tsx`)이 본보기입니다. 경로를 중첩하고(`/closet` 안에 `:id`), 부모가 목록과 `<Outlet />` 을 나란히 그립니다.

- 모바일: 상세 경로면 목록을 숨기고 상세가 화면 전체.
- 768px 이상: 목록은 그대로, 오른쪽 패널(`md:sticky md:top-0 md:h-dvh md:overflow-y-auto`, 폭 `clamp(340px,40vw,460px)`)에 상세. 목록의 링크는 `preventScrollReset` 으로 스크롤을 유지하고, 상세의 `Page` 는 `backStyle="close"`.
- 같은 컴포넌트가 다른 `:id` 로 다시 쓰이므로 상세는 `key={id}` 로 감싸 상태를 초기화합니다.

코디·OOTD 캘린더·여행 목록도 같은 방식으로 만들 수 있습니다.

### 격자

- 옷: `grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(156px,1fr))]`
- 스크랩: 2 / 3 / 4 / 5열, 4:5 타일
- 카드(코디): 1 / 2(md) / 3(xl)열
- 모바일의 가로 카드 줄: `scroll-x bleed-gutter snap-x gap-3` + 카드 `w-[78%] shrink-0 snap-start`, md 이상에서 격자로.

### 상세 화면 2단

사진은 왼쪽에 붙박이(`md:sticky md:top-[calc(var(--safe-top)+var(--bar-h)+8px)] md:self-start`), 내용은 오른쪽: `grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]`. AI 의 한 줄 평은 `border-l-2 border-ink pl-4 text-body text-ink-2` 인용 스타일.

## 5. 데이터·이동·전환 (화면 코드가 지킬 것)

- **데이터**: `useQuery<T>("/경로")`(`src/lib/query.ts`). 화면을 오가도 캐시를 바로 보여 주고 30초가 지났으면 뒤에서 새로 받습니다. 목록 화면은 `loading`(스켈레톤) → `error && !data`(Notice + 다시 시도) → 빈 상태(Empty + action) → 내용 순서로 그립니다. 고친 뒤에는 `mutateQuery(path, updater)` 로 캐시를 직접 고치고, 값싼 동작은 `optimistic(path, updater, action)`.
- **옷·코디**: `useItems()`, `useOutfits()`, `wearItems(ids)`(착용 +1, 낙관적), `createOutfit(body)`(낙관적), `patchItemInCache`, `removeItemFromCache` (`src/lib/items.tsx`).
- **이동**: `react-router` 의 `Link`/`useNavigate` 대신 `AppLink` / `AppNavLink` / `useNav()` / `useGoBack()`(`src/lib/router.tsx`). 라우터는 선언형 `BrowserRouter` 입니다(데이터 라우터 `createBrowserRouter` 는 번들이 약 20kB(gzip) 커서 쓰지 않음). 스크롤 복원은 `Layout` 의 `<NavigationEffects />` 가 하고, 이동해도 스크롤을 유지하려면 `AppLink preventScrollReset` / `nav(to, { preventScrollReset: true })`. View Transition 이 자동으로 걸립니다 — 모바일에서 깊이 들어가면 오른쪽에서 밀려 들어오고, 돌아오면 반대, 같은 깊이(탭)는 크로스페이드. 지원하지 않는 브라우저는 새 화면이 살짝 떠오르는 대체 애니메이션.
- **사진 업로드**: `PhotoInput` → (`compressImage`: EXIF 방향 보정, 최대 1280px, WebP / 안 되면 JPEG·PNG) → `uploadImage(blob)`. 배경 제거가 필요하면 `removeBackground(blob, onProgress)`(`src/lib/background.ts`) → `composeCutout`(3:4 로 다듬기). 라이브러리 코드는 처음 쓸 때 버전 고정 jsDelivr ESM 에서, 모델·WASM 은 staticimgly.com 에서 받습니다(npm 번들 시 24MB WASM 이 배포물에 복사되는 문제 때문). 실패하면 반드시 원본 사진으로 계속 진행하고 `Notice tone="info"` 로 알립니다. 가상 피팅의 마네킹 누끼에도 그대로 쓸 수 있습니다.
- **당겨서 새로고침**과 앱 복귀 시 새로고침은 `Layout`/`lib/pwa.ts` 가 `revalidateAll()` 로 처리하므로 `useQuery` 만 쓰면 자동으로 따라옵니다.

## 6. 접근성 점검표

- 터치 대상 44×44px 이상(작게 보이는 것은 `after:` 로 영역 확장 — `Button sm`, `IconButton`, `Chip` 은 이미 처리).
- 아이콘만 있는 버튼은 `IconButton label="…"`.
- 키보드 포커스 링은 전역(`:focus-visible`, 2px 잉크). 지우지 마세요.
- 본문 글자는 `ink`/`ink-2`/`muted` 만(대비 AA). `faint` 는 placeholder·장식 전용.
- 진행 상태에는 `role="status"`, 오류에는 `Notice`(=`role="alert"`).

## 7. 화면 상태 문구 (예시)

| 상황 | 패턴 |
|---|---|
| AI 키 없음·AI 실패 | `<Notice title="AI 분석을 하지 못했어요" action={<Button size="sm">다시 시도</Button>}>{서버 메시지}</Notice>` — 서버가 준 한국어 오류를 그대로 보여 주고, 직접 입력할 수 있는 길을 함께 안내 |
| 목록 불러오기 실패 | `Notice` + "다시 시도" (`reload`) |
| 빈 목록 | `Empty` + 주 행동 버튼 하나 ("첫 옷 등록하기", "코디 만들기") |
| 필터 결과 없음 | `Empty` + "필터 지우기" |
| 없는 주소 | `Empty title="…을 찾을 수 없어요"` + 목록으로 돌아가는 버튼 |
| 삭제 | `confirmDialog({ destructive: true })` → 성공 `toast("삭제했어요")` |
