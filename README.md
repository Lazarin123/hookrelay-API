# 🪝 HookRelay

**Receba, armazene, inspecione e reenvie webhooks com retry automático.**
Open source, self-hosted e **sem vendor lock-in: você traz o seu próprio banco de dados.**

![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D20-blue)
![db](https://img.shields.io/badge/banco-SQLite%20%7C%20PostgreSQL-informational)

---

## 📑 Sumário

- [O que é e para que serve](#-o-que-é-e-para-que-serve)
- [Como funciona](#-como-funciona)
- [Funcionalidades](#-funcionalidades)
- [Início rápido](#-início-rápido) (Node ou Docker)
- [Teste em 1 minuto](#-teste-em-1-minuto)
- [Configuração (`.env`)](#configuração-env)
- [Onde conseguir o `DATABASE_URL`](#onde-conseguir-o-database_url)
- [Onde hospedar](#onde-hospedar)
- [Como usar a API](#-como-usar-a-api)
- [Referência da API](#-referência-da-api)
- [Como o retry funciona](#-como-o-retry-funciona)
- [Segurança](#-segurança)
- [Limitações conhecidas](#limitações-conhecidas)
- [Solução de problemas](#-solução-de-problemas)
- [Desenvolvimento e arquitetura](#-desenvolvimento-e-arquitetura)
- [Contribuindo](#-contribuindo) · [Licença](#-licença)

---

## 📌 O que é e para que serve

Quando você integra serviços como Stripe, Mercado Pago, GitHub, Pix ou qualquer plataforma que envia **webhooks**, eles fazem uma requisição HTTP para a sua API a cada evento. Isso traz dores clássicas:

- Sua API estava fora do ar ou fazendo deploy → **o evento se perdeu**.
- Deu erro no seu código → **você não consegue ver o que foi enviado** nem reprocessar.
- Está desenvolvendo localmente → **a plataforma não alcança o seu `localhost`**.

O **HookRelay** fica entre o serviço de origem e a sua aplicação:

1. **Recebe** o webhook e **salva imediatamente** (corpo bruto, cabeçalhos, IP, data).
2. **Responde `200` rápido** ao serviço de origem (ele não fica esperando você).
3. **Encaminha** para o seu servidor, com **retry automático e backoff exponencial**.
4. Guarda o **histórico completo**: você consulta qualquer evento e **reenvia com um comando**.

Ele também funciona como **"caixa de inspeção"** (estilo webhook.site, mas seu): se você não definir um destino, ele apenas armazena para você olhar depois.

> **Por que "traga seu próprio banco"?** O projeto não depende de nenhum serviço hospedado por mim. Em desenvolvimento ele usa um arquivo **SQLite** (nada para instalar). Em produção, você cria um **PostgreSQL gratuito** onde preferir (Neon, Supabase, Aiven...), cola a `DATABASE_URL` no `.env` e pronto. Os dados são seus.

---

## 🧭 Como funciona

```
                    ┌─────────────────────────────────────────┐
 Stripe, GitHub,    │               HookRelay                 │        Seu servidor
 Mercado Pago...    │                                         │
        │           │  POST /in/<slug>                        │
        └──────────►│  1. valida assinatura (opcional)        │
                    │  2. salva no banco ──► [SQLite/Postgres]│
        ◄───────────│  3. responde 200 imediatamente          │
                    │                                         │
                    │  worker em segundo plano:               │
                    │  4. encaminha ────────────────────────────►  POST /seu/webhook
                    │  5. falhou? tenta de novo (2s, 4s, 8s…) │ ◄──── 200 OK
                    │  6. registra cada tentativa             │
                    └─────────────────────────────────────────┘
                                      ▲
              Você consulta o histórico e reenvia via API (x-api-key)
```

---

## ✨ Funcionalidades

- ✅ **URLs de entrada únicas** por endpoint (`/in/<token-secreto>`)
- ✅ **Histórico completo**: método, query string, cabeçalhos, corpo bruto, IP de origem, status
- ✅ **Retry automático** com backoff exponencial e limite configurável
- ✅ **Reenvio manual** de qualquer evento (`POST /events/:id/replay`)
- ✅ **Log de cada tentativa**: status HTTP, resposta do destino, erro, duração
- ✅ **Validação de assinatura HMAC-SHA256** de entrada (compatível com o formato do GitHub) e opção de **rejeitar** assinaturas inválidas
- ✅ **Assinatura no reenvio** (`x-hookrelay-signature`) para o seu servidor confiar que veio do HookRelay
- ✅ **Modo inspeção** (endpoint sem destino, só armazena)
- ✅ **SQLite ou PostgreSQL** pela mesma variável `DATABASE_URL`
- ✅ **Migrations automáticas** ao iniciar (nada para rodar manualmente)
- ✅ **Seguro para várias instâncias** (reserva atômica evita entrega duplicada pelo worker)
- ✅ **Limpeza automática** de eventos antigos (retenção configurável)
- ✅ **Documentação interativa** (Swagger UI em `/docs`) e **healthcheck** (`/health`)
- ✅ **Dockerfile** e **docker-compose** prontos, **testes automatizados** (SQLite e Postgres)

---

## 🚀 Início rápido

Você precisa de **Node.js 20+** (ou Docker). **Não precisa criar nenhum banco** para começar.

### Opção A: Node.js (desenvolvimento)

```bash
git clone https://github.com/SEU-USUARIO/hookrelay.git
cd hookrelay
npm install
cp .env.example .env        # o padrão já funciona com SQLite
npm run dev
```

A API sobe em **http://localhost:3000** e o banco é criado sozinho em `./data/hookrelay.db`.
Abra **http://localhost:3000/docs** para ver a documentação interativa.

> A chave padrão do `.env.example` (`troque-esta-chave`) serve **apenas para desenvolvimento local**. Em produção o app se recusa a iniciar com chave fraca.

### Opção B: Docker

```bash
git clone https://github.com/SEU-USUARIO/hookrelay.git
cd hookrelay
cp .env.example .env
# Edite o .env e defina uma chave forte (o contêiner roda em modo produção):
#   ADMIN_API_KEY=<saída de: openssl rand -hex 32>
docker compose up -d
```

Os dados do SQLite ficam em um volume Docker (`hookrelay-data`). Para testar com um Postgres local, veja os comentários no topo do `docker-compose.yml`.

### Rodar em produção sem Docker

```bash
npm ci
npm run build
NODE_ENV=production npm start     # com as variáveis do .env configuradas
```

---

## 🎬 Teste em 1 minuto

Com o HookRelay rodando (`npm run dev`), em **outro terminal**:

```bash
bash examples/demo.sh
```

O script sobe um servidor de teste que **falha de propósito 2 vezes**, cria um endpoint, envia um webhook e mostra o retry funcionando até a entrega na 3ª tentativa. Se sua chave não for a padrão, rode com `ADMIN_API_KEY=sua-chave bash examples/demo.sh`.

---

## Configuração (`.env`)

Copie `.env.example` para `.env`. **Cada variável está comentada no próprio arquivo.** Resumo:

| Variável | Obrigatória | Padrão | O que faz |
|---|---|---|---|
| `ADMIN_API_KEY` | **Sim** | — | Chave das rotas de administração (cabeçalho `x-api-key`). Gere com `openssl rand -hex 32`. |
| `DATABASE_URL` | Não | `file:./data/hookrelay.db` | Banco. `file:...` = SQLite · `postgresql://...` = Postgres. |
| `PG_POOL_MAX` | Não | `5` | Máx. de conexões (só Postgres). Planos grátis têm limites baixos. |
| `PORT` / `HOST` | Não | `3000` / `0.0.0.0` | Onde o servidor escuta. |
| `PUBLIC_URL` | Não | deduzida | URL pública, usada no campo `inboundUrl` das respostas. |
| `TRUST_PROXY` | Não | `false` | Ligue atrás de proxy/load balancer para registrar o IP real do remetente. |
| `MAX_BODY_BYTES` | Não | `1048576` | Tamanho máximo do corpo de um webhook (1 MB). |
| `ENABLE_DOCS` | Não | `true` | Liga `/docs` e `/openapi.json`. |
| `RUN_WORKER` | Não | `true` | Liga a entrega/retry em segundo plano. |
| `MAX_RETRIES` | Não | `5` | Total de tentativas por evento (a 1ª entrega conta). |
| `RETRY_BASE_DELAY_MS` | Não | `2000` | Espera base do backoff (dobra a cada falha). |
| `RETRY_MAX_DELAY_MS` | Não | `3600000` | Teto da espera entre tentativas (1 h). |
| `DELIVERY_TIMEOUT_MS` | Não | `10000` | Tempo máximo esperando o seu servidor responder. |
| `WORKER_INTERVAL_MS` / `WORKER_BATCH_SIZE` | Não | `1000` / `10` | Frequência e tamanho de lote do worker. |
| `BLOCK_PRIVATE_TARGETS` | Não | `false` | Bloqueia destinos `localhost`/IP privado (veja [Segurança](#-segurança)). |
| `EVENT_RETENTION_DAYS` | Não | `30` | Apaga eventos mais antigos que N dias. `0` = nunca apagar. |
| `LOG_LEVEL` | Não | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |

---

## Onde conseguir o `DATABASE_URL`

### Desenvolvimento local → não faça nada

```env
DATABASE_URL="file:./data/hookrelay.db"
```

### Produção → PostgreSQL gratuito

1. Crie uma conta em um provedor de Postgres. Opções comuns: **[Neon](https://neon.tech)**, **[Supabase](https://supabase.com)**, **[Aiven](https://aiven.io)** ou o Postgres do **[Railway](https://railway.com)**.
2. Crie um projeto/banco e copie a **connection string** (URI de conexão) no painel.
3. Cole no `.env` (ou nas variáveis de ambiente da hospedagem):

   ```env
   DATABASE_URL="postgresql://usuario:senha@host:5432/banco?sslmode=verify-full"
   ```
4. Inicie o app. As tabelas são criadas automaticamente.

👉 **Passo a passo detalhado de cada provedor, SSL, limites e backup: [docs/DATABASES.md](docs/DATABASES.md)**

> ⚠️ **SQLite em hospedagem com disco efêmero perde dados.** Em Render (plano grátis), Heroku, Cloud Run e similares, o arquivo some a cada deploy/reinício. Nessas plataformas **use Postgres**. SQLite é ótimo para desenvolvimento e para VPS/servidor com disco persistente (ou volume Docker).

---

## Onde hospedar

| Onde | Combina com | Observação |
|---|---|---|
| **Render** | Docker + Postgres externo | Há `render.yaml` pronto. O plano grátis pode "adormecer" por inatividade, o que atrasa o recebimento. |
| **Railway** | Docker + Postgres do próprio Railway | Detecta o `Dockerfile` automaticamente. |
| **Fly.io** | Docker + Postgres externo (ou SQLite com volume) | `fly launch`. |
| **VPS** (Hetzner, DigitalOcean, Oracle Cloud...) | `docker compose` + SQLite ou Postgres | Mais controle; ponha Caddy/Nginx na frente para HTTPS. |
| **Koyeb** e similares | Docker + Postgres externo | Qualquer plataforma que rode contêiner serve. |

Planos gratuitos mudam com frequência: **confira os limites atuais no site de cada serviço**.
👉 **Guia de deploy passo a passo: [docs/DEPLOY.md](docs/DEPLOY.md)**

---

## 📡 Como usar a API

Nos exemplos abaixo, `KEY` é a sua `ADMIN_API_KEY` e `BASE` é a URL da sua instância.

```bash
export BASE=http://localhost:3000
export KEY=troque-esta-chave
```

### 1. Crie um endpoint

```bash
curl -X POST $BASE/endpoints \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"stripe","targetUrl":"https://meuapp.com/webhooks/stripe"}'
```

A resposta traz o `inboundUrl`, a URL pública que você cola no serviço de origem:

```json
{
  "id": "1a2736fb-bfed-41d2-aae8-3ebee136970e",
  "name": "stripe",
  "slug": "Xk3...",
  "inboundUrl": "http://localhost:3000/in/Xk3...",
  "targetUrl": "https://meuapp.com/webhooks/stripe",
  "active": true
}
```

### 2. Configure o `inboundUrl` no serviço de origem

No painel do Stripe, GitHub, Mercado Pago etc., cadastre o `inboundUrl` como URL do webhook. Para testar na mão:

```bash
curl -X POST "$BASE/in/SEU_SLUG" \
  -H "Content-Type: application/json" \
  -d '{"evento":"pagamento.aprovado","valor":99.9}'
# -> {"received":true,"eventId":"..."}
```

> Desenvolvendo no `localhost`? Aponte o `targetUrl` para a sua máquina (ex.: `http://localhost:4000/webhook`) e rode o HookRelay hospedado ou exposto por um túnel. Ele entrega no seu computador **quando você estiver online** e guarda tudo enquanto não estiver.

### 3. Consulte os eventos

```bash
# Lista (mais recentes primeiro). Filtros: endpointId, status, limit, offset
curl "$BASE/events?status=failed&limit=20" -H "x-api-key: $KEY"

# Detalhes: cabeçalhos, corpo, JSON interpretado e todas as tentativas de entrega
curl $BASE/events/ID_DO_EVENTO -H "x-api-key: $KEY"
```

### 4. Reenvie um evento

```bash
curl -X POST $BASE/events/ID_DO_EVENTO/replay -H "x-api-key: $KEY"
# -> 202. As tentativas são zeradas e o evento volta para a fila.
```

### 5. Outras ações úteis

```bash
curl $BASE/stats -H "x-api-key: $KEY"                       # contagem de eventos por status
curl -X PATCH $BASE/endpoints/ID -H "x-api-key: $KEY" \
     -H "Content-Type: application/json" -d '{"active":false}'   # pausa o endpoint (responde 410)
curl -X DELETE $BASE/events/ID -H "x-api-key: $KEY"         # apaga um evento
curl -X DELETE $BASE/endpoints/ID -H "x-api-key: $KEY"      # apaga o endpoint e TODO o histórico dele
```

### Modo inspeção (sem destino)

Crie o endpoint **sem** `targetUrl`. O HookRelay só armazena. Ótimo para descobrir o que um serviço realmente envia:

```bash
curl -X POST $BASE/endpoints -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"so-olhando"}'
```

Eventos desse endpoint ficam com status `stored` e não podem ser reenviados (não há para onde).

### Validando a assinatura de quem envia (entrada)

Se o serviço de origem assina o corpo com **HMAC-SHA256** (hexadecimal, com ou sem o prefixo `sha256=`, como faz o GitHub em `X-Hub-Signature-256`), informe o segredo:

```bash
curl -X POST $BASE/endpoints -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "name": "github",
  "targetUrl": "https://meuapp.com/webhooks/github",
  "signingSecret": "o-segredo-configurado-no-github",
  "signatureHeader": "X-Hub-Signature-256",
  "rejectInvalidSignature": true
}'
```

- Com `rejectInvalidSignature: true`, assinatura inválida recebe **401** e o evento é descartado.
- Com `false` (padrão), o evento é guardado e marcado com `signatureValid: false`, útil para depurar.
- Serviços que usam outro formato (ex.: Stripe, com `t=...,v1=...`) **ainda não têm validação nativa**: deixe sem `signingSecret`. O HookRelay repassa o corpo **idêntico byte a byte** e todos os cabeçalhos originais, então o seu servidor continua conseguindo validar a assinatura original.

### Confiando no HookRelay (assinatura do reenvio)

Defina `forwardSecret` no endpoint e todo reenvio chega com o cabeçalho `x-hookrelay-signature: sha256=<hmac do corpo>`. No seu servidor (Node/Express):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

app.post("/webhooks/stripe", express.raw({ type: "*/*" }), (req, res) => {
  const expected = "sha256=" + createHmac("sha256", process.env.HOOKRELAY_FORWARD_SECRET)
    .update(req.body)            // corpo BRUTO (Buffer), não o JSON já interpretado
    .digest("hex");
  const received = String(req.headers["x-hookrelay-signature"] ?? "");

  const ok = received.length === expected.length &&
             timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!ok) return res.status(401).end();

  // Idempotência: o mesmo evento pode chegar mais de uma vez (veja "Como o retry funciona").
  const eventId = req.headers["x-hookrelay-event-id"];
  // ...se já processou `eventId`, responda 200 e ignore.

  res.status(200).end();
});
```

### Cabeçalhos extras que o seu servidor recebe

| Cabeçalho | Conteúdo |
|---|---|
| `x-hookrelay-event-id` | ID único do evento (use para evitar processar duas vezes) |
| `x-hookrelay-attempt` | Número da tentativa (1, 2, 3...) |
| `x-hookrelay-signature` | Só se o endpoint tiver `forwardSecret` |
| *(originais)* | Todos os cabeçalhos do envio original, exceto os de conexão (`host`, `content-length`...) |

---

## 📚 Referência da API

Documentação interativa completa em **`/docs`** (Swagger UI) e especificação em **`/openapi.json`**.

**Pública** (sem chave; o `slug` é o segredo):

| Método | Rota | Descrição |
|---|---|---|
| `POST` (também `GET`, `PUT`, `PATCH`, `DELETE`) | `/in/:slug` | Recebe um webhook. Retorna `200 {"received":true,"eventId":"..."}`. |
| `GET` | `/health` | Healthcheck (testa o banco). `200` ou `503`. |

**Administração** (exige `x-api-key: <ADMIN_API_KEY>` ou `Authorization: Bearer <chave>`):

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/endpoints` | Cria endpoint |
| `GET` | `/endpoints` | Lista (paginado) |
| `GET` | `/endpoints/:id` | Detalha |
| `PATCH` | `/endpoints/:id` | Atualiza (inclusive `active`) |
| `DELETE` | `/endpoints/:id` | Remove endpoint e histórico |
| `GET` | `/events` | Lista eventos (`endpointId`, `status`, `limit`, `offset`) |
| `GET` | `/events/:id` | Detalhes + tentativas de entrega |
| `POST` | `/events/:id/replay` | Reenvia |
| `DELETE` | `/events/:id` | Remove |
| `GET` | `/stats` | Contagem por status |

**Erros** seguem sempre o formato `{"error":{"code":"...","message":"..."}}`.

**Status de um evento:**

| Status | Significado |
|---|---|
| `pending` | Aguardando entrega (ou aguardando a próxima tentativa) |
| `delivered` | O destino respondeu 2xx |
| `failed` | Esgotou as tentativas (`MAX_RETRIES`). Dá para reenviar manualmente. |
| `stored` | Endpoint sem destino (modo inspeção) |

---

## 🔁 Como o retry funciona

- A 1ª entrega é tentada **logo após o recebimento**.
- Qualquer resposta **diferente de 2xx**, erro de rede ou **timeout** conta como falha e agenda nova tentativa.
- A espera **dobra a cada falha**: com os padrões, 2s → 4s → 8s → 16s (limitada por `RETRY_MAX_DELAY_MS`).
- Após `MAX_RETRIES` tentativas o evento vira `failed`. Você pode reenviá-lo com `/replay`.
- Se o HookRelay reiniciar no meio de uma entrega, a reserva do evento expira sozinha e ele é tentado de novo.

**Garantia: "pelo menos uma vez" (*at-least-once*).** Em raras situações (ex.: seu servidor processou mas a resposta se perdeu) o mesmo evento pode chegar duas vezes. **Torne o seu handler idempotente** usando o cabeçalho `x-hookrelay-event-id`.

**Ordem não é garantida:** retries podem fazer o evento 1 chegar depois do evento 2.

---

## 🔐 Segurança

- **Troque a `ADMIN_API_KEY`.** Em produção o app recusa iniciar com chave de menos de 16 caracteres ou com o valor de exemplo.
- **Use HTTPS** (a hospedagem normalmente já oferece; em VPS use Caddy/Nginx).
- O **`slug`** da URL de entrada é um segredo de 144 bits. Quem tem a URL pode enviar eventos. Para mais proteção, use `signingSecret` + `rejectInvalidSignature`.
- Os segredos (`signingSecret`, `forwardSecret`) **nunca são devolvidos** pela API; ela só informa se existem. Eles ficam guardados **em texto puro** no seu banco, então proteja o acesso a ele.
- **`BLOCK_PRIVATE_TARGETS=true`** impede que alguém cadastre destinos como `http://localhost` ou `http://10.0.0.5` (risco de SSRF). Ele confere só o que está escrito na URL; **não resolve DNS**, então um domínio público apontando para IP interno não é barrado. Para ambientes sensíveis, combine com regras de firewall de saída.
- Webhooks podem conter **dados sensíveis** (e-mails, valores, IDs). Defina uma `EVENT_RETENTION_DAYS` adequada.
- Encontrou uma vulnerabilidade? Veja [SECURITY.md](SECURITY.md).

---

## Limitações conhecidas

Transparência sobre o que o projeto **ainda não** faz:

- Não há painel web; a interação é pela API (e `/docs`).
- Sem limite de requisições (*rate limit*) na rota `/in`. Se precisar, use o do seu proxy/CDN.
- Validação de assinatura de entrada só para **HMAC-SHA256 simples do corpo**.
- A configuração de retry é global (não por endpoint).
- O campo `body` na API mostra o corpo como texto UTF-8; para corpos binários a exibição é imprecisa, mas **o reenvio é fiel byte a byte**.
- Resposta do destino é guardada só nos primeiros 2000 caracteres.
- Bancos suportados: **SQLite e PostgreSQL**. (MySQL, MongoDB e Turso não são suportados.)
- Rotas `HEAD` e `OPTIONS` em `/in/:slug` não são tratadas.

Veja o [Roadmap](#roadmap) abaixo.

---

## 🩺 Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| `Configuração inválida no .env: ADMIN_API_KEY é obrigatória` | Falta criar o `.env` (`cp .env.example .env`) ou definir a variável na hospedagem. |
| `ADMIN_API_KEY insegura para produção` | Use uma chave com 16+ caracteres: `openssl rand -hex 32`. |
| `401 unauthorized` nas rotas de administração | Cabeçalho `x-api-key` ausente ou diferente da `ADMIN_API_KEY` do servidor. |
| `404` em `/in/...` | `slug` errado. Pegue o `inboundUrl` exato retornado ao criar o endpoint. |
| `410` em `/in/...` | O endpoint está desativado (`active: false`). |
| `413` em `/in/...` | Corpo maior que `MAX_BODY_BYTES`. Aumente o limite se necessário. |
| Eventos ficam `pending` | Seu destino está fora do ar (veja `lastError` e as `deliveries` do evento), ou `RUN_WORKER=false` sem outra instância com worker ligado. |
| `self-signed certificate in certificate chain` (Postgres) | O provedor usa CA própria. Troque o final da URL por `?uselibpqcompat=true&sslmode=require`. |
| Aviso `SECURITY WARNING: The SSL modes 'prefer', 'require'...` | Informativo do driver. Use `sslmode=verify-full` na URL para silenciar. |
| `too many connections` (Postgres) | Reduza `PG_POOL_MAX` (ex.: `2`) ou use a URL de *pooler* do provedor. |
| Os dados sumiram após um deploy | Você usou SQLite em disco efêmero. Migre para Postgres. |
| Porta em uso (`EADDRINUSE`) | Mude `PORT` no `.env`. |

---

## 🧱 Desenvolvimento e arquitetura

```bash
npm run dev         # servidor com recarga automática (tsx watch)
npm test            # testes, com SQLite em memória
npm run typecheck   # checagem de tipos
npm run build       # compila para dist/
```

**Testar também contra Postgres:**

```bash
docker run -d --name pgtest -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hookrelay_test -p 5432:5432 postgres:16
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hookrelay_test npm test
```

> ⚠️ Com `TEST_DATABASE_URL` os testes **apagam e recriam as tabelas** do banco apontado. Use um banco só para testes.

**Estrutura:**

```
src/
├─ server.ts              # inicialização e encerramento gracioso
├─ app.ts                 # monta o Fastify, rotas, docs e tratamento de erros
├─ config.ts              # lê e valida o .env
├─ openapi.ts             # especificação servida em /docs
├─ db/
│  ├─ index.ts            # escolhe o banco pela DATABASE_URL
│  ├─ sqlite.ts           # adaptador SQLite (better-sqlite3)
│  ├─ postgres.ts         # adaptador PostgreSQL (pg)
│  └─ migrations.ts       # SQL portátil, roda no boot
├─ repositories/          # acesso a dados (endpoints, events)
├─ routes/                # ingest (/in) e admin (/endpoints, /events, /stats)
├─ services/
│  ├─ worker.ts           # entrega, retry, backoff, limpeza
│  ├─ signature.ts        # HMAC-SHA256
│  └─ urlGuard.ts         # validação de URL de destino
└─ utils/                 # auth e erros
tests/                    # unitários e de integração
examples/                 # receiver.mjs e demo.sh
docs/                     # guias de banco e deploy
```

**Decisões de projeto:**

- **SQL puro e portátil em vez de ORM**: as mesmas queries rodam em SQLite e Postgres (datas em ISO-8601 como texto, booleanos como 0/1). Os adaptadores traduzem só os placeholders.
- **Corpo guardado bruto (base64)**: assinatura e reenvio ficam fiéis ao original.
- **Worker no mesmo processo**: simples de hospedar. Várias instâncias são seguras graças à reserva atômica (`UPDATE ... WHERE` condicional) com expiração.
- **Migrations idempotentes**: duas instâncias subindo juntas não conflitam.

---

## Roadmap

- [ ] Painel web para visualizar e reenviar eventos
- [ ] Retry configurável por endpoint
- [ ] Validação de assinatura em formatos específicos (Stripe e outros)
- [ ] Alertas (e-mail/Telegram) quando um evento falhar de vez
- [ ] Fan-out: um endpoint de entrada → vários destinos
- [ ] Filtros e transformações simples de payload

Sugestões são bem-vindas: abra uma *issue*.

---

## 🤝 Contribuindo

Contribuições são muito bem-vindas! Leia o [CONTRIBUTING.md](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md).

1. Faça um *fork*
2. Crie uma branch: `git checkout -b feat/minha-ideia`
3. Rode `npm test` e `npm run typecheck`
4. Abra um *Pull Request*

---

## 📄 Licença

[MIT](LICENSE). Use, modifique e distribua livremente.
