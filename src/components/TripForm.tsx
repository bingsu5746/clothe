import { useState } from "react";
import type { Trip } from "../../shared/types";
import { api } from "../lib/api";
import { todayKST } from "../lib/items";
import { addDays } from "../lib/logs";
import { diffDays, nightsLabel, setTrip } from "../lib/trips";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Notice } from "./Feedback";
import { Field, Input, Textarea } from "./Field";
import { Sheet } from "./Sheet";

const NOTE_CHIPS = ["하루 2만 보 걷기", "비즈니스 미팅", "바닷가", "등산", "고급 레스토랑", "짐 최소화"];
const MAX_DAYS = 21;

/** 여행 만들기 / 고치기 시트 */
export function TripForm({ open, onClose, trip, onSaved }: { open: boolean; onClose: () => void; trip?: Trip | null; onSaved: (t: Trip) => void }) {
  const today = todayKST();
  const init = () => ({
    destination: trip?.destination ?? "",
    name: trip?.name ?? "",
    start: trip?.start_date ?? addDays(today, 7),
    end: trip?.end_date ?? addDays(today, 10),
    notes: trip?.notes ?? "",
  });
  const [f, setF] = useState(init);
  const [wasOpen, setWasOpen] = useState(open);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setF(init());
      setErr(null);
    }
  }

  const span = diffDays(f.start, f.end);
  const dateErr = !f.start || !f.end ? "날짜를 골라 주세요" : span < 0 ? "돌아오는 날이 출발일보다 빨라요" : span + 1 > MAX_DAYS ? `여행은 최대 ${MAX_DAYS}일까지 계획할 수 있어요` : null;

  const toggleNote = (c: string) => {
    const parts = f.notes.split(",").map((x) => x.trim()).filter(Boolean);
    const next = parts.includes(c) ? parts.filter((x) => x !== c) : [...parts, c];
    setF({ ...f, notes: next.join(", ") });
  };

  const submit = async () => {
    if (!f.destination.trim() || dateErr) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { destination: f.destination.trim(), name: f.name.trim() || null, start_date: f.start, end_date: f.end, notes: f.notes.trim() || null };
      const t = trip ? await api<Trip>(`/trips/${trip.id}`, { method: "PATCH", json: body }) : await api<Trip>("/trips", { method: "POST", json: body });
      setTrip(t);
      onSaved(t);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={trip ? "여행 정보 고치기" : "새 여행"}
      footer={
        <Button variant="primary" block loading={busy} disabled={!f.destination.trim() || !!dateErr} onClick={submit}>
          {trip ? "저장" : "여행 만들기"}
        </Button>
      }
    >
      <div className="space-y-5 pt-1">
        <Field label="여행지">
          <Input data-autofocus maxLength={100} placeholder="예: 도쿄, 제주 애월" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="출발">
            <Input type="date" className="tabular" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: e.target.value > f.end ? e.target.value : f.end })} />
          </Field>
          <Field label="돌아오는 날">
            <Input type="date" className="tabular" min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          </Field>
        </div>
        <p className={`-mt-3 text-footnote ${dateErr ? "text-danger" : "text-muted"}`}>{dateErr ?? nightsLabel({ start_date: f.start, end_date: f.end })}</p>
        <Field label="이름 (선택)">
          <Input maxLength={80} placeholder={f.destination.trim() ? `${f.destination.trim()} 여행` : "비우면 '여행지 여행'"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="일정 메모" hint="AI가 짐을 쌀 때 참고해요" group>
          <div className="mb-2 flex flex-wrap gap-2">
            {NOTE_CHIPS.map((c) => (
              <Chip key={c} active={f.notes.split(",").map((x) => x.trim()).includes(c)} onClick={() => toggleNote(c)}>
                {c}
              </Chip>
            ))}
          </div>
          <Textarea aria-label="일정 메모" maxLength={1000} placeholder="예: 둘째 날 결혼식, 저녁엔 쌀쌀할 듯" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        {trip && f.destination.trim() !== trip.destination && <Notice tone="info">여행지를 바꾸면 다음 계획 때 위치를 새로 찾아요.</Notice>}
        <Notice>{err}</Notice>
      </div>
    </Sheet>
  );
}
