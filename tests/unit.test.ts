import assert from "node:assert/strict";
import { test } from "node:test";
import { sign, verifySignature } from "../src/services/signature.js";
import { isPrivateHost, validateTargetUrl } from "../src/services/urlGuard.js";
import { backoffDelayMs, buildTargetUrl } from "../src/services/worker.js";
import { toPgPlaceholders } from "../src/db/postgres.js";
import { sqlitePathFromUrl } from "../src/db/sqlite.js";
import { loadConfig } from "../src/config.js";

test("assinatura HMAC: aceita válida (com e sem prefixo) e rejeita inválida", () => {
  const body = Buffer.from('{"a":1}');
  const sig = sign("segredo", body);
  assert.ok(sig.startsWith("sha256="));
  assert.equal(verifySignature("segredo", body, sig), true);
  assert.equal(verifySignature("segredo", body, sig.replace("sha256=", "")), true);
  assert.equal(verifySignature("outro", body, sig), false);
  assert.equal(verifySignature("segredo", Buffer.from("adulterado"), sig), false);
  assert.equal(verifySignature("segredo", body, undefined), false);
  assert.equal(verifySignature("segredo", body, "lixo"), false);
});

test("backoff exponencial com teto", () => {
  assert.equal(backoffDelayMs(1, 2000, 60000), 2000);
  assert.equal(backoffDelayMs(2, 2000, 60000), 4000);
  assert.equal(backoffDelayMs(3, 2000, 60000), 8000);
  assert.equal(backoffDelayMs(10, 2000, 60000), 60000);
});

test("buildTargetUrl preserva a query string", () => {
  assert.equal(buildTargetUrl("https://a.com/x", ""), "https://a.com/x");
  assert.equal(buildTargetUrl("https://a.com/x", "k=1"), "https://a.com/x?k=1");
  assert.equal(buildTargetUrl("https://a.com/x?z=9", "k=1"), "https://a.com/x?z=9&k=1");
});

test("urlGuard: protocolo e IPs privados", () => {
  assert.equal(validateTargetUrl("ftp://a.com", false).ok, false);
  assert.equal(validateTargetUrl("nao-e-url", false).ok, false);
  assert.equal(validateTargetUrl("http://localhost:3000", false).ok, true);
  assert.equal(validateTargetUrl("http://localhost:3000", true).ok, false);
  for (const h of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "[::1]", "foo.internal", "[::ffff:127.0.0.1]"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ["8.8.8.8", "example.com", "172.32.0.1"]) assert.equal(isPrivateHost(h), false, h);
});

test("adaptadores de banco: placeholders e caminho", () => {
  assert.equal(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"), "SELECT * FROM t WHERE a = $1 AND b = $2");
  assert.equal(sqlitePathFromUrl("file:./data/x.db"), "./data/x.db");
  assert.equal(sqlitePathFromUrl("file::memory:"), ":memory:");
  assert.equal(sqlitePathFromUrl(":memory:"), ":memory:");
});

test("config: exige ADMIN_API_KEY e barra chave fraca em produção", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv), /ADMIN_API_KEY/);
  assert.throws(() => loadConfig({ NODE_ENV: "production", ADMIN_API_KEY: "troque-esta-chave" } as NodeJS.ProcessEnv), /insegura/);
  const ok = loadConfig({ NODE_ENV: "production", ADMIN_API_KEY: "x".repeat(32) } as NodeJS.ProcessEnv);
  assert.equal(ok.MAX_RETRIES, 5);
  assert.equal(ok.ENABLE_DOCS, true);
});
