import type { Config } from "../config.js";
import { createPostgresDb } from "./postgres.js";
import { createSqliteDb } from "./sqlite.js";
import type { Db } from "./types.js";

export type { Db } from "./types.js";

/**
 * Escolhe o banco pelo prefixo da DATABASE_URL:
 *   postgres://... ou postgresql://...  -> Postgres
 *   file:... ou sqlite:... ou :memory:  -> SQLite
 */
export function createDb(config: Pick<Config, "DATABASE_URL" | "PG_POOL_MAX">): Db {
  const url = config.DATABASE_URL.trim();
  if (/^postgres(ql)?:\/\//i.test(url)) return createPostgresDb(url, config.PG_POOL_MAX);
  if (/^(file:|sqlite:)/i.test(url) || url === ":memory:") return createSqliteDb(url);
  throw new Error(
    `DATABASE_URL não reconhecida. Use "file:./data/hookrelay.db" (SQLite) ou "postgresql://..." (Postgres).`,
  );
}
