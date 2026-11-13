import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createDb } from "../src/db/index.js";

export const API_KEY = "test-key-test-key-test-key";

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    ADMIN_API_KEY: API_KEY,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? ":memory:",
    RETRY_BASE_DELAY_MS: "1",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export async function makeApp(overrides: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const config = testConfig(overrides);
  const db = createDb(config);
  // Em Postgres de teste, começa sempre do zero.
  if (db.dialect === "postgres") {
    await db.run("DROP TABLE IF EXISTS deliveries");
    await db.run("DROP TABLE IF EXISTS events");
    await db.run("DROP TABLE IF EXISTS endpoints");
    await db.run("DROP TABLE IF EXISTS schema_migrations");
  }
  const built = await buildApp({ config, db, fetchImpl });
  return { ...built, db, config, close: async () => { built.worker.stop(); await built.app.close(); await db.close(); } };
}

export const auth = { "x-api-key": API_KEY };
