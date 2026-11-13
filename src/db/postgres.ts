import pg from "pg";
import type { Db, Param } from "./types.js";

/** Troca os "?" por $1, $2, ... (formato do Postgres). */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function createPostgresDb(url: string, poolMax: number): Db {
  const pool = new pg.Pool({ connectionString: url, max: poolMax });
  // Evita derrubar o processo se uma conexão ociosa cair (comum em bancos serverless).
  pool.on("error", (err) => console.error("[postgres] erro em conexão ociosa:", err.message));

  return {
    dialect: "postgres",
    async all<T>(sql: string, params: Param[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async run(sql: string, params: Param[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async close() {
      await pool.end();
    },
  };
}
