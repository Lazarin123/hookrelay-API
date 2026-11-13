import assert from "node:assert/strict";
import * as http from "node:http";
import { test } from "node:test";
import { sign } from "../src/services/signature.js";
import { auth, makeApp } from "./helpers.js";

type Json = any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: Array<number | Error>, calls: Call[]): typeof fetch {
  let i = 0;
  return (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return new Response(r < 300 ? "ok" : "erro do destino", { status: r });
  }) as unknown as typeof fetch;
}

async function setup(responses: Array<number | Error>, env: Record<string, string> = {}, endpoint: object = {}) {
  const calls: Call[] = [];
  const ctx = await makeApp(env, fakeFetch(responses, calls));
  const ep: Json = (await ctx.app.inject({ method: "POST", url: "/endpoints", headers: auth, payload: { name: "t", targetUrl: "https://destino.test/hook", ...endpoint } })).json();
  const send = async (body = '{"id":1}', query = "") => {
    const res = await ctx.app.inject({ method: "POST", url: `/in/${ep.slug}${query}`, headers: { "content-type": "application/json", "x-origem": "stripe" }, payload: body });
    return res.json().eventId as string;
  };
  const get = async (id: string): Promise<Json> => (await ctx.app.inject({ url: `/events/${id}`, headers: auth })).json();
  return { ...ctx, calls, ep, send, get };
}

test("entrega com sucesso: repassa método, corpo, cabeçalhos e query", async () => {
  const t = await setup([200]);
  const id = await t.send('{"id":42}', "?a=1");
  await t.worker.tick();
  const ev = await t.get(id);
  assert.equal(ev.status, "delivered");
  assert.equal(ev.attempts, 1);
  assert.equal(ev.deliveries.length, 1);
  assert.equal(ev.deliveries[0].statusCode, 200);

  const call = t.calls[0]!;
  assert.equal(call.url, "https://destino.test/hook?a=1");
  assert.equal(call.init.method, "POST");
  assert.equal(Buffer.from(call.init.body as Buffer).toString(), '{"id":42}');
  const h = call.init.headers as Record<string, string>;
  assert.equal(h["x-origem"], "stripe");
  assert.equal(h["x-hookrelay-event-id"], id);
  assert.equal(h["x-hookrelay-attempt"], "1");
  assert.equal(h["host"], undefined);
  assert.equal(h["content-length"], undefined);
  await t.close();
});

test("falha e retry: falha 500 -> pendente com próxima tentativa -> sucesso", async () => {
  const t = await setup([500, 200], { MAX_RETRIES: "3", RETRY_BASE_DELAY_MS: "1" });
  const id = await t.send();
  await t.worker.tick();
  let ev = await t.get(id);
  assert.equal(ev.status, "pending");
  assert.equal(ev.attempts, 1);
  assert.match(ev.lastError, /500/);
  assert.ok(ev.nextAttemptAt);

  await sleep(10);
  await t.worker.tick();
  ev = await t.get(id);
  assert.equal(ev.status, "delivered");
  assert.equal(ev.attempts, 2);
  assert.equal(ev.deliveries.length, 2);
  assert.equal(ev.lastError, null);
  await t.close();
});

test("esgota tentativas -> failed; replay manual volta para a fila e entrega", async () => {
  const t = await setup([new Error("boom"), new Error("boom"), 200], { MAX_RETRIES: "2", RETRY_BASE_DELAY_MS: "1" });
  const id = await t.send();
  await t.worker.tick();
  await sleep(10);
  await t.worker.tick();
  let ev = await t.get(id);
  assert.equal(ev.status, "failed");
  assert.equal(ev.attempts, 2);
  assert.equal(ev.nextAttemptAt, null);

  const replay = await t.app.inject({ method: "POST", url: `/events/${id}/replay`, headers: auth });
  assert.equal(replay.statusCode, 202);
  assert.equal(replay.json().status, "pending");
  assert.equal(replay.json().attempts, 0);
  await sleep(5);
  await t.worker.tick();
  ev = await t.get(id);
  assert.equal(ev.status, "delivered");
  assert.equal(ev.deliveries.length, 3);
  await t.close();
});

test("não entrega antes da hora (backoff respeitado)", async () => {
  const t = await setup([500, 200], { MAX_RETRIES: "3", RETRY_BASE_DELAY_MS: "60000" });
  const id = await t.send();
  await t.worker.tick();
  assert.equal(await t.worker.tick(), 0); // ainda não venceu
  assert.equal((await t.get(id)).attempts, 1);
  assert.equal(t.calls.length, 1);
  await t.close();
});

test("reserva atômica: dois workers não entregam o mesmo evento duas vezes", async () => {
  const t = await setup([200]);
  const id = await t.send();
  const now = new Date().toISOString();
  const { EventsRepo } = await import("../src/repositories/events.js");
  const repo = new EventsRepo(t.db);
  const results = await Promise.all([repo.claim(id, now, 30000), repo.claim(id, now, 30000), repo.claim(id, now, 30000)]);
  assert.equal(results.filter(Boolean).length, 1);
  await t.close();
});

test("assina o reenvio com forwardSecret", async () => {
  const t = await setup([200], {}, { forwardSecret: "meu-segredo" });
  await t.send('{"x":1}');
  await t.worker.tick();
  const h = t.calls[0]!.init.headers as Record<string, string>;
  assert.equal(h["x-hookrelay-signature"], sign("meu-segredo", Buffer.from('{"x":1}')));
  await t.close();
});

test("retenção: remove eventos antigos e suas entregas", async () => {
  const t = await setup([200], { EVENT_RETENTION_DAYS: "1" });
  const id = await t.send();
  await t.worker.tick();
  await t.db.run("UPDATE events SET received_at = ? WHERE id = ?", [new Date(Date.now() - 3 * 86_400_000).toISOString(), id]);
  await t.worker.cleanup();
  assert.equal((await t.app.inject({ url: `/events/${id}`, headers: auth })).statusCode, 404);
  const n = await t.db.get<{ n: number | string }>("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM deliveries");
  assert.equal(Number(n?.n), 0);
  await t.close();
});

test("entrega real via HTTP (sem mock) para um servidor local", async () => {
  const received: { body: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { received.push({ body: data, headers: req.headers }); res.writeHead(200).end("recebido"); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const { makeApp: make } = await import("./helpers.js");
  const ctx = await make();
  const ep: Json = (await ctx.app.inject({ method: "POST", url: "/endpoints", headers: auth, payload: { name: "real", targetUrl: `http://127.0.0.1:${port}/hook` } })).json();
  const id = (await ctx.app.inject({ method: "POST", url: `/in/${ep.slug}`, headers: { "content-type": "application/json" }, payload: '{"real":true}' })).json().eventId;
  await ctx.worker.tick();
  const ev: Json = (await ctx.app.inject({ url: `/events/${id}`, headers: auth })).json();
  assert.equal(ev.status, "delivered");
  assert.equal(ev.deliveries[0].responseBody, "recebido");
  assert.equal(received[0]?.body, '{"real":true}');
  assert.equal(received[0]?.headers["x-hookrelay-event-id"], id);
  await ctx.close();
  await new Promise((r) => server.close(r));
});
