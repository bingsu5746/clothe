export function newId(): string {
  return crypto.randomUUID();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
