# Política de Segurança

## Reportando uma vulnerabilidade

**Não abra uma issue pública** para falhas de segurança.

Use o recurso **"Report a vulnerability"** (aba *Security* do repositório no GitHub) ou contate os mantenedores em privado. Inclua:

- Descrição do problema e impacto
- Passos para reproduzir
- Versão/commit e banco usado

Nos comprometemos a confirmar o recebimento, avaliar e informar o andamento da correção. Agradecemos reportes feitos de forma responsável.

## Escopo e boas práticas de operação

Ao hospedar o HookRelay, lembre-se:

- **`ADMIN_API_KEY` forte** (`openssl rand -hex 32`) e nunca commitada. O app recusa chave fraca em produção.
- **Sempre use HTTPS.** Chave de API e conteúdo dos webhooks trafegam em texto claro sem TLS.
- O `slug` em `/in/:slug` funciona como segredo. Não o publique em repositórios ou logs.
- `signingSecret` e `forwardSecret` ficam **em texto puro no banco**. Restrinja o acesso ao banco e aos backups.
- **SSRF:** quem tem a `ADMIN_API_KEY` escolhe para onde o servidor faz requisições. Se outras pessoas puderem criar endpoints, ligue `BLOCK_PRIVATE_TARGETS=true` e adicione regras de firewall de saída. Essa opção valida apenas o texto da URL e **não** resolve DNS (um domínio público apontando para IP interno não é bloqueado), nem protege contra redirecionamentos HTTP para endereços internos.
- A rota `/in/:slug` não tem *rate limit*. Em ambiente exposto, use limitação no proxy/CDN.
- Webhooks podem conter dados pessoais: ajuste `EVENT_RETENTION_DAYS` e observe a legislação aplicável (por exemplo, a LGPD).
- Mantenha as dependências atualizadas (`npm audit`).
