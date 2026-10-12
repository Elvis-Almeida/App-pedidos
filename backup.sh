#!/usr/bin/env bash
# Cópia do banco e das fotos de um ambiente.
#
#   ./backup.sh prod     → backups/vendas-AAAAMMDD-HHMM.sql.gz e ...-media.tar.gz
#
# Para restaurar o banco:
#   gunzip -c backups/ARQUIVO.sql.gz | docker exec -i $(docker ps -q -f name=vendas_banco) psql -U vendas -d vendas

set -euo pipefail
cd "$(dirname "$0")"
AMBIENTE="${1:-prod}"
set -a; . "./.env.$AMBIENTE"; set +a

mkdir -p backups
QUANDO="$(date +%Y%m%d-%H%M)"
BANCO="$(docker ps -q -f "name=${VENDAS_STACK}_banco" | head -1)"
API="$(docker ps -q -f "name=${VENDAS_STACK}_api" | head -1)"

docker exec "$BANCO" pg_dump -U vendas -d vendas --no-owner | gzip > "backups/${VENDAS_STACK}-$QUANDO.sql.gz"
docker exec "$API" tar -czf - -C /app media > "backups/${VENDAS_STACK}-$QUANDO-media.tar.gz"
ls -lh backups/ | tail -2
