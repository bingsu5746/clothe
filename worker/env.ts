export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  GEMINI_MODEL: string;
  /** 가상 피팅 제공자: "replicate" | "gemini" | 비움(REPLICATE_API_TOKEN이 있으면 replicate, 없으면 꺼짐) */
  TRYON_PROVIDER: string;
  /** 가상 피팅 모델을 바꾸고 싶을 때만 (비우면 제공자별 기본값) */
  TRYON_MODEL: string;
  // secrets (wrangler secret put ... 또는 대시보드)
  APP_PIN: string;
  SESSION_SECRET: string;
  SHORTCUT_TOKEN: string;
  GEMINI_API_KEY: string;
  /** (선택) 네이버 쇼핑 검색 API */
  NAVER_CLIENT_ID: string;
  NAVER_CLIENT_SECRET: string;
  /** (선택) Replicate 가상 피팅 */
  REPLICATE_API_TOKEN: string;
}

export type AppEnv = { Bindings: Env };
