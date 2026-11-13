import type { Endpoint } from "../repositories/endpoints.js";
import type { Delivery, WebhookEvent } from "../repositories/events.js";

/** Nunca expõe os segredos (signingSecret/forwardSecret), só diz se existem. */
export function serializeEndpoint(e: Endpoint, baseUrl: string) {
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    inboundUrl: `${baseUrl}/in/${e.slug}`,
    targetUrl: e.targetUrl,
    signatureHeader: e.signatureHeader,
    rejectInvalidSignature: e.rejectInvalidSignature,
    hasSigningSecret: e.signingSecret !== null,
    hasForwardSecret: e.forwardSecret !== null,
    active: e.active,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

/** Versão resumida (listagens): sem headers e sem corpo. */
export function serializeEventSummary(e: WebhookEvent) {
  return {
    id: e.id,
    endpointId: e.endpointId,
    method: e.method,
    query: e.query,
    bodySize: e.bodySize,
    sourceIp: e.sourceIp,
    signatureValid: e.signatureValid,
    status: e.status,
    attempts: e.attempts,
    nextAttemptAt: e.nextAttemptAt,
    lastError: e.lastError,
    receivedAt: e.receivedAt,
    deliveredAt: e.deliveredAt,
  };
}

export function serializeEventDetail(e: WebhookEvent, deliveries: Delivery[]) {
  const raw = Buffer.from(e.bodyBase64, "base64");
  const body = raw.toString("utf8");
  let json: unknown = undefined;
  if ((e.headers["content-type"] ?? "").includes("json")) {
    try {
      json = JSON.parse(body);
    } catch {
      /* corpo não é JSON válido: ignora */
    }
  }
  return {
    ...serializeEventSummary(e),
    headers: e.headers,
    body,
    ...(json !== undefined ? { json } : {}),
    deliveries,
  };
}
