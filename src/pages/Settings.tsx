import { useState } from "react";
import { ChevronDownIcon, CopyIcon, LogoutIcon, MoonIcon, PhoneIcon, PinIcon, RefreshIcon, ShareIcon } from "../components/icons";
import { Button, IconButton, Input, ListGroup, ListRow, Notice, Page, Segmented, confirmDialog, toast } from "../components/ui";
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
              <p className="text-muted">iOS는 웹앱을 공유 목록에 직접 넣을 수 없어서 단축어를 거쳐요. 사진·인스타·핀터레스트 링크는 스크랩으로, 쇼핑몰 링크는 위시리스트로 저장돼요.</p>
              <ol className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-muted">
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
                      헤더: <Code>X-Shortcut-Token</Code> = Cloudflare에 넣어 둔 SHORTCUT_TOKEN 값
                    </li>
                    <li>
                      요청 본문: 양식 → 사진이면 <Code>file</Code>(파일), 링크면 <Code>url</Code>(텍스트)에 단축어 입력
                    </li>
                    <li>
                      (선택) <Code>target</Code> = <Code>inspiration</Code>(스크랩) 또는 <Code>wishlist</Code>
                    </li>
                  </ul>
                </li>
                <li>
                  동작 추가: <b>사전 값 가져오기</b>(키 <Code>message</Code>) → <b>알림 보기</b>
                </li>
              </ol>
            </div>
          </details>
          <ListRow icon={<PhoneIcon size={22} />} title="홈 화면에 추가" subtitle="Safari 공유 버튼 → 홈 화면에 추가를 누르면 주소창 없이 앱처럼 열려요." />
        </ListGroup>

        <ListGroup title="앱">
          <ListRow icon={<RefreshIcon size={22} />} title="최신 버전으로 다시 불러오기" onClick={() => window.location.reload()} />
          <ListRow icon={<LogoutIcon size={22} />} title="로그아웃" destructive onClick={logout} />
        </ListGroup>
      </div>
    </Page>
  );
}
