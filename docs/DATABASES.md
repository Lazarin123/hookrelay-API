# 🗄️ Guia de banco de dados

O HookRelay escolhe o banco pelo **começo** da variável `DATABASE_URL`:

| Começa com | Banco | Quando usar |
|---|---|---|
| `file:` ou `sqlite:` | SQLite (arquivo local) | Desenvolvimento; VPS/servidor com disco persistente |
| `postgresql://` ou `postgres://` | PostgreSQL | Produção; hospedagem com disco efêmero; várias instâncias |

As tabelas são criadas automaticamente no primeiro início. **Você nunca precisa rodar SQL manualmente.**

---

## SQLite (padrão)

```env
DATABASE_URL="file:./data/hookrelay.db"
```

- A pasta `data/` e o arquivo são criados sozinhos.
- Existe também `file::memory:` (banco em memória, some ao encerrar; útil em testes).
- **Em Docker**, monte um volume em `/app/data` (o `docker-compose.yml` já faz isso).
- **Não use** em plataformas de disco efêmero (Render grátis, Heroku, Cloud Run...). Os dados somem a cada deploy.
- Use **uma única instância** da aplicação com SQLite.

**Backup:**

```bash
sqlite3 data/hookrelay.db ".backup 'backup-$(date +%F).db'"
```

(Copiar o arquivo com o app rodando pode gerar cópia inconsistente por causa do modo WAL; prefira o comando acima.)

---

## PostgreSQL

### Formato da URL

```
postgresql://USUARIO:SENHA@HOST:PORTA/NOME_DO_BANCO?sslmode=verify-full
```

Se a senha tiver caracteres especiais (`@`, `/`, `#`, `:`), eles precisam ser *URL-encoded* (ex.: `@` vira `%40`).

### Onde criar um Postgres gratuito

Os provedores abaixo oferecem Postgres gerenciado com plano gratuito **no momento em que este guia foi escrito**. Limites e regras de plano mudam com frequência, então **confira sempre na página oficial**. As telas também mudam: se um nome de menu estiver diferente, procure por "connection string" / "connect".

#### Neon — https://neon.tech

1. Crie uma conta e um **projeto**.
2. No painel do projeto, procure o botão **Connect** (ou a seção *Connection details*).
3. Copie a **connection string** (formato `postgresql://...neon.tech/...?sslmode=require`).
4. Cole em `DATABASE_URL`. Recomendado trocar `sslmode=require` por `sslmode=verify-full`.

Observação: bancos serverless podem "adormecer" quando ficam sem uso e levar um instante a mais na primeira conexão.

#### Supabase — https://supabase.com

1. Crie uma conta e um **projeto** (guarde a senha do banco que você definir).
2. No painel do projeto, abra **Connect** (ou *Project Settings → Database*) e copie a **connection string** no modo URI.
3. Substitua `[YOUR-PASSWORD]` pela senha do banco.
4. Se a conexão direta falhar (alguns ambientes não alcançam o endereço direto), use a string do **pooler** em modo *session* que o painel oferece.

#### Aiven — https://aiven.io

1. Crie um serviço PostgreSQL no plano gratuito, se disponível para a sua conta.
2. Copie a **Service URI** da página do serviço.
3. O Aiven usa uma CA própria. Se aparecer `self-signed certificate in certificate chain`, use no final da URL: `?uselibpqcompat=true&sslmode=require`.

#### Railway — https://railway.com

1. No seu projeto, adicione um serviço **PostgreSQL**.
2. Na aba de variáveis do banco, copie `DATABASE_URL` (ou `DATABASE_PUBLIC_URL` se for conectar de fora do Railway).
3. Se o HookRelay também roda no Railway, você pode referenciar a variável do banco direto na configuração do serviço.

#### Qualquer outro Postgres

Funciona com qualquer PostgreSQL 12+ acessível por rede: RDS, Google Cloud SQL, DigitalOcean, o seu próprio servidor, etc. Basta a URL.

### SSL / TLS

| Situação | O que colocar no final da URL |
|---|---|
| Provedor com certificado de CA pública (Neon, Supabase...) | `?sslmode=verify-full` |
| Provedor com CA própria (Aiven...) | `?uselibpqcompat=true&sslmode=require` |
| Postgres local sem SSL | `?sslmode=disable` (ou nada) |

Com `sslmode=require` o driver trata como `verify-full` e imprime um aviso de segurança informativo. Não é erro.

### Limite de conexões

Planos gratuitos permitem poucas conexões simultâneas. O HookRelay usa no máximo `PG_POOL_MAX` (padrão **5**). Se aparecer `too many connections` ou `remaining connection slots are reserved`, reduza:

```env
PG_POOL_MAX=2
```

### Várias instâncias

Com Postgres você pode rodar mais de uma instância do HookRelay. O worker usa uma reserva atômica por evento, então o mesmo evento não é entregue em paralelo por duas instâncias. As migrations são idempotentes, então subir duas instâncias ao mesmo tempo é seguro.

### Backup

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```

Muitos provedores também oferecem backups/restauração pelo painel (verifique o plano).

---

## Controlando o tamanho do banco

Webhooks acumulam rápido. Planos gratuitos têm armazenamento limitado. O HookRelay apaga automaticamente eventos antigos (e as tentativas de entrega, em cascata):

```env
EVENT_RETENTION_DAYS=30   # 0 desliga a limpeza
```

Para apagar manualmente: `DELETE /events/:id` ou `DELETE /endpoints/:id` (remove o endpoint e todo o histórico dele).

## Migrando de SQLite para PostgreSQL

Não há migração automática de dados. Como o histórico de webhooks costuma ser descartável, o caminho comum é: trocar a `DATABASE_URL`, recriar os endpoints (`POST /endpoints`) e atualizar as URLs de entrada (`inboundUrl`) nos serviços de origem. Se precisa preservar o histórico, exporte pela API (`GET /events`) antes de trocar.
