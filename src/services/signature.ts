import { createHmac, timingSafeEqual } from "node:crypto";

/** Gera "sha256=<hex>" (HMAC-SHA256 do corpo bruto). */
export function sign(secret: string, body: Buffer): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Confere uma assinatura HMAC-SHA256 em hexadecimal, com ou sem o prefixo "sha256=".
 * Usa comparação em tempo constante para evitar timing attacks.
 */
export function verifySignature(secret: string, body: Buffer, headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  const received = headerValue.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
