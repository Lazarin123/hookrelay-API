import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db, Param } from "./types.js";

/** "file:./dev.db" -> "./dev.db" | ":memory:" -> ":memory:" */
export function sqlitePathFromUrl(url: string): string {
  let path = url.replace(/^sqlite:/, "").replace(/^file:/, "");
  if (path.startsWith("//")) path = path.slice(2);
  if (path === "" || path === ":memory:") return ":memory:";
  return path;
}

export function createSqliteDb(url: string): Db {
  const path = sqlitePathFromUrl(url);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return {
    dialect: "sqlite",
    async all<T>(sql: string, params: Param[] = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      return sqlite.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, params: Param[] = []) {
      const info = sqlite.prepare(sql).run(...params);
      return { changes: info.changes };
    },
    async close() {
      sqlite.close();
    },
  };
}
