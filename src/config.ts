import "dotenv/config";
import { z } from "zod";

/**
 * Converte "true"/"false"/"1"/"0" (strings de .env) em boolean.
 */
const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["true", "1", "yes", "on"].includes(v.toLowerCase())));

const intFromEnv = (def: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: intFromEnv(3000, 1),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1).default("file:./data/hookrelay.db"),
  PG_POOL_MAX: intFromEnv(5, 1),

  ADMIN_API_KEY: z.string().min(1, "ADMIN_API_KEY é obrigatória"),

  PUBLIC_URL: z.string().optional(),
  TRUST_PROXY: boolish(false),
  MAX_BODY_BYTES: intFromEnv(1_048_576, 1),
  ENABLE_DOCS: boolish(true),

  RUN_WORKER: boolish(true),
  WORKER_INTERVAL_MS: intFromEnv(1000, 100),
  WORKER_BATCH_SIZE: intFromEnv(10, 1),
  MAX_RETRIES: intFromEnv(5, 1),
  RETRY_BASE_DELAY_MS: intFromEnv(2000, 1),
  RETRY_MAX_DELAY_MS: intFromEnv(3_600_000, 1),
  DELIVERY_TIMEOUT_MS: intFromEnv(10_000, 100),

  BLOCK_PRIVATE_TARGETS: boolish(false),
  EVENT_RETENTION_DAYS: intFromEnv(30, 0),
});

export type Config = z.infer<typeof schema>;

const PLACEHOLDER_KEYS = new Set(["troque-esta-chave", "change-me", "changeme"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida no .env:\n${problems}\n\nVeja o arquivo .env.example.`);
  }
  const config = parsed.data;

  if (config.NODE_ENV === "production") {
    if (PLACEHOLDER_KEYS.has(config.ADMIN_API_KEY) || config.ADMIN_API_KEY.length < 16) {
      throw new Error(
        "ADMIN_API_KEY insegura para produção. Use pelo menos 16 caracteres. Gere uma com: openssl rand -hex 32",
      );
    }
  }
  return config;
}
