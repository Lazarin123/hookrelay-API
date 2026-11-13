import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "../src/services/signature.js";
import { auth, makeApp } from "./helpers.js";

type Json = any;

async function createEndpoint(app: any, payload: object): Promise<Json> {
  const res = await app.inject({ method: "POST", url: "/endpoints", headers: auth, payload });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

test("health responde ok e informa o banco", async () => {
  const { app, close, db } = await makeApp();
  const res = await app.inject({ url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "ok");
  assert.equal(res.json().database, db.dialect);
  await close();
});

test("rotas administrativas exigem API key (x-api-key e Bearer)", async () => {
  const { app, close } = await makeApp();
  assert.equal((await app.inject({ url: "/endpoints" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/endpoints", headers: { "x-api-key": "errada" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/endpoints", headers: auth })).statusCode, 200);
  const bearer = await app.inject({ url: "/endpoints", headers: { authorization: `Bearer ${auth["x-api-key"]}` } });
  assert.equal(bearer.statusCode, 200);
  await close();
});

test("CRUD de endpoints: não vaza segredos e valida entrada", async () => {
  const { app, close } = await makeApp();
  const ep = await createEndpoint(app, { name: "stripe", targetUrl: "https://example.com/hook", signingSecret: "s3", forwardSecret: "f3" });
  assert.equal(ep.hasSigningSecret, true);
  assert.equal(ep.hasForwardSecret, true);
  assert.equal(ep.signingSecret, undefined);
  assert.equal(ep.forwardSecret, undefined);
  assert.match(ep.inboundUrl, /\/in\/.{20,}/);

  const bad = await app.inject({ method: "POST", url: "/endpoints", headers: auth, payload: { name: "" } });
  assert.equal(bad.statusCode, 400);
  const badUrl = await app.inject({ method: "POST", url: "/endpoints", headers: auth, payload: { name: "x", targetUrl: "ftp://x" } });
  assert.equal(badUrl.statusCode, 400);
  const rejectNoSecret = await app.inject({ method: "POST", url: "/endpoints", headers: auth, payload: { name: "x", rejectInvalidSignature: true } });
  assert.equal(rejectNoSecret.statusCode, 400);

  const patched = await app.inject({ method: "PATCH", url: `/endpoints/${ep.id}`, headers: auth, payload: { name: "novo", active: false } });
  assert.equal(patched.json().name, "novo");
  assert.equal(patched.json().active, false);

  const list = (await app.inject({ url: "/endpoints", headers: auth })).json();
  assert.equal(list.total, 1);

  assert.equal((await app.inject({ method: "DELETE", url: `/endpoints/${ep.id}`, headers: auth })).statusCode, 204);
  assert.equal((await app.inject({ url: `/endpoints/${ep.id}`, headers: auth })).statusCode, 404);
  await close();
});

test("BLOCK_PRIVATE_TARGETS bloqueia destinos locais", async () => {
  const { app, close } = await makeApp({ BLOCK_PRIVATE_TARGETS: "true" });
  const res = await app.inject({ method: "POST", url: "/endpoints", headers: auth, payload: { name: "x", targetUrl: "http://127.0.0.1:8080/x" } });
  assert.equal(res.statusCode, 400);
  await close();
});

test("modo inspeção: sem targetUrl, guarda o evento como 'stored' e guarda o corpo bruto", async () => {
  const { app, close } = await makeApp();
  const ep = await createEndpoint(app, { name: "inspecao" });
  const res = await app.inject({
    method: "POST",
    url: `/in/${ep.slug}?origem=teste`,
    headers: { "content-type": "application/json", "x-custom": "abc" },
    payload: '{"ola":"mundo"}',
  });
  assert.equal(res.statusCode, 200);
  const { eventId } = res.json();

  const detail = (await app.inject({ url: `/events/${eventId}`, headers: auth })).json();
  assert.equal(detail.status, "stored");
  assert.equal(detail.method, "POST");
  assert.equal(detail.query, "origem=teste");
  assert.equal(detail.body, '{"ola":"mundo"}');
  assert.deepEqual(detail.json, { ola: "mundo" });
  assert.equal(detail.headers["x-custom"], "abc");
  assert.equal(detail.signatureValid, null);

  const replay = await app.inject({ method: "POST", url: `/events/${eventId}/replay`, headers: auth });
  assert.equal(replay.statusCode, 409);
  await close();
});

test("aceita corpo não-JSON (texto, form, vazio)", async () => {
  const { app, close } = await makeApp();
  const ep = await createEndpoint(app, { name: "formatos" });
  const text = await app.inject({ method: "POST", url: `/in/${ep.slug}`, headers: { "content-type": "text/plain" }, payload: "oi" });
  const form = await app.inject({ method: "POST", url: `/in/${ep.slug}`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "a=1&b=2" });
  const empty = await app.inject({ method: "GET", url: `/in/${ep.slug}` });
  for (const r of [text, form, empty]) assert.equal(r.statusCode, 200, r.body);
  const list = (await app.inject({ url: `/events?endpointId=${ep.id}`, headers: auth })).json();
  assert.equal(list.total, 3);
  assert.equal(list.data[0].body, undefined); // listagem não traz corpo
  await close();
});

test("slug inválido -> 404; endpoint desativado -> 410; corpo grande -> 413", async () => {
  const { app, close } = await makeApp({ MAX_BODY_BYTES: "10" });
  assert.equal((await app.inject({ method: "POST", url: "/in/nao-existe", payload: "x" })).statusCode, 404);
  const ep = await createEndpoint(app, { name: "x" });
  const big = await app.inject({ method: "POST", url: `/in/${ep.slug}`, headers: { "content-type": "text/plain" }, payload: "x".repeat(100) });
  assert.equal(big.statusCode, 413);
  await app.inject({ method: "PATCH", url: `/endpoints/${ep.id}`, headers: auth, payload: { active: false } });
  assert.equal((await app.inject({ method: "POST", url: `/in/${ep.slug}`, payload: "x" })).statusCode, 410);
  await close();
});

test("assinatura HMAC de entrada: marca como válida/inválida e pode rejeitar", async () => {
  const { app, close } = await makeApp();
  const soft = await createEndpoint(app, { name: "soft", signingSecret: "segredo" });
  const strict = await createEndpoint(app, { name: "strict", signingSecret: "segredo", rejectInvalidSignature: true, signatureHeader: "X-Hub-Signature-256" });
  const body = '{"x":1}';
  const ct = { "content-type": "application/json" };

  const good = await app.inject({ method: "POST", url: `/in/${soft.slug}`, headers: { ...ct, "x-signature": sign("segredo", Buffer.from(body)) }, payload: body });
  assert.equal((await app.inject({ url: `/events/${good.json().eventId}`, headers: auth })).json().signatureValid, true);

  const bad = await app.inject({ method: "POST", url: `/in/${soft.slug}`, headers: { ...ct, "x-signature": "sha256=00" }, payload: body });
  assert.equal(bad.statusCode, 200);
  assert.equal((await app.inject({ url: `/events/${bad.json().eventId}`, headers: auth })).json().signatureValid, false);

  const rejected = await app.inject({ method: "POST", url: `/in/${strict.slug}`, headers: { ...ct, "x-hub-signature-256": "sha256=00" }, payload: body });
  assert.equal(rejected.statusCode, 401);
  const accepted = await app.inject({ method: "POST", url: `/in/${strict.slug}`, headers: { ...ct, "x-hub-signature-256": sign("segredo", Buffer.from(body)) }, payload: body });
  assert.equal(accepted.statusCode, 200);
  assert.equal((await app.inject({ url: `/events?endpointId=${strict.id}`, headers: auth })).json().total, 1);
  await close();
});

test("replay aceita Content-Type JSON com corpo vazio e /stats conta por status", async () => {
  const { app, close } = await makeApp();
  const ep = await createEndpoint(app, { name: "x", targetUrl: "https://example.com/h" });
  const { eventId } = (await app.inject({ method: "POST", url: `/in/${ep.slug}`, payload: "oi", headers: { "content-type": "text/plain" } })).json();
  const replay = await app.inject({ method: "POST", url: `/events/${eventId}/replay`, headers: { ...auth, "content-type": "application/json" } });
  assert.equal(replay.statusCode, 202);
  const stats = (await app.inject({ url: "/stats", headers: auth })).json();
  assert.equal(stats.events.total, 1);
  await close();
});

test("docs e openapi.json estão disponíveis", async () => {
  const { app, close } = await makeApp();
  const spec = await app.inject({ url: "/openapi.json" });
  assert.equal(spec.statusCode, 200);
  assert.ok(spec.json().paths["/events/{id}/replay"]);
  const docs = await app.inject({ url: "/docs/" });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.headers["content-type"] as string, /html/);
  await close();
});

test("deletar endpoint apaga eventos e entregas em cascata", async () => {
  const { app, close, db } = await makeApp();
  const ep = await createEndpoint(app, { name: "x" });
  await app.inject({ method: "POST", url: `/in/${ep.slug}`, payload: "a", headers: { "content-type": "text/plain" } });
  await app.inject({ method: "DELETE", url: `/endpoints/${ep.id}`, headers: auth });
  const n = await db.get<{ n: number | string }>("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM events");
  assert.equal(Number(n?.n), 0);
  await close();
});
