import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";

export type EventStatus = "stored" | "pending" | "delivered" | "failed";

export interface WebhookEvent {
  id: string;
  endpointId: string;
  method: string;
  query: string;
  headers: Record<string, string>;
  bodyBase64: string;
  bodySize: number;
  sourceIp: string | null;
  signatureValid: boolean | null;
  status: EventStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  receivedAt: string;
  deliveredAt: string | null;
}

export interface Delivery {
  id: string;
  eventId: string;
  attempt: number;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

interface EventRow {
  id: string;
  endpoint_id: string;
  method: string;
  query: string;
  headers: string;
  body_b64: string;
  body_size: number | string;
  source_ip: string | null;
  signature_valid: number | null;
  status: EventStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  received_at: string;
  delivered_at: string | null;
}

interface DeliveryRow {
  id: string;
  event_id: string;
  attempt: number;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number;
  created_at: string;
}

const toEvent = (r: EventRow): WebhookEvent => ({
  id: r.id,
  endpointId: r.endpoint_id,
  method: r.method,
  query: r.query,
  headers: JSON.parse(r.headers) as Record<string, string>,
  bodyBase64: r.body_b64,
  bodySize: Number(r.body_size),
  sourceIp: r.source_ip,
  signatureValid: r.signature_valid === null ? null : r.signature_valid === 1,
  status: r.status,
  attempts: Number(r.attempts),
  nextAttemptAt: r.next_attempt_at,
  lastError: r.last_error,
  receivedAt: r.received_at,
  deliveredAt: r.delivered_at,
});

const toDelivery = (r: DeliveryRow): Delivery => ({
  id: r.id,
  eventId: r.event_id,
  attempt: Number(r.attempt),
  statusCode: r.status_code === null ? null : Number(r.status_code),
  responseBody: r.response_body,
  error: r.error,
  durationMs: Number(r.duration_ms),
  createdAt: r.created_at,
});

export interface NewEvent {
  endpointId: string;
  method: string;
  query: string;
  headers: Record<string, string>;
  body: Buffer;
  sourceIp: string | null;
  signatureValid: boolean | null;
  /** "pending" se o endpoint tem destino; "stored" se é só para inspeção. */
  status: "pending" | "stored";
}

export interface EventFilters {
  endpointId?: string;
  status?: EventStatus;
  limit: number;
  offset: number;
}

export class EventsRepo {
  constructor(private db: Db) {}

  async insert(input: NewEvent): Promise<WebhookEvent> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO events
        (id, endpoint_id, method, query, headers, body_b64, body_size, source_ip, signature_valid,
         status, attempts, next_attempt_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        input.endpointId,
        input.method,
        input.query,
        JSON.stringify(input.headers),
        input.body.toString("base64"),
        input.body.length,
        input.sourceIp,
        input.signatureValid === null ? null : input.signatureValid ? 1 : 0,
        input.status,
        input.status === "pending" ? now : null,
        now,
      ],
    );
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<WebhookEvent | undefined> {
    const row = await this.db.get<EventRow>(`SELECT * FROM events WHERE id = ?`, [id]);
    return row && toEvent(row);
  }

  async list(f: EventFilters): Promise<{ data: WebhookEvent[]; total: number }> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (f.endpointId) {
      where.push("endpoint_id = ?");
      params.push(f.endpointId);
    }
    if (f.status) {
      where.push("status = ?");
      params.push(f.status);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.db.all<EventRow>(
      `SELECT * FROM events ${clause} ORDER BY received_at DESC, id LIMIT ? OFFSET ?`,
      [...params, f.limit, f.offset],
    );
    const count = await this.db.get<{ n: number | string }>(
      `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM events ${clause}`,
      params,
    );
    return { data: rows.map(toEvent), total: Number(count?.n ?? 0) };
  }

  async listDeliveries(eventId: string): Promise<Delivery[]> {
    const rows = await this.db.all<DeliveryRow>(`SELECT * FROM deliveries WHERE event_id = ? ORDER BY attempt, created_at`, [
      eventId,
    ]);
    return rows.map(toDelivery);
  }

  async delete(id: string): Promise<boolean> {
    const { changes } = await this.db.run(`DELETE FROM events WHERE id = ?`, [id]);
    return changes > 0;
  }

  async deleteOlderThan(iso: string): Promise<number> {
    const { changes } = await this.db.run(`DELETE FROM events WHERE received_at < ?`, [iso]);
    return changes;
  }

  async statsByStatus(): Promise<Record<string, number>> {
    const rows = await this.db.all<{ status: string; n: number | string }>(
      `SELECT status, CAST(COUNT(*) AS INTEGER) AS n FROM events GROUP BY status`,
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  /** Reenvio manual: volta o evento para a fila, com tentativas zeradas. */
  async requeue(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { changes } = await this.db.run(
      `UPDATE events SET status = 'pending', attempts = 0, next_attempt_at = ?, locked_until = NULL,
         last_error = NULL, delivered_at = NULL WHERE id = ? AND status <> 'stored'`,
      [now, id],
    );
    return changes > 0;
  }

  /** IDs de eventos prontos para tentar entregar agora. */
  async findDueIds(nowIso: string, limit: number): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(
      `SELECT id FROM events
        WHERE status = 'pending' AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until <= ?)
        ORDER BY next_attempt_at LIMIT ?`,
      [nowIso, nowIso, limit],
    );
    return rows.map((r) => r.id);
  }

  /**
   * "Reserva" um evento para este worker. É atômico: se duas instâncias tentarem
   * ao mesmo tempo, só uma recebe changes = 1. Se o processo cair no meio,
   * a reserva expira sozinha em `lockMs`.
   */
  async claim(id: string, nowIso: string, lockMs: number): Promise<boolean> {
    const until = new Date(Date.parse(nowIso) + lockMs).toISOString();
    const { changes } = await this.db.run(
      `UPDATE events SET locked_until = ?
        WHERE id = ? AND status = 'pending' AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until <= ?)`,
      [until, id, nowIso, nowIso],
    );
    return changes === 1;
  }

  async recordAttempt(input: {
    eventId: string;
    attempt: number;
    statusCode: number | null;
    responseBody: string | null;
    error: string | null;
    durationMs: number;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO deliveries (id, event_id, attempt, status_code, response_body, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.eventId,
        input.attempt,
        input.statusCode,
        input.responseBody,
        input.error,
        input.durationMs,
        new Date().toISOString(),
      ],
    );
  }

  async markDelivered(id: string, attempts: number): Promise<void> {
    await this.db.run(
      `UPDATE events SET status = 'delivered', attempts = ?, next_attempt_at = NULL, locked_until = NULL,
         last_error = NULL, delivered_at = ? WHERE id = ?`,
      [attempts, new Date().toISOString(), id],
    );
  }

  async markRetry(id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void> {
    await this.db.run(
      `UPDATE events SET attempts = ?, next_attempt_at = ?, locked_until = NULL, last_error = ? WHERE id = ?`,
      [attempts, nextAttemptAt, error, id],
    );
  }

  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    await this.db.run(
      `UPDATE events SET status = 'failed', attempts = ?, next_attempt_at = NULL, locked_until = NULL, last_error = ? WHERE id = ?`,
      [attempts, error, id],
    );
  }
}
