import { api } from "./api";

export interface SavedLocation {
  lat: number;
  lon: number;
  name: string;
}

export const DEFAULT_LOCATION: SavedLocation = { lat: 37.5665, lon: 126.978, name: "서울" };

export async function getSavedLocation(): Promise<SavedLocation> {
  const s = await api<{ location?: SavedLocation }>("/settings").catch(() => ({}) as { location?: SavedLocation });
  return s.location ?? DEFAULT_LOCATION;
}

export async function saveLocation(loc: SavedLocation) {
  await api("/settings/location", { method: "PUT", json: loc });
}

export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("이 기기는 위치를 지원하지 않아요"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      () => reject(new Error("위치 권한이 필요해요")),
      { timeout: 10000, maximumAge: 30 * 60 * 1000 },
    );
  });
}
