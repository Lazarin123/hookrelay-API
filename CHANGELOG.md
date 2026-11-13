# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). O projeto segue [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0]

### Adicionado
- Recebimento de webhooks em `/in/:slug` com armazenamento do corpo bruto, cabeçalhos, query string e IP de origem
- Entrega em segundo plano com retry e backoff exponencial configuráveis
- Reenvio manual de eventos e histórico de tentativas de entrega
- Validação de assinatura HMAC-SHA256 de entrada (com opção de rejeitar) e assinatura do reenvio
- Modo inspeção (endpoint sem destino)
- Suporte a SQLite e PostgreSQL pela variável `DATABASE_URL`, com migrations automáticas
- Retenção/limpeza automática de eventos antigos
- API de administração protegida por `ADMIN_API_KEY`, documentação Swagger em `/docs`, healthcheck em `/health`
- Dockerfile, docker-compose, blueprint do Render e CI (SQLite e PostgreSQL)
