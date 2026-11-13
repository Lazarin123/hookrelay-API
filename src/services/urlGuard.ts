import { isIP } from "node:net";

/**
 * Valida a URL de destino de um endpoint.
 * - Só aceita http:// e https://
 * - Se `blockPrivate` estiver ligado, recusa localhost e IPs privados escritos na URL.
 *
 * ATENÇÃO: isto confere apenas o que está escrito na URL. Não resolve DNS, então não protege
 * contra um domínio público que aponte para um IP interno. Para ambientes sensíveis, combine
 * com regras de firewall/egress na sua infraestrutura.
 */
export function validateTargetUrl(raw: string, blockPrivate: boolean): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Apenas http:// e https:// são permitidos" };
  }
  if (blockPrivate && isPrivateHost(url.hostname)) {
    return { ok: false, reason: "Destinos locais/privados estão bloqueados (BLOCK_PRIVATE_TARGETS=true)" };
  }
  return { ok: true, url };
}

export function isPrivateHost(hostnameRaw: string): boolean {
  const host = hostnameRaw.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (family === 6) {
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
    // IPv4 mapeado (::ffff:127.0.0.1 ou ::ffff:7f00:1)
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateHost(mapped[1]);
    if (host.startsWith("::ffff:")) return true;
  }
  return false;
}
