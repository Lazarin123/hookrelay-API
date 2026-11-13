import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { runMigrations } from "./db/migrations.js";
import { openapiDocument } from "./openapi.js";
import { EndpointsRepo } from "./repositories/endpoints.js";
import { EventsRepo } from "./repositories/events.js";
import { adminRoutes } from "./routes/admin.js";
import { ingestRoutes } from "./routes/ingest.js";
import { DeliveryWorker } from "./services/worker.js";
import { AppError } from "./utils/errors.js";

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export interface BuiltApp {
  app: FastifyInstance;
  worker: DeliveryWorker;
}

export async function buildApp(opts: { config: Config; db: Db; fetchImpl?: typeof fetch }): Promise<BuiltApp> {
  const { config, db } = opts;

  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
  });

  await runMigrations(db);

  const endpoints = new EndpointsRepo(db);
  const events = new EventsRepo(db);
  const worker = new DeliveryWorker({
    endpoints,
    events,
    config,
    log: app.log,
    fetchImpl: opts.fetchImpl,
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "validation_error",
          message: err.issues.map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`).join("; "),
        },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, "erro não tratado");
    return reply.code(status).send({
      error: {
        code: status === 413 ? "payload_too_large" : status >= 500 ? "internal_error" : (err.code ?? "bad_request"),
        message: status >= 500 ? "Erro interno do servidor" : err.message,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "Rota não encontrada" } }),
  );

  app.get("/health", async (_req, reply) => {
    try {
      await db.get("SELECT 1 AS ok");
      return { status: "ok", database: db.dialect, version, uptimeSeconds: Math.round(process.uptime()) };
    } catch {
      return reply.code(503).send({ status: "error", database: db.dialect, version });
    }
  });

  if (config.ENABLE_DOCS) {
    await app.register(swagger, { mode: "static", specification: { document: openapiDocument as never } });
    await app.register(swaggerUi, { routePrefix: "/docs" });
    app.get("/openapi.json", async () => openapiDocument);
  }

  await app.register(ingestRoutes, { endpoints, events, worker, maxBodyBytes: config.MAX_BODY_BYTES });
  await app.register(adminRoutes, { config, endpoints, events, worker });

  return { app, worker };
}
