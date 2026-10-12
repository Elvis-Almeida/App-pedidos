#!/usr/bin/env bash
# Copia os backups automáticos (feitos todo dia pelo serviço "tarefas") para
# fora do volume, numa pasta da VPS — de onde dá para levar para outro lugar.
#
#   ./backup.sh            → ./backups/ (produção)
#   ./backup.sh dev        → homologação
#   ./backup.sh prod agora → faz uma cópia nova na hora, antes de copiar
#
# Restaurar um banco (CUIDADO: substitui os dados atuais):
#   docker run --rm -i --network vendas_interna -e PGPASSWORD="..." postgres:17-alpine \
#     pg_restore -h banco -U vendas -d vendas --clean --if-exists < backups/banco-AAAA-MM-DD.dump

set -euo pipefail
cd "$(dirname "$0")"
AMBIENTE="${1:-prod}"
ARQUIVO_ENV=".env"; [[ "$AMBIENTE" == "dev" ]] && ARQUIVO_ENV=".env.dev"
[[ "$AMBIENTE" == "prod" && ! -f .env && -f .env.prod ]] && ARQUIVO_ENV=".env.prod"
# só o nome da stack interessa aqui (aceita arquivo salvo no Windows)
STACK="$( [[ -f "$ARQUIVO_ENV" ]] && sed -n 's/\r$//; s/^[[:space:]]*VENDAS_STACK[[:space:]]*=[[:space:]]*//p' "$ARQUIVO_ENV" | tail -1 | tr -d "\"'" || true)"
STACK="${STACK:-vendas}"
[[ "$AMBIENTE" == "dev" && "$STACK" == "vendas" ]] && STACK="vendas-dev"

TAREFAS="$(docker ps -q -f "name=${STACK}_tarefas" | head -1)"
if [[ -z "$TAREFAS" ]]; then
  echo "Serviço ${STACK}_tarefas não está rodando neste nó." >&2
  exit 1
fi

if [[ "${2:-}" == "agora" ]]; then
  QUANDO="$(date +%Y-%m-%d-%H%M)"
  docker exec "$TAREFAS" sh -c "PGPASSWORD=\$(cat /run/secrets/db_password) pg_dump -Fc -f /backups/banco-$QUANDO.dump && tar -czf /backups/fotos-$QUANDO.tar.gz -C /media ."
  echo "Cópia $QUANDO feita."
fi

mkdir -p backups
docker cp "$TAREFAS:/backups/." backups/
ls -lht backups | head -8
