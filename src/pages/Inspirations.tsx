import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Inspiration } from "../../shared/types";
import { PlusIcon } from "../components/icons";
import { PhotoInput } from "../components/items";
import { Empty, ErrorText, PageHeader, Spinner } from "../components/ui";
import { api, imageUrl, uploadImage } from "../lib/api";
import { useFetch } from "../lib/items";

export default function Inspirations() {
  const { data, loading } = useFetch<Inspiration[]>("/inspirations");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  const add = async (blob: Blob) => {
    setBusy(true);
    setErr(null);
    try {
      const key = await uploadImage(blob);
      const insp = await api<Inspiration>("/inspirations", { method: "POST", json: { image_key: key } });
      nav(`/inspo/${insp.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="스크랩한 코디"
        right={
          <PhotoInput onPick={add} className="flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            {busy ? <Spinner small /> : <PlusIcon width={18} height={18} />} 사진 추가
          </PhotoInput>
        }
      />
      <p className="-mt-2 mb-4 text-sm text-muted">인스타·핀터레스트에서 마음에 든 코디를 저장해 두면, AI가 옷을 하나씩 나눠서 내 옷장과 비교해 줘요.</p>
      <ErrorText>{err}</ErrorText>
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty title="스크랩한 코디가 없어요">위의 사진 추가 버튼이나 iPhone 공유 시트(단축어)로 저장해 보세요.</Empty>
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
          {data.map((i) => (
            <Link key={i.id} to={`/inspo/${i.id}`} className="mb-3 block break-inside-avoid">
              <img src={imageUrl(i.image_key)!} alt="" loading="lazy" className="w-full rounded-xl bg-surface-2" />
              {i.analysis?.summary && <p className="mt-1 line-clamp-2 text-xs text-muted">{i.analysis.summary}</p>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
