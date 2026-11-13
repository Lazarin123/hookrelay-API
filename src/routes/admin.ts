import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { EndpointsRepo } from "../repositories/endpoints.js";
import type { EventsRepo } from "../repositories/events.js";
import { validateTargetUrl } from "../services/urlGuard.js";
import type { DeliveryWorker } from "../services/worker.js";
import { requireApiKey } from "../utils/auth.js";
import { AppError, notFound } from "../utils/errors.js";
import { serializeEndpoint, serializeEventDetail, serializeEventSummary } from "./serializers.js";

const headerName = z.string().regex(/^[a-zA-Z0-9-]+$/, "use apenas letras, números e hífen").max(100);

const endpointBody = z.object({
  name: z.string().trim().min(1).max(100),
  targetUrl: z.string().max(2048).nullable().optional(),
  signingSecret: z.string().min(1).max(256).nullable().optional(),
  signatureHeader: headerName.optional(),
  rejectInvalidSignature: z.boolean().optional(),
  forwardSecret: z.string().min(1).max(256).nullable().optional(),
});
const createBody = endpointBody;
const patchBody = endpointBody.partial().extend({ active: z.boolean().optional() });

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const eventsQuery = pagination.extend({
  endpointId: z.string().min(1).optional(),
  status: z.enum(["stored", "pending", "delivered", "failed"]).optional(),
});

const idParam = z.object({ id: z.string().min(1) });

export async function adminRoutes(
  app: FastifyInstance,
  deps: { config: Config; endpoints: EndpointsRepo; events: EventsRepo; worker: DeliveryWorker },
) {
  const { config, endpoints, events, worker } = deps;

  // Aceita corpo JSON vazio (ex.: `curl -X POST .../replay -H "Content-Type: application/json"`).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new AppError(400, "invalid_json", "Corpo JSON inválido"), undefined);
    }
  });

  app.addHook("onRequest", requireApiKey(config.ADMIN_API_KEY));

  const baseUrl = (req: FastifyRequest) =>
    (config.PUBLIC_URL ?? `${req.protocol}://${req.headers.host ?? "localhost"}`).replace(/\/+$/, "");

  const checkTarget = (url: string | null | undefined) => {
    if (!url) return;
    const result = validateTargetUrl(url, config.BLOCK_PRIVATE_TARGETS);
    if (!result.ok) throw new AppError(400, "invalid_target_url", `targetUrl: ${result.reason}`);
  };

  // ---------- Endpoints ----------
  app.post("/endpoints", async (req, reply) => {
    const input = createBody.parse(req.body ?? {});
    checkTarget(input.targetUrl);
    if (input.rejectInvalidSignature && !input.signingSecret) {
      throw new AppError(400, "validation_error", "rejectInvalidSignature exige signingSecret");
    }
    const created = await endpoints.create(input);
    return reply.code(201).send(serializeEndpoint(created, baseUrl(req)));
  });

  app.get("/endpoints", async (req) => {
    const q = pagination.parse(req.query);
    const { data, total } = await endpoints.list(q.limit, q.offset);
    return { data: data.map((e) => serializeEndpoint(e, baseUrl(req))), total, limit: q.limit, offset: q.offset };
  });

  app.get("/endpoints/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const e = await endpoints.getById(id);
    if (!e) throw notFound("Endpoint");
    return serializeEndpoint(e, baseUrl(req));
  });

  app.patch("/endpoints/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const patch = patchBody.parse(req.body ?? {});
    const current = await endpoints.getById(id);
    if (!current) throw notFound("Endpoint");
    checkTarget(patch.targetUrl);
    const finalSecret = patch.signingSecret === undefined ? current.signingSecret : patch.signingSecret;
    const finalReject = patch.rejectInvalidSignature ?? current.rejectInvalidSignature;
    if (finalReject && !finalSecret) {
      throw new AppError(400, "validation_error", "rejectInvalidSignature exige signingSecret");
    }
    const updated = await endpoints.update(id, patch);
    return serializeEndpoint(updated!, baseUrl(req));
  });

  app.delete("/endpoints/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await endpoints.delete(id))) throw notFound("Endpoint");
    return reply.code(204).send();
  });

  // ---------- Eventos ----------
  app.get("/events", async (req) => {
    const q = eventsQuery.parse(req.query);
    const { data, total } = await events.list(q);
    return { data: data.map(serializeEventSummary), total, limit: q.limit, offset: q.offset };
  });

  app.get("/events/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const event = await events.getById(id);
    if (!event) throw notFound("Evento");
    return serializeEventDetail(event, await events.listDeliveries(id));
  });

  app.post("/events/:id/replay", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const event = await events.getById(id);
    if (!event) throw notFound("Evento");
    if (!(await events.requeue(id))) {
      throw new AppError(409, "no_target", "Este evento não tem destino para reenviar (endpoint sem targetUrl)");
    }
    worker.kick();
    const queued = (await events.getById(id))!;
    return reply.code(202).send(serializeEventSummary(queued));
  });

  app.delete("/events/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await events.delete(id))) throw notFound("Evento");
    return reply.code(204).send();
  });

  // ---------- Estatísticas ----------
  app.get("/stats", async () => {
    const byStatus = await events.statsByStatus();
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { events: { total, byStatus } };
  });
}
