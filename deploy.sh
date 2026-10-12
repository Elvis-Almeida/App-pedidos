#!/usr/bin/env bash
# Publica o Vendas Online no Docker Swarm.
#
#   ./deploy.sh prod    → produção   (usa .env.prod)
#   ./deploy.sh dev     → homologação (usa .env.dev)
#
# O que ele faz:
#   1. constrói a imagem com uma versão nova (data + commit)
#   2. cria os segredos que ainda não existem (e mostra a senha do admin uma vez)
#   3. atualiza a stack; ao subir, cada container migra o banco sozinho
#      (com trava) e, se algo falhar, o Swarm volta para a versão anterior
#
# Rode no nó manager do Swarm (onde ficam o banco e as fotos).

set -euo pipefail
cd "$(dirname "$0")"

AMBIENTE="${1:-}"
if [[ "$AMBIENTE" != "prod" && "$AMBIENTE" != "dev" ]]; then
  echo "Uso: ./deploy.sh prod|dev" >&2
  exit 1
fi

ARQUIVO_ENV=".env.$AMBIENTE"
if [[ ! -f "$ARQUIVO_ENV" ]]; then
  echo "Falta o arquivo $ARQUIVO_ENV. Copie de $ARQUIVO_ENV.exemplo e ajuste." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "./$ARQUIVO_ENV"
set +a

: "${VENDAS_STACK:?defina VENDAS_STACK em $ARQUIVO_ENV}"
: "${VENDAS_DOMINIO:?defina VENDAS_DOMINIO em $ARQUIVO_ENV}"
REDE="${VENDAS_REDE_TRAEFIK:-crononest}"

if ! docker network inspect "$REDE" >/dev/null 2>&1; then
  echo "A rede do Traefik \"$REDE\" não existe. Ajuste VENDAS_REDE_TRAEFIK em $ARQUIVO_ENV." >&2
  exit 1
fi

# ---------- 1. imagem ----------
VERSAO="$(date +%Y%m%d-%H%M%S)"
if git rev-parse --short HEAD >/dev/null 2>&1; then
  VERSAO="$VERSAO-$(git rev-parse --short HEAD)"
fi
echo "==> Construindo vendas-online:$VERSAO"
docker build --build-arg "VERSAO=$VERSAO" -t "vendas-online:$VERSAO" -t vendas-online:latest .

# ---------- 2. segredos ----------
criar_segredo() {
  local nome="${VENDAS_STACK}_$1" valor="$2"
  if docker secret inspect "$nome" >/dev/null 2>&1; then
    return 1
  fi
  printf '%s' "$valor" | docker secret create "$nome" - >/dev/null
  echo "    segredo $nome criado"
}

echo "==> Conferindo segredos"
criar_segredo secret_key "$(openssl rand -base64 48 | tr -d '\n')" || true
criar_segredo db_password "$(openssl rand -hex 24)" || true
SENHA_ADMIN="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
if criar_segredo admin_senha "$SENHA_ADMIN"; then
  echo
  echo "    ┌──────────────────────────────────────────────────────────┐"
  echo "    │ Admin: https://$VENDAS_DOMINIO/admin"
  echo "    │ Usuário: ${VENDAS_ADMIN_USUARIO:-(defina VENDAS_ADMIN_USUARIO)}"
  echo "    │ Senha:   $SENHA_ADMIN"
  echo "    │ Guarde agora: ela não aparece de novo. Troque no admin."
  echo "    └──────────────────────────────────────────────────────────┘"
  echo
fi

# ---------- 3. stack ----------
echo "==> Atualizando a stack $VENDAS_STACK ($VENDAS_DOMINIO)"
VENDAS_TAG="$VERSAO" docker stack deploy --prune -c stack.yml "$VENDAS_STACK"

echo "==> Acompanhe com:"
echo "    docker service ps ${VENDAS_STACK}_api"
echo "    docker service logs -f ${VENDAS_STACK}_api"
