/** Especificação OpenAPI 3.0 servida em /docs e em /openapi.json. */
const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string", example: "not_found" }, message: { type: "string" } },
    },
  },
};

const endpointSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string", example: "stripe" },
    slug: { type: "string", description: "Parte secreta da URL de entrada" },
    inboundUrl: { type: "string", example: "https://hookrelay.exemplo.com/in/Xk3...", description: "Cole esta URL no serviço que envia o webhook" },
    targetUrl: { type: "string", nullable: true, example: "https://meuapp.com/webhooks/stripe" },
    signatureHeader: { type: "string", example: "x-signature" },
    rejectInvalidSignature: { type: "boolean" },
    hasSigningSecret: { type: "boolean" },
    hasForwardSecret: { type: "boolean" },
    active: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const endpointInput = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    targetUrl: { type: "string", nullable: true, description: "Se omitido/nulo, o endpoint só armazena (modo inspeção)" },
    signingSecret: { type: "string", nullable: true, description: "Segredo para validar o HMAC-SHA256 de entrada" },
    signatureHeader: { type: "string", default: "x-signature" },
    rejectInvalidSignature: { type: "boolean", default: false, description: "Responde 401 e descarta se a assinatura for inválida" },
    forwardSecret: { type: "string", nullable: true, description: "Se definido, assina o reenvio no cabeçalho x-hookrelay-signature" },
  },
};

const eventSummary = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    endpointId: { type: "string" },
    method: { type: "string", example: "POST" },
    query: { type: "string" },
    bodySize: { type: "integer" },
    sourceIp: { type: "string", nullable: true },
    signatureValid: { type: "boolean", nullable: true, description: "null = endpoint sem segredo configurado" },
    status: { type: "string", enum: ["stored", "pending", "delivered", "failed"] },
    attempts: { type: "integer" },
    nextAttemptAt: { type: "string", format: "date-time", nullable: true },
    lastError: { type: "string", nullable: true },
    receivedAt: { type: "string", format: "date-time" },
    deliveredAt: { type: "string", format: "date-time", nullable: true },
  },
};

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const paging = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
];
const secured = [{ ApiKeyAuth: [] }, { BearerAuth: [] }];
const err = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

export const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "HookRelay API",
    version: "1.0.0",
    description:
      "Receba, armazene, inspecione e reenvie webhooks com retry automático.\n\n" +
      "**Autenticação:** as rotas de administração exigem a `ADMIN_API_KEY` no cabeçalho `x-api-key` " +
      "(ou `Authorization: Bearer <chave>`). A rota pública `/in/{slug}` não exige chave: o `slug` é o segredo.",
    license: { name: "MIT" },
  },
  tags: [
    { name: "Receber", description: "Rota pública que recebe os webhooks" },
    { name: "Endpoints", description: "Cadastro dos endpoints de entrada" },
    { name: "Eventos", description: "Histórico, detalhes e reenvio" },
    { name: "Sistema" },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      BearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: { Error: errorSchema, Endpoint: endpointSchema, EndpointInput: endpointInput, EventSummary: eventSummary },
  },
  paths: {
    "/in/{slug}": {
      post: {
        tags: ["Receber"],
        summary: "Recebe um webhook",
        description: "Também aceita GET, PUT, PATCH e DELETE. Guarda o corpo bruto, responde 200 rapidamente e entrega em segundo plano.",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "*/*": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "200": {
            description: "Recebido e armazenado",
            content: { "application/json": { schema: { type: "object", properties: { received: { type: "boolean" }, eventId: { type: "string" } } } } },
          },
          "401": err("Assinatura inválida (quando rejectInvalidSignature está ligado)"),
          "404": err("Slug desconhecido"),
          "410": err("Endpoint desativado"),
          "413": err("Corpo maior que MAX_BODY_BYTES"),
        },
      },
    },
    "/endpoints": {
      post: {
        tags: ["Endpoints"],
        summary: "Cria um endpoint",
        security: secured,
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EndpointInput" } } } },
        responses: { "201": { description: "Criado", content: { "application/json": { schema: { $ref: "#/components/schemas/Endpoint" } } } }, "400": err("Dados inválidos"), "401": err("Sem permissão") },
      },
      get: {
        tags: ["Endpoints"],
        summary: "Lista endpoints",
        security: secured,
        parameters: paging,
        responses: { "200": { description: "Lista paginada" }, "401": err("Sem permissão") },
      },
    },
    "/endpoints/{id}": {
      get: { tags: ["Endpoints"], summary: "Detalha um endpoint", security: secured, parameters: [idParam], responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Endpoint" } } } }, "404": err("Não encontrado") } },
      patch: {
        tags: ["Endpoints"],
        summary: "Atualiza um endpoint (inclusive ativar/desativar)",
        security: secured,
        parameters: [idParam],
        requestBody: { content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/EndpointInput" }, { type: "object", properties: { active: { type: "boolean" } } }] } } } },
        responses: { "200": { description: "Atualizado" }, "400": err("Dados inválidos"), "404": err("Não encontrado") },
      },
      delete: { tags: ["Endpoints"], summary: "Remove o endpoint e todo o seu histórico", security: secured, parameters: [idParam], responses: { "204": { description: "Removido" }, "404": err("Não encontrado") } },
    },
    "/events": {
      get: {
        tags: ["Eventos"],
        summary: "Lista eventos recebidos",
        security: secured,
        parameters: [
          { name: "endpointId", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["stored", "pending", "delivered", "failed"] } },
          ...paging,
        ],
        responses: { "200": { description: "Lista paginada (sem corpo/headers; use GET /events/{id})" } },
      },
    },
    "/events/{id}": {
      get: { tags: ["Eventos"], summary: "Detalha um evento (headers, corpo e tentativas de entrega)", security: secured, parameters: [idParam], responses: { "200": { description: "OK" }, "404": err("Não encontrado") } },
      delete: { tags: ["Eventos"], summary: "Remove um evento", security: secured, parameters: [idParam], responses: { "204": { description: "Removido" }, "404": err("Não encontrado") } },
    },
    "/events/{id}/replay": {
      post: {
        tags: ["Eventos"],
        summary: "Reenvia um evento",
        description: "Zera as tentativas e coloca o evento de volta na fila.",
        security: secured,
        parameters: [idParam],
        responses: { "202": { description: "Na fila", content: { "application/json": { schema: { $ref: "#/components/schemas/EventSummary" } } } }, "404": err("Não encontrado"), "409": err("Endpoint sem destino") },
      },
    },
    "/stats": { get: { tags: ["Sistema"], summary: "Contagem de eventos por status", security: secured, responses: { "200": { description: "OK" } } } },
    "/health": { get: { tags: ["Sistema"], summary: "Healthcheck (testa a conexão com o banco)", responses: { "200": { description: "Saudável" }, "503": { description: "Banco indisponível" } } } },
  },
};
