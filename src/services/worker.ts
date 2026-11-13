import type { Config } from "../config.js";
import type { EndpointsRepo } from "../repositories/endpoints.js";
import type { EventsRepo, WebhookEvent } from "../repositories/events.js";
import { sign } from "./signature.js";

interface Logger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

export type WorkerConfig = Pick<
  Config,
  | "WORKER_INTERVAL_MS"
  | "WORKER_BATCH_SIZE"
  | "MAX_RETRIES"
  | "RETRY_BASE_DELAY_MS"
  | "RETRY_MAX_DELAY_MS"
  | "DELIVERY_TIMEOUT_MS"
  | "EVENT_RETENTION_DAYS"
>;

/** Cabeçalhos que não devem ser repassados ao destino. */
const SKIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "accept-encoding",
  "proxy-authorization",
  "proxy-authenticate",
]);

const RESPONSE_PREVIEW_CHARS = 2000;

/** Atraso exponencial: base * 2^(tentativa-1), limitado por `max`. */
export function backoffDelayMs(attemptsMade: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, attemptsMade - 1), maxMs);
}

export function buildTargetUrl(target: string, query: string): string {
  if (!query) return target;
  const url = new URL(target);
  url.search = url.search ? `${url.search}&${query}` : `?${query}`;
  return url.toString();
}

export class DeliveryWorker {
  private timer: NodeJS.Timeout | undefined;
  private cleanupTimer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private deps: {
      events: EventsRepo;
      endpoints: EndpointsRepo;
      config: WorkerConfig;
      log: Logger;
      /** Injetável para testes. */
      fetchImpl?: typeof fetch;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.config.WORKER_INTERVAL_MS);
    void this.cleanup();
    this.cleanupTimer = setInterval(() => void this.cleanup(), 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.timer = undefined;
    this.cleanupTimer = undefined;
  }

  /**
   * Pede uma rodada imediata (usado logo após receber um webhook).
   * Não faz nada se o worker não estiver ligado (RUN_WORKER=false): nesse caso
   * outra instância, com o worker ligado, entrega o evento na próxima rodada.
   */
  kick(): void {
    if (!this.timer) return;
    setImmediate(() => void this.tick());
  }

  /** Uma rodada: busca eventos vencidos, reserva e entrega. Retorna quantos foram processados. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { config, events } = this.deps;
      const now = new Date().toISOString();
      const ids = await events.findDueIds(now, config.WORKER_BATCH_SIZE);
      const lockMs = config.DELIVERY_TIMEOUT_MS + 30_000;
      let processed = 0;
      await Promise.all(
        ids.map(async (id) => {
          try {
            if (!(await events.claim(id, now, lockMs))) return; // outra instância pegou
            await this.deliver(id);
            processed++;
          } catch (err) {
            this.deps.log.error({ err, eventId: id }, "falha ao processar evento");
          }
        }),
      );
      return processed;
    } catch (err) {
      this.deps.log.error({ err }, "falha na rodada do worker");
      return 0;
    } finally {
      this.running = false;
    }
  }

  async cleanup(): Promise<void> {
    const days = this.deps.config.EVENT_RETENTION_DAYS;
    if (days <= 0) return;
    try {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const removed = await this.deps.events.deleteOlderThan(cutoff);
      if (removed > 0) this.deps.log.info({ removed, days }, "eventos antigos removidos");
    } catch (err) {
      this.deps.log.error({ err }, "falha ao limpar eventos antigos");
    }
  }

  /** Tenta entregar um evento (já reservado) e registra o resultado. */
  async deliver(eventId: string): Promise<void> {
    const { events, endpoints, config } = this.deps;
    const event = await events.getById(eventId);
    if (!event) return;
    const endpoint = await endpoints.getById(event.endpointId);
    const attempt = event.attempts + 1;

    if (!endpoint?.targetUrl) {
      await events.markFailed(event.id, event.attempts, "Endpoint sem URL de destino");
      return;
    }

    const started = Date.now();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    try {
      const res = await (this.deps.fetchImpl ?? fetch)(buildTargetUrl(endpoint.targetUrl, event.query), {
        method: event.method,
        headers: this.buildHeaders(event, attempt, endpoint.forwardSecret),
        body: ["GET", "HEAD"].includes(event.method) ? undefined : Buffer.from(event.bodyBase64, "base64"),
        signal: AbortSignal.timeout(config.DELIVERY_TIMEOUT_MS),
      });
      statusCode = res.status;
      responseBody = (await res.text().catch(() => "")).slice(0, RESPONSE_PREVIEW_CHARS);
      if (!res.ok) error = `Destino respondeu HTTP ${res.status}`;
    } catch (err) {
      error = describeFetchError(err, config.DELIVERY_TIMEOUT_MS);
    }

    await events.recordAttempt({
      eventId: event.id,
      attempt,
      statusCode,
      responseBody,
      error,
      durationMs: Date.now() - started,
    });

    if (!error) {
      await events.markDelivered(event.id, attempt);
      return;
    }
    if (attempt >= config.MAX_RETRIES) {
      await events.markFailed(event.id, attempt, error);
      this.deps.log.warn({ eventId: event.id, attempt }, "evento esgotou as tentativas");
      return;
    }
    const delay = backoffDelayMs(attempt, config.RETRY_BASE_DELAY_MS, config.RETRY_MAX_DELAY_MS);
    await events.markRetry(event.id, attempt, new Date(Date.now() + delay).toISOString(), error);
  }

  private buildHeaders(event: WebhookEvent, attempt: number, forwardSecret: string | null): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(event.headers)) {
      if (!SKIP_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    headers["x-hookrelay-event-id"] = event.id;
    headers["x-hookrelay-attempt"] = String(attempt);
    if (forwardSecret) {
      headers["x-hookrelay-signature"] = sign(forwardSecret, Buffer.from(event.bodyBase64, "base64"));
    }
    return headers;
  }
}

function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return `Timeout após ${timeoutMs}ms`;
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    return `Falha de rede: ${cause?.code ?? cause?.message ?? err.message}`;
  }
  return "Erro desconhecido na entrega";
}
