export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  GEMINI_MODEL: string;
  // secrets (wrangler secret put ...)
  APP_PIN: string;
  SESSION_SECRET: string;
  SHORTCUT_TOKEN: string;
  GEMINI_API_KEY: string;
}

export type AppEnv = { Bindings: Env };
