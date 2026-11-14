export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized?.();
    throw new ApiError(res.status, (data as { error?: string }).error ?? `요청 실패 (${res.status})`);
  }
  return data as T;
}

export const imageUrl = (key: string | null | undefined) => (key ? `/api/images/${key}` : null);

export async function uploadImage(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", new File([blob], "image", { type: blob.type }));
  const { key } = await api<{ key: string }>("/images", { method: "POST", body: form });
  return key;
}

export const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);
