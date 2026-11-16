import { useState } from "react";
import type { TryOnAvailability } from "../../shared/types";
import { ChevronDownIcon, CopyIcon, LogoutIcon, MoonIcon, PhoneIcon, PinIcon, RefreshIcon, SearchIcon, ShareIcon, ShirtIcon } from "../components/icons";
import { Badge, Button, IconButton, Input, ListGroup, ListRow, Notice, Page, Segmented, Skeleton, confirmDialog, toast } from "../components/ui";
import { api } from "../lib/api";
import { DEFAULT_LOCATION, currentPosition, saveLocation, type SavedLocation } from "../lib/location";
import { useIsWide } from "../lib/hooks";
import { MORE_PATH } from "../nav";
import { clearQueries, mutateQuery, useQuery } from "../lib/query";
import { useThemeMode, type ThemeMode } from "../lib/theme";
import { searchPlace, type GeoResult as Geo } from "../lib/weather";

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded-xs bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] break-all">{children}</code>;

export default function Settings() {
  const settings = useQuery<{ location?: SavedLocation }>("/settings", { staleTime: 5 * 60_000 });
  const loc = settings.data ? (settings.data.location ?? DEFAULT_LOCATION) : null;
  const [theme, setTheme] = useThemeMode();
  const wide = useIsWide();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Geo[] | null>(null);
  const [busy, setBusy] = useState<"search" | "gps" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const choose = async (l: SavedLocation) => {
    await saveLocation(l);
    mutateQuery<{ location?: SavedLocation }>("/settings", (cur) => ({ ...cur, location: l }));
    setResults(null);
    setQ("");
    toast(`날씨 위치를 ${l.name}(으)로 바꿨어요`);
  };

  const search = async () => {
    if (!q.trim()) return;
    setErr(null);
    setBusy("search");
    try {
      setResults(await searchPlace(q.trim()));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const useGps = async () => {
    setErr(null);
    setBusy("gps");
    try {
      const p = await currentPosition();
      await choose({ ...p, name: "현재 위치" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    if (!(await confirmDialog({ title: "로그아웃할까요?", message: "다시 들어오려면 PIN이 필요해요.", confirmLabel: "로그아웃" }))) return;
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    try {
      localStorage.removeItem("clothe:authed");
    } catch {
      // 무시
    }
    clearQueries();
    window.location.assign("/");
  };

  const origin = window.location.origin;
  const webhook = `${origin}/api/webhook/shortcut`;

  return (
    <Page title="설정" width="narrow" back={wide ? undefined : MORE_PATH} large>
      <div className="space-y-8">
        <ListGroup title="화면">
          <div className="px-4 py-3.5">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-7 place-items-center text-ink-2">
                <MoonIcon size={22} />
              </span>
              <span className="text-body">테마</span>
            </div>
            <Segmented label="테마" value={theme} onChange={setTheme} options={THEMES} />
          </div>
        </ListGroup>

        <ListGroup title="날씨" footer="오늘 탭의 날씨와 코디 추천에 쓰여요.">
          <ListRow icon={<PinIcon size={22} />} title="기준 위치" trailing={loc?.name ?? "…"} />
          <div className="space-y-2 px-4 py-3.5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <Input placeholder="도시나 동네 이름 (예: 성수동)" aria-label="위치 검색" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
              <Button type="submit" className="h-12" disabled={!q.trim() || !!busy} loading={busy === "search"}>
                검색
              </Button>
            </form>
            {results &&
              (results.length === 0 ? (
                <p className="px-1 py-2 text-subhead text-muted">찾는 곳이 없어요. 다른 이름으로 검색해 보세요.</p>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-md bg-surface-2">
                  {results.map((r, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-baseline gap-2 px-3.5 py-2.5 text-left transition-colors duration-(--dur-fast) hover:bg-surface-3 active:bg-surface-3"
                        onClick={() => choose({ lat: r.latitude, lon: r.longitude, name: r.name })}
                      >
                        <span className="font-medium">{r.name}</span>
                        <span className="text-footnote text-muted">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            <Button block icon={<PinIcon size={18} />} onClick={useGps} loading={busy === "gps"} disabled={!!busy}>
              현재 위치 사용
            </Button>
            <Notice>{err}</Notice>
          </div>
        </ListGroup>

        <ListGroup title="iPhone에서 바로 저장하기">
          <details className="group">
            <summary className="flex min-h-13 items-center gap-3 px-4 hover:bg-surface-2">
              <span className="grid size-7 place-items-center text-ink-2">
                <ShareIcon size={22} />
              </span>
              <span className="flex-1 py-3">
                <span className="block text-body">공유 시트 단축어 만들기</span>
                <span className="mt-0.5 block text-footnote text-muted">인스타·쇼핑몰에서 공유 → 단축어 한 번으로 저장</span>
              </span>
              <ChevronDownIcon size={16} className="text-faint transition-transform duration-(--dur-base) group-open:rotate-180" />
            </summary>
            <div className="space-y-4 px-4 pt-1 pb-5 text-subhead">
              <p className="text-muted">iOS는 웹앱을 공유 목록에 직접 넣을 수 없어서 단축어를 거쳐요. 사진과 인스타·핀터레스트 링크는 스크랩으로, 그 밖의 쇼핑몰 링크는 위시리스트로 저장돼요.</p>
              <ol className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-muted">
                <li>
                  Cloudflare 대시보드 → Workers → clothe → Settings → Variables and Secrets 에 시크릿 <Code>SHORTCUT_TOKEN</Code>(아무 긴 문자열)을 넣어요. 없으면 단축어 저장은 항상 거절돼요.
                </li>
                <li>
                  단축어 앱 → 새 단축어 → 이름 옆 ⓘ → <b>공유 시트에서 보기</b>를 켜고, 받는 유형은 이미지와 URL.
                </li>
                <li>
                  동작 추가: <b>URL 콘텐츠 가져오기</b>
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-surface-2 py-1.5 pr-1.5 pl-3">
                    <span className="min-w-0 flex-1 font-mono text-footnote break-all">{webhook}</span>
                    <IconButton
                      label="주소 복사"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(webhook)
                          .then(() => toast("주소를 복사했어요"))
                          .catch(() => toast.error("복사하지 못했어요. 길게 눌러 복사해 주세요"))
                      }
                    >
                      <CopyIcon size={18} />
                    </IconButton>
                  </div>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
                    <li>방법: POST</li>
                    <li>
                      헤더: <Code>X-Shortcut-Token</Code> = 위에서 넣은 SHORTCUT_TOKEN 값
                    </li>
                    <li>
                      요청 본문: <b>양식</b> → 사진이면 <Code>file</Code>(파일), 링크면 <Code>url</Code>(텍스트)에 단축어 입력을 넣어요
                    </li>
                    <li>
                      (선택) <Code>target</Code> = <Code>inspiration</Code>(스크랩) 또는 <Code>wishlist</Code>, <Code>note</Code> = 메모
                    </li>
                    <li>
                      양식 대신 <b>JSON</b>(<Code>{"{ url, target, note }"}</Code>)이나 사진 파일 그대로, 링크가 든 텍스트 그대로 보내도 돼요.
                    </li>
                  </ul>
                </li>
                <li>
                  동작 추가: <b>사전 값 가져오기</b>(키 <Code>message</Code>) → <b>알림 보기</b>. 저장되면 &ldquo;스크랩에 저장했어요&rdquo; 같은 안내가 떠요.
                </li>
              </ol>
              <p className="text-footnote text-muted">토큰이 틀리면 401, 사진·링크가 없으면 400, 링크에서 사진을 못 가져오면 422로 돌아와요. 사설 IP·localhost 주소는 받지 않아요.</p>
            </div>
          </details>
          <ListRow icon={<PhoneIcon size={22} />} title="홈 화면에 추가" subtitle="Safari 공유 버튼 → 홈 화면에 추가를 누르면 주소창 없이 앱처럼 열려요." />
        </ListGroup>

        <Connections />

        <ListGroup title="앱">
          <ListRow icon={<RefreshIcon size={22} />} title="최신 버전으로 다시 불러오기" onClick={() => window.location.reload()} />
          <ListRow icon={<LogoutIcon size={22} />} title="로그아웃" destructive onClick={logout} />
        </ListGroup>
      </div>
    </Page>
  );
}

/** 선택 기능(유료·외부 키)이 켜져 있는지 서버에 물어본다 */
function Connections() {
  const tryon = useQuery<TryOnAvailability>("/tryon/status", { staleTime: 10 * 60_000 });
  const shop = useQuery<{ naver_enabled: boolean }>("/shopping/status", { staleTime: 10 * 60_000 });
  const state = (loading: boolean, error: string | null, on: boolean | undefined, onLabel: string) =>
    loading ? <Skeleton className="h-6 w-14 rounded-full" /> : error && on === undefined ? <Badge tone="danger">확인 실패</Badge> : on ? <Badge tone="solid">{onLabel}</Badge> : <Badge>꺼짐</Badge>;
  return (
    <ListGroup title="연결 상태" footer="AI 기능(Gemini)은 GEMINI_API_KEY 시크릿이 있어야 해요. 키가 없거나 한도를 넘으면 각 화면에서 이유를 알려 드려요.">
      <details className="group">
        <summary className="flex min-h-13 items-center gap-3 px-4 hover:bg-surface-2">
          <span className="grid size-7 place-items-center text-ink-2">
            <ShirtIcon size={22} />
          </span>
          <span className="min-w-0 flex-1 py-3">
            <span className="block text-body">AI 가상 피팅</span>
            <span className="mt-0.5 block text-footnote text-muted">
              {tryon.data?.available ? `${tryon.data.provider === "replicate" ? "Replicate" : "Gemini"} · ${tryon.data.model}` : (tryon.data?.reason ?? "선택 기능 (유료)")}
            </span>
          </span>
          {state(tryon.loading, tryon.error, tryon.data?.available, "켜짐")}
          <ChevronDownIcon size={16} className="text-faint transition-transform duration-(--dur-base) group-open:rotate-180" />
        </summary>
        <div className="px-4 pt-1 pb-4 text-subhead text-muted">
          {tryon.error && !tryon.data ? tryon.error : tryon.data?.available ? "피팅룸에서 전신 사진에 옷을 입혀 볼 수 있어요. 결과마다 외부 서비스 비용이 들어요." : (tryon.data?.setup_hint ?? "")}
        </div>
      </details>
      <details className="group">
        <summary className="flex min-h-13 items-center gap-3 px-4 hover:bg-surface-2">
          <span className="grid size-7 place-items-center text-ink-2">
            <SearchIcon size={22} />
          </span>
          <span className="min-w-0 flex-1 py-3">
            <span className="block text-body">네이버 쇼핑 검색</span>
            <span className="mt-0.5 block text-footnote text-muted">{shop.data?.naver_enabled ? "위시리스트에서 비슷한 상품과 가격을 찾아요" : "꺼져 있으면 쇼핑몰 검색 링크만 보여 드려요"}</span>
          </span>
          {state(shop.loading, shop.error, shop.data?.naver_enabled, "켜짐")}
          <ChevronDownIcon size={16} className="text-faint transition-transform duration-(--dur-base) group-open:rotate-180" />
        </summary>
        <div className="px-4 pt-1 pb-4 text-subhead text-muted">
          {shop.error && !shop.data ? (
            shop.error
          ) : shop.data?.naver_enabled ? (
            "네이버 쇼핑 검색 API가 연결돼 있어요 (하루 25,000회 무료)."
          ) : (
            <>
              네이버 개발자 센터에서 검색 API 애플리케이션을 만들고, Cloudflare 시크릿 <Code>NAVER_CLIENT_ID</Code>, <Code>NAVER_CLIENT_SECRET</Code>을 넣으면 켜져요. 무료예요.
            </>
          )}
        </div>
      </details>
    </ListGroup>
  );
}
