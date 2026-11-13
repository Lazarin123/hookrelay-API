# ☁️ Guia de deploy

Antes de começar, tenha em mãos:

1. Uma **`ADMIN_API_KEY`** forte: `openssl rand -hex 32`
2. Uma **`DATABASE_URL`** de Postgres (veja [DATABASES.md](DATABASES.md)), **a não ser** que você vá usar uma VPS/servidor com disco persistente e SQLite.

Variáveis recomendadas em qualquer hospedagem:

```env
NODE_ENV=production
ADMIN_API_KEY=<sua chave forte>
DATABASE_URL=<url do postgres>
TRUST_PROXY=true
PUBLIC_URL=https://seu-dominio-ou-url-da-hospedagem
```

A aplicação lê a porta de `PORT`; plataformas que definem essa variável sozinhas (Render, Railway...) funcionam sem configuração extra. O healthcheck é `GET /health`.

> Planos gratuitos, nomes de menus e comandos de cada plataforma mudam com o tempo. Use este guia como roteiro e confirme os detalhes na documentação oficial de cada uma.

---

## Render — https://render.com

**Via Blueprint (mais fácil):**

1. Suba o projeto para o seu GitHub.
2. No Render: **New → Blueprint** e selecione o repositório. Ele lê o `render.yaml`.
3. Quando pedir, cole a `DATABASE_URL` do seu Postgres externo. A `ADMIN_API_KEY` é gerada automaticamente (veja o valor nas variáveis do serviço).
4. Após o deploy, teste: `https://SEU-APP.onrender.com/health`.

**Manual:** New → Web Service → seu repositório → ambiente **Docker** → adicione as variáveis acima.

⚠️ O disco é **efêmero** no plano gratuito: **não use SQLite**. Além disso, serviços gratuitos podem ser suspensos por inatividade, e a primeira requisição depois disso demora. Para webhooks, isso pode causar timeout no serviço de origem (ele tentará de novo, mas depende de cada plataforma). Para produção séria, considere um plano pago ou outra hospedagem.

## Railway — https://railway.com

1. **New Project → Deploy from GitHub repo**. O Railway detecta o `Dockerfile`.
2. Adicione um serviço **PostgreSQL** ao mesmo projeto.
3. Nas variáveis do serviço do HookRelay, defina `ADMIN_API_KEY`, `TRUST_PROXY=true`, `NODE_ENV=production` e `DATABASE_URL` (pode referenciar a variável do serviço Postgres).
4. Em **Settings → Networking**, gere um domínio público.

## Fly.io — https://fly.io

```bash
fly launch                     # detecta o Dockerfile; ajuste o nome/região
fly secrets set ADMIN_API_KEY=$(openssl rand -hex 32) DATABASE_URL="postgresql://..."
fly deploy
```

Confira se `internal_port` no `fly.toml` gerado é `3000`. Para usar SQLite no Fly, crie um **volume** e monte em `/app/data` (e mantenha uma única máquina).

## VPS própria (Hetzner, DigitalOcean, Oracle Cloud, etc.)

Com Docker instalado no servidor:

```bash
git clone https://github.com/SEU-USUARIO/hookrelay.git && cd hookrelay
cp .env.example .env && nano .env      # defina ADMIN_API_KEY (e DATABASE_URL se usar Postgres)
docker compose up -d
```

Os dados do SQLite persistem no volume `hookrelay-data`.

**HTTPS com Caddy** (certificado automático). Instale o Caddy e use este `Caddyfile`:

```
hookrelay.seudominio.com {
    reverse_proxy localhost:3000
}
```

Aponte o DNS do domínio para o IP da VPS e defina no `.env`: `TRUST_PROXY=true` e `PUBLIC_URL=https://hookrelay.seudominio.com`.

**Atualizar:**

```bash
git pull && docker compose up -d --build
```

## Outras plataformas de contêiner (Koyeb, Northflank, Google Cloud Run...)

Qualquer plataforma que rode uma imagem Docker serve: aponte para o `Dockerfile`, defina as variáveis, exponha a porta `3000` e use `/health` como healthcheck. Em plataformas de disco efêmero, use Postgres.

---

## Checklist pós-deploy

- [ ] `GET /health` retorna `{"status":"ok","database":"postgres",...}`
- [ ] Criei um endpoint (`POST /endpoints`) e recebi o `inboundUrl` com o domínio correto
- [ ] Enviei um webhook de teste e o evento apareceu em `GET /events`
- [ ] `ADMIN_API_KEY` guardada em um gerenciador de senhas
- [ ] Defini `EVENT_RETENTION_DAYS` de acordo com o espaço do meu banco
- [ ] (Opcional) Desliguei a documentação pública com `ENABLE_DOCS=false`
