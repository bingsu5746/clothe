import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CATEGORY_LABEL, type Item, type Outfit } from "../../shared/types";
import { ItemImage, ItemPicker } from "../components/items";
import { Button, ErrorText, PageHeader, Spinner, toast } from "../components/ui";
import { api } from "../lib/api";
import { useFetch, useItems } from "../lib/items";

export default function OutfitDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { byId, reload: reloadItems } = useItems();
  const { data: list, loading, error, reload } = useFetch<Outfit[]>("/outfits");
  const [editing, setEditing] = useState(false);
  const outfit = list?.find((o) => o.id === id);

  if (loading) return <Spinner />;
  if (!outfit) return <ErrorText>{error ?? "코디를 찾을 수 없어요"}</ErrorText>;
  const items = outfit.item_ids.map((x) => byId.get(x)).filter(Boolean) as Item[];

  const rename = async () => {
    const name = prompt("코디 이름", outfit.name);
    if (!name) return;
    await api(`/outfits/${outfit.id}`, { method: "PATCH", json: { name } });
    reload();
  };

  return (
    <>
      <PageHeader
        title={outfit.name}
        back="/outfits"
        right={
          <button className="text-sm font-semibold text-muted" onClick={rename}>
            이름 변경
          </button>
        }
      />
      {outfit.reason && <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-[15px]">{outfit.reason}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((i) => (
          <Link key={i.id} to={`/closet/${i.id}`}>
            <ItemImage item={i} className="aspect-[3/4]" />
            <div className="mt-1 truncate text-sm font-medium">{i.name}</div>
            <div className="text-xs text-muted">{CATEGORY_LABEL[i.category]}</div>
          </Link>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={async () => {
            await api("/items/wear", { method: "POST", json: { item_ids: outfit.item_ids, outfit_id: outfit.id } });
            await reloadItems();
            toast("오늘 착용으로 기록했어요");
          }}
        >
          오늘 입을래요
        </Button>
        <Button onClick={() => setEditing(true)}>옷 바꾸기</Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm("이 코디를 삭제할까요?")) return;
            await api(`/outfits/${outfit.id}`, { method: "DELETE" });
            nav("/outfits");
          }}
        >
          삭제
        </Button>
      </div>
      {editing && (
        <ItemPicker
          open
          onClose={() => setEditing(false)}
          initial={outfit.item_ids}
          onDone={async (ids) => {
            setEditing(false);
            await api(`/outfits/${outfit.id}`, { method: "PATCH", json: { item_ids: ids } });
            reload();
          }}
        />
      )}
    </>
  );
}
