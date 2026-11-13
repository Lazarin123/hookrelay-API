// Servidor mínimo para TESTAR o HookRelay: imprime tudo que receber.
// Uso:  node examples/receiver.mjs [porta] [falhas]
//   porta   padrão 4000
//   falhas  quantas primeiras requisições devem responder 500 (para ver o retry funcionando). Padrão 0.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4000);
let failuresLeft = Number(process.argv[3] ?? 0);

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const attempt = req.headers["x-hookrelay-attempt"];
    console.log(`\n→ ${req.method} ${req.url} (tentativa ${attempt ?? "?"}, evento ${req.headers["x-hookrelay-event-id"] ?? "?"})`);
    console.log("  corpo:", body);
    if (failuresLeft > 0) {
      failuresLeft--;
      console.log("  ✗ respondendo 500 de propósito");
      res.writeHead(500).end("falha simulada");
      return;
    }
    console.log("  ✓ respondendo 200");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  });
}).listen(port, () => console.log(`Receiver de teste em http://localhost:${port}`));
