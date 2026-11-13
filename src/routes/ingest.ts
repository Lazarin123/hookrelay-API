import type { FastifyInstance } from "fastify";
import type { EndpointsRepo } from "../repositories/endpoints.js";
import type { EventsRepo } from "../repositories/events.js";
import { verifySignature } from "../services/signature.js";
import type { DeliveryWorker } from "../services/worker.js";
import { AppError } from "../utils/errors.js";

/**
 * Rota pública que recebe os webhooks: ALL /in/:slug
 * O corpo é guardado BRUTO (Buffer), sem interpretar, para que a assinatura HMAC
 * e o reenvio sejam fiéis ao que foi enviado originalmente.
 */
export async function ingestRoutes(
  app: FastifyInstance,
  deps: { endpoints: EndpointsRepo; events: EventsRepo; worker: DeliveryWorker; maxBodyBytes: number },
) {
  // Dentro deste plugin, qualquer content-type vira Buffer cru.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/in/:slug",
    bodyLimit: deps.maxBodyBytes,
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const endpoint = await deps.endpoints.getBySlug(slug);
      if (!endpoint) throw new AppError(404, "not_found", "Endpoint não encontrado");
      if (!endpoint.active) throw new AppError(410, "endpoint_disabled", "Endpoint desativado");

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      let signatureValid: boolean | null = null;
      if (endpoint.signingSecret) {
        const header = req.headers[endpoint.signatureHeader];
        signatureValid = verifySignature(endpoint.signingSecret, body, Array.isArray(header) ? header[0] : header);
        if (!signatureValid && endpoint.rejectInvalidSignature) {
          throw new AppError(401, "invalid_signature", "Assinatura inválida");
        }
      }

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }

      const rawUrl = req.raw.url ?? "";
      const qIndex = rawUrl.indexOf("?");

      const event = await deps.events.insert({
        endpointId: endpoint.id,
        method: req.method,
        query: qIndex >= 0 ? rawUrl.slice(qIndex + 1) : "",
        headers,
        body,
        sourceIp: req.ip ?? null,
        signatureValid,
        status: endpoint.targetUrl ? "pending" : "stored",
      });

      if (endpoint.targetUrl) deps.worker.kick();
      return reply.code(200).send({ received: true, eventId: event.id });
    },
  });
}
