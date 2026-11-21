/**
 * 콜라주 보드에서 배경을 지운 사진을 이 기기(IndexedDB)에 보관한다.
 * 배치(localStorage)와 같이 "이 기기에만" 기억하고, 서버(R2)에는 올리지 않는다(어디에서도 안 쓰는 그림이 쌓이지 않게).
 * 저장 공간이 없거나 사생활 보호 모드라 실패하면 조용히 넘어간다 (이번 화면에서는 메모리로 계속 쓴다).
 */
const DB_NAME = "clothe-cutouts";
const STORE = "cutouts";
/** 오래된 것부터 지워서 이 개수만 남긴다 */
const MAX_ENTRIES = 40;

interface Entry {
  key: string;
  blob: Blob;
  at: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB를 쓸 수 없어요"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB를 열지 못했어요"));
  }).catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 오류"));
  });
}

/** 저장해 둔 배경 지운 사진들 (없는 key는 빠짐) */
export async function loadCutouts(keys: string[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (!keys.length) return out;
  try {
    const db = await open();
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const rows = await Promise.all(keys.map((k) => done(store.get(k) as IDBRequest<Entry | undefined>)));
    rows.forEach((r) => {
      if (r?.blob instanceof Blob) out.set(r.key, r.blob);
    });
  } catch {
    // 기기 저장소를 못 쓰면 원래 사진을 쓴다
  }
  return out;
}

export async function saveCutout(key: string, blob: Blob): Promise<void> {
  try {
    const db = await open();
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    await done(store.put({ key, blob, at: Date.now() } satisfies Entry));
    const all = (await done(db.transaction(STORE, "readonly").objectStore(STORE).getAll())) as Entry[];
    if (all.length > MAX_ENTRIES) {
      const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_ENTRIES);
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE);
      await Promise.all(old.map((e) => done(tx.delete(e.key))));
    }
  } catch {
    // 저장 실패: 이번 화면에서만 유지
  }
}

export async function deleteCutout(key: string): Promise<void> {
  try {
    const db = await open();
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
  } catch {
    // 무시
  }
}
