export type Param = string | number | null;

/**
 * Interface mínima de banco. Os dois adaptadores (SQLite e Postgres)
 * implementam isso, então o resto da aplicação não sabe qual banco está em uso.
 *
 * Os placeholders nas queries são sempre "?" (o adaptador do Postgres converte para $1, $2...).
 */
export interface Db {
  readonly dialect: "sqlite" | "postgres";
  /** SELECT: retorna as linhas. */
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  /** SELECT: retorna a primeira linha (ou undefined). */
  get<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | undefined>;
  /** INSERT/UPDATE/DELETE: retorna quantas linhas foram afetadas. */
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  close(): Promise<void>;
}
