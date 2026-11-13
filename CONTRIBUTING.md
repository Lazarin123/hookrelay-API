# Contribuindo com o HookRelay

Obrigado por querer ajudar! Qualquer tipo de contribuição é bem-vindo: código, testes, documentação, correção de typos, ideias e relatos de bugs.

## Antes de começar

- Procure nas *issues* se o assunto já foi discutido.
- Para mudanças grandes (novas funcionalidades, mudanças de comportamento), **abra uma issue antes** para alinharmos a ideia.
- Bugs pequenos e melhorias de documentação podem ir direto para um Pull Request.

## Preparando o ambiente

Requisitos: **Node.js 20+** (o projeto é testado principalmente em 22).

```bash
git clone https://github.com/SEU-USUARIO/hookrelay.git
cd hookrelay
npm install
cp .env.example .env
npm run dev
```

## Fluxo de trabalho

1. Faça um fork e crie uma branch descritiva: `feat/retry-por-endpoint`, `fix/timeout-no-replay`, `docs/guia-fly`.
2. Escreva o código **e os testes** correspondentes (veja `tests/`).
3. Rode tudo localmente:

   ```bash
   npm run typecheck
   npm test
   ```

4. Se mexeu em queries, no banco ou em migrations, **teste também contra Postgres**:

   ```bash
   docker run -d --name pgtest -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hookrelay_test -p 5432:5432 postgres:16
   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hookrelay_test npm test
   ```

5. Abra o Pull Request explicando **o quê** e **por quê**. A CI roda os testes em SQLite e Postgres.

## Regras importantes do projeto

- **SQL portátil**: toda query precisa funcionar em SQLite **e** Postgres. Use `?` como placeholder, datas em ISO-8601 (texto) e booleanos como `0/1`. Evite recursos exclusivos de um banco.
- **Migrations**: nunca edite uma migration já publicada; adicione uma nova no final da lista em `src/db/migrations.ts`. Toda instrução deve ser **idempotente** (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- **Segredos**: a API nunca devolve `signingSecret`/`forwardSecret`. Mantenha assim.
- **Novas variáveis de ambiente**: adicione em `src/config.ts`, comente em `.env.example` e documente na tabela do `README.md`.
- **Documentação da API**: atualize `src/openapi.ts` ao criar/alterar rotas.
- **Dependências**: prefira não adicionar novas. Se for necessário, justifique no PR.

## Estilo

- TypeScript estrito. Sem `any` desnecessário.
- Comentários e documentação em português; nomes de código em inglês.
- Mensagens de commit curtas e claras (sugestão: `feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Reportando bugs

Abra uma issue com: versão/commit, banco usado (SQLite/Postgres), como reproduzir, o que esperava e o que aconteceu. **Não inclua** sua `ADMIN_API_KEY`, URLs de entrada (`/in/...`) nem dados sensíveis dos webhooks.

Vulnerabilidades de segurança: siga o [SECURITY.md](SECURITY.md), não abra issue pública.
