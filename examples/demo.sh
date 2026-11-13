#!/usr/bin/env bash
# Demonstração ponta a ponta. Requisitos: HookRelay rodando e `node` instalado.
#   1) Em um terminal:  npm run dev
#   2) Em outro:        bash examples/demo.sh
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
KEY="${ADMIN_API_KEY:-troque-esta-chave}"
RECEIVER_PORT=4000

echo "▶ Subindo um receiver de teste na porta $RECEIVER_PORT (falha 2x antes de aceitar)..."
node "$(dirname "$0")/receiver.mjs" "$RECEIVER_PORT" 2 &
RECEIVER_PID=$!
trap 'kill $RECEIVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "▶ Criando um endpoint..."
EP=$(curl -fsS -X POST "$BASE/endpoints" \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d "{\"name\":\"demo\",\"targetUrl\":\"http://localhost:$RECEIVER_PORT/webhook\"}")
echo "$EP"
SLUG=$(echo "$EP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).slug))')

echo "▶ Enviando um webhook para $BASE/in/$SLUG ..."
curl -fsS -X POST "$BASE/in/$SLUG" -H "Content-Type: application/json" -d '{"evento":"pagamento.aprovado","valor":99.9}'
echo

echo "▶ Aguardando os retries (2s + 4s)..."
sleep 8

echo "▶ Eventos registrados:"
curl -fsS "$BASE/events" -H "x-api-key: $KEY"
echo
