import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";

async function main() {
  const config = loadConfig();
  const db = createDb(config);
  const { app, worker } = await buildApp({ config, db });

  if (config.RUN_WORKER) worker.start();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} recebido, encerrando...`);
    worker.stop();
    try {
      await app.close();
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    `HookRelay no ar | banco: ${db.dialect} | worker: ${config.RUN_WORKER ? "ligado" : "desligado"}` +
      (config.ENABLE_DOCS ? ` | docs: /docs` : ""),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
