import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Cria um hook que exige a ADMIN_API_KEY em `x-api-key` ou `Authorization: Bearer <chave>`. */
export function requireApiKey(adminKey: string) {
  const expected = digest(adminKey);
  return async function (req: FastifyRequest, _reply: FastifyReply) {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const header = req.headers["x-api-key"];
    const provided = (Array.isArray(header) ? header[0] : header) ?? bearer;
    if (!provided || !timingSafeEqual(digest(provided), expected)) {
      throw new AppError(401, "unauthorized", "API key ausente ou inválida");
    }
  };
}
