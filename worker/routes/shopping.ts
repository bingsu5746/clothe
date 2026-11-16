import { Hono } from "hono";
import type { AppEnv } from "../env";
import { naverEnabled, searchShopping } from "../lib/shopping";
import { HttpError } from "../lib/util";

const app = new Hono<AppEnv>();

/** 네이버 쇼핑 API를 쓸 수 있는지 (설정 화면용) */
app.get("/status", (c) => c.json({ naver_enabled: naverEnabled(c.env) }));

/**
 * 쇼핑 검색. ?q=검색어&limit=10
 * 네이버 키가 있으면 상품 결과(results) + 검색 링크(links), 없으면 링크만.
 */
app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").replace(/\s+/g, " ").trim();
  if (!q) throw new HttpError(400, "검색어를 입력해 주세요");
  if (q.length > 100) throw new HttpError(400, "검색어가 너무 길어요 (최대 100자)");
  const rawLimit = c.req.query("limit");
  const limit = rawLimit === undefined ? 10 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new HttpError(400, "limit은 1~30 사이의 정수여야 해요");
  return c.json(await searchShopping(c.env, q, limit));
});

export default app;
