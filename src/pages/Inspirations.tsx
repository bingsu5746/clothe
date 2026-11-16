import { useState } from "react";
import type { Inspiration } from "../../shared/types";
import { BookmarkIcon, PlusIcon } from "../components/icons";
import { PhotoInput } from "../components/items";
import { Button, Empty, Img, Notice, Page, Skeleton, Spinner, buttonClass, iconButtonClass } from "../components/ui";
import { api, imageUrl, uploadImage } from "../lib/api";
import { mutateQuery, useQuery } from "../lib/query";
import { AppLink, useNav } from "../lib/router";

export const INSPO_PATH = "/inspirations";
/** 스크랩 타일 비율: 인스타 세로 사진(4:5)에 맞춘 균일한 격자 */
const TILE_RATIO = "4 / 5";
const GRID = "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:gap-x-4 lg:grid-cols-4 xl:grid-cols-5";

export default function Inspirations() {
  const { data, loading, error, reload } = useQuery<Inspiration[]>(INSPO_PATH);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNav();

  const add = async (blob: Blob) => {
    setBusy(true);
    setErr(null);
    try {
      const key = await uploadImage(blob);
      const insp = await api<Inspiration>("/inspirations", { method: "POST", json: { image_key: key } });
      mutateQuery<Inspiration[]>(INSPO_PATH, (cur) => (cur ? [insp, ...cur] : cur));
      nav(`/inspo/${insp.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="스크랩"
      eyebrow={data?.length ? `${data.length}장` : undefined}
      subtitle="마음에 든 코디 사진을 모아 두면, AI가 옷을 하나씩 나눠 내 옷장과 비교해 줘요."
      right={
        <PhotoInput onPick={add} disabled={busy} label="사진 추가" className={iconButtonClass("primary")}>
          {busy ? <Spinner size={16} /> : <PlusIcon size={20} />}
        </PhotoInput>
      }
    >
      {err && (
        <Notice className="mb-4" title="사진을 저장하지 못했어요">
          {err}
        </Notice>
      )}
      {loading ? (
        <div className={GRID} role="status" aria-label="불러오는 중">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="rounded-md" style={{ aspectRatio: TILE_RATIO }} />
          ))}
        </div>
      ) : error && !data ? (
        <Notice
          title="스크랩을 불러오지 못했어요"
          action={
            <Button size="sm" onClick={reload}>
              다시 시도
            </Button>
          }
        >
          {error}
        </Notice>
      ) : !data?.length ? (
        <Empty
          icon={<BookmarkIcon size={26} />}
          title="스크랩한 코디가 없어요"
          action={
            <PhotoInput onPick={add} disabled={busy} className={buttonClass({ variant: "primary" })}>
              {busy ? <Spinner size={16} /> : <PlusIcon size={18} />} 사진 추가
            </PhotoInput>
          }
        >
          인스타그램이나 핀터레스트에서 저장한 사진을 올려 보세요. iPhone 공유 시트(단축어)로도 보낼 수 있어요.
        </Empty>
      ) : (
        <div className={GRID}>
          {data.map((i) => (
            <AppLink key={i.id} to={`/inspo/${i.id}`} className="pressable-soft group block min-w-0 rounded-md">
              <Img src={imageUrl(i.image_key)} ratio={TILE_RATIO} className="rounded-md transition-shadow duration-(--dur-base) group-hover:shadow-[0_0_0_1px_var(--line-strong)]" />
              <p className="mt-2 line-clamp-2 px-0.5 text-footnote text-muted">{i.analysis?.summary ?? "아직 분석하지 않았어요"}</p>
            </AppLink>
          ))}
        </div>
      )}
    </Page>
  );
}
