import { Segmented } from "./Chip";
import { useNav } from "../lib/router";

/** 코디 화면 위쪽 "저장한 코디 | OOTD 캘린더" 전환 */
export function OutfitsTabs({ value }: { value: "saved" | "calendar" }) {
  const nav = useNav();
  return (
    <Segmented
      label="코디 보기"
      className="mb-6 md:max-w-sm"
      value={value}
      onChange={(v) => v !== value && nav(v === "saved" ? "/outfits" : "/outfits/calendar", { replace: true })}
      options={[
        { value: "saved", label: "저장한 코디" },
        { value: "calendar", label: "OOTD 캘린더" },
      ]}
    />
  );
}
