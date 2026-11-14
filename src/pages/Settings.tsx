import { useEffect, useState } from "react";
import { PinIcon } from "../components/icons";
import { Button, Card, ErrorText, PageHeader, inputCls, toast } from "../components/ui";
import { api } from "../lib/api";
import { searchPlace, type GeoResult as Geo } from "../lib/weather";
import { currentPosition, getSavedLocation, saveLocation, type SavedLocation } from "../lib/location";


export default function Settings() {
  const [loc, setLoc] = useState<SavedLocation | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Geo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getSavedLocation().then(setLoc);
  }, []);

  const choose = async (l: SavedLocation) => {
    await saveLocation(l);
    setLoc(l);
    setResults([]);
    setQ("");
    toast(`위치를 ${l.name}(으)로 저장했어요`);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <PageHeader title="설정" />
      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 font-bold">날씨 기준 위치</h2>
          <p className="mb-3 flex items-center gap-1 text-sm text-muted">
            <PinIcon width={14} height={14} /> 지금: {loc?.name ?? "…"}
          </p>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try {
                setResults(await searchPlace(q));
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            <input className={inputCls} placeholder="도시나 동네 이름 (예: 성수동)" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button disabled={!q}>검색</Button>
          </form>
          {results.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    className="w-full px-3 py-2.5 text-left hover:bg-surface-2"
                    onClick={() => choose({ lat: r.latitude, lon: r.longitude, name: r.name })}
                  >
                    {r.name} <span className="text-sm text-muted">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            className="mt-2 w-full"
            onClick={async () => {
              setErr(null);
              try {
                const p = await currentPosition();
                await choose({ ...p, name: "현재 위치" });
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            현재 위치 사용
          </Button>
          <div className="mt-2">
            <ErrorText>{err}</ErrorText>
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">iPhone 공유 시트로 저장하기 (단축어)</h2>
          <p className="mb-3 text-sm text-muted">
            인스타·핀터레스트·쇼핑몰을 보다가 공유 버튼 → 단축어 한 번으로 이 앱에 바로 저장할 수 있어요. iOS에서는 웹앱이 공유 목록에 직접 뜨지 않아서 단축어를 거쳐요.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>단축어 앱 → 새 단축어 → 상단 이름 옆 ⓘ → <b>공유 시트에서 보기</b> 켜기, 받는 유형: 이미지, URL</li>
            <li>
              동작 추가: <b>URL 콘텐츠 가져오기</b>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                <li>URL: <code className="rounded bg-surface-2 px-1 break-all">{origin}/api/webhook/shortcut</code></li>
                <li>방법: POST</li>
                <li>헤더: <code className="rounded bg-surface-2 px-1">X-Shortcut-Token</code> = Cloudflare에 넣어 둔 SHORTCUT_TOKEN 값</li>
                <li>요청 본문: 양식(Form) → 사진이면 필드 이름 <code className="rounded bg-surface-2 px-1">file</code>(파일)에 단축어 입력, 링크면 <code className="rounded bg-surface-2 px-1">url</code>(텍스트)에 단축어 입력</li>
                <li>(선택) <code className="rounded bg-surface-2 px-1">target</code> = <code>inspiration</code>(스크랩) 또는 <code>wishlist</code></li>
              </ul>
            </li>
            <li>
              동작 추가: <b>사전 값 가져오기</b>(키: <code>message</code>) → <b>알림 보기</b>
            </li>
          </ol>
          <p className="mt-3 text-sm text-muted">기본 동작: 사진·인스타·핀터레스트 링크는 스크랩으로, 쇼핑몰 링크는 위시리스트로 저장돼요.</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">앱처럼 쓰기</h2>
          <p className="text-sm text-muted">Safari에서 공유 버튼 → 홈 화면에 추가를 누르면 주소창 없이 앱처럼 열려요.</p>
        </Card>

        <Button
          variant="danger"
          className="w-full"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" });
            location.reload();
          }}
        >
          로그아웃
        </Button>
      </div>
    </>
  );
}
