import type { Confidence, Profile } from "../../shared/types";
import { api } from "./api";
import { invalidateQueries, mutateQuery, useQuery } from "./query";

export const PROFILE_PATH = "/profile";

export function useProfile() {
  return useQuery<Profile>(PROFILE_PATH, { staleTime: 5 * 60_000 });
}

/** 프로필이 바뀌면 그걸 키로 쓰는 다른 결과(위시 판독의 stale 등)도 새로 받게 한다 */
export function setProfile(p: Profile & { cached?: boolean }) {
  const { cached: _cached, ...profile } = p;
  void _cached;
  mutateQuery<Profile>(PROFILE_PATH, profile);
  invalidateQueries((path) => path.startsWith("/wishlist"));
}

export async function patchProfile(body: Partial<Pick<Profile, "height_cm" | "weight_kg" | "face_image_key" | "body_image_key" | "mannequin_images">>): Promise<Profile> {
  const p = await api<Profile>(PROFILE_PATH, { method: "PATCH", json: body });
  setProfile(p);
  return p;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "확신 높음", medium: "확신 보통", low: "확신 낮음" };

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}
