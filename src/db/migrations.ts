import type { Db } from "./types.js";

/**
 * Migrations em SQL portátil (funciona igual em SQLite e Postgres):
 *  - datas ficam em TEXT no formato ISO-8601 (ordenável como texto)
 *  - booleanos são INTEGER 0/1
 *
 * REGRA: toda instrução deve ser idempotente (IF NOT EXISTS), porque duas instâncias
 * da aplicação podem subir ao mesmo tempo e rodar as migrations juntas.
 * Nunca edite uma migration já publicada: crie uma nova no final da lista.
 */
const migrations: { id: string; statements: string[] }[] = [
  {
    id: "001_init",
    statements: [
      `CREATE TABLE IF NOT EXISTS endpoints (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        target_url TEXT,
        signing_secret TEXT,
        signature_header TEXT NOT NULL DEFAULT 'x-signature',
        reject_invalid_signature INTEGER NOT NULL DEFAULT 0,
        forward_secret TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
        method TEXT NOT NULL,
        query TEXT NOT NULL DEFAULT '',
        headers TEXT NOT NULL,
        body_b64 TEXT NOT NULL,
        body_size INTEGER NOT NULL,
        source_ip TEXT,
        signature_valid INTEGER,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        locked_until TEXT,
        last_error TEXT,
        received_at TEXT NOT NULL,
        delivered_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        status_code INTEGER,
        response_body TEXT,
        error TEXT,
        duration_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_events_endpoint ON events(endpoint_id, received_at)`,
      `CREATE INDEX IF NOT EXISTS idx_events_due ON events(status, next_attempt_at)`,
      `CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at)`,
      `CREATE INDEX IF NOT EXISTS idx_deliveries_event ON deliveries(event_id, attempt)`,
    ],
  },
];

export async function runMigrations(db: Db): Promise<string[]> {
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((await db.all<{ id: string }>(`SELECT id FROM schema_migrations`)).map((r) => r.id));
  const ran: string[] = [];

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    for (const statement of m.statements) await db.run(statement);
    await db.run(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, [
      m.id,
      new Date().toISOString(),
    ]);
    ran.push(m.id);
  }
  return ran;
}
