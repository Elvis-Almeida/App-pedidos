#!/usr/bin/env bash
# Publica o Vendas Online no Docker Swarm (rode no nó manager).
#
#   ./deploy.sh                 → produção    (lê .env)
#   ./deploy.sh dev             → homologação (lê .env.dev)
#   ./deploy.sh --conferir      → só mostra a configuração final, não publica
#   ./deploy.sh dev --conferir
#
# 1. carrega o .env e mostra os valores que vai usar
# 2. constrói a imagem com uma versão nova (data + commit)
# 3. cria os segredos que ainda não existem (a senha do admin aparece uma vez)
# 4. publica a stack e espera ficar saudável. Ao subir, a API migra o banco
#    sozinha; se algo falhar, o Swarm volta para a versão anterior.

set -euo pipefail
cd "$(dirname "$0")"

AMBIENTE=prod
CONFERIR=0
for arg in "$@"; do
  case "$arg" in
    prod|dev) AMBIENTE="$arg" ;;
    --conferir|-n) CONFERIR=1 ;;
    *) echo "Uso: ./deploy.sh [prod|dev] [--conferir]" >&2; exit 1 ;;
  esac
done

# ---------- 1. configuração ----------

# Carrega NOME=valor de um arquivo .env para o ambiente (exportado).
# Remove o \r de arquivos salvos no Windows, ignora comentários e linhas
# vazias, e não executa nada do arquivo (seguro mesmo com $ ou espaços).
carregar_env() {
  local arquivo="$1" linha nome valor n=0
  while IFS= read -r linha || [[ -n "$linha" ]]; do
    linha="${linha%$'\r'}"
    linha="${linha#"${linha%%[![:space:]]*}"}"   # tira espaços do começo
    [[ -z "$linha" || "$linha" == \#* || "$linha" != *=* ]] && continue
    linha="${linha#export }"
    nome="${linha%%=*}"; nome="${nome%"${nome##*[![:space:]]}"}"
    valor="${linha#*=}"; valor="${valor#"${valor%%[![:space:]]*}"}"; valor="${valor%"${valor##*[![:space:]]}"}"
    if [[ "$valor" =~ ^\"(.*)\"$ || "$valor" =~ ^\'(.*)\'$ ]]; then valor="${BASH_REMATCH[1]}"; fi
    [[ "$nome" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Linha ignorada no $arquivo: $linha" >&2; continue; }
    [[ -z "$valor" ]] && continue                 # vazio = usar o padrão
    export "$nome=$valor"
    n=$((n + 1))
  done < "$arquivo"
  echo "==> $arquivo carregado ($n valores)"
}

if [[ "$AMBIENTE" == "dev" ]]; then
  ARQUIVO_ENV=".env.dev"
else
  ARQUIVO_ENV=".env"
  [[ ! -f .env && -f .env.prod ]] && ARQUIVO_ENV=".env.prod"   # nome antigo
fi

if [[ -f "$ARQUIVO_ENV" ]]; then
  carregar_env "$ARQUIVO_ENV"
elif [[ "$AMBIENTE" == "dev" ]]; then
  echo "Falta o .env.dev. Crie com: cp .env.dev.exemplo .env.dev" >&2
  exit 1
else
  echo "==> Sem .env: usando os padrões de produção (veja .env.exemplo)"
fi

# Padrões (os mesmos do docker-compose.yml)
export VENDAS_STACK="${VENDAS_STACK:-vendas}"
export VENDAS_DOMINIO="${VENDAS_DOMINIO:-vendas.elvisalmeida.com.br}"
export VENDAS_REDE_TRAEFIK="${VENDAS_REDE_TRAEFIK:-crononest}"
export VENDAS_CERTRESOLVER="${VENDAS_CERTRESOLVER:-letsencryptresolver}"
export VENDAS_ENTRYPOINT="${VENDAS_ENTRYPOINT:-websecure}"
export VENDAS_REPLICAS="${VENDAS_REPLICAS:-2}"
export VENDAS_WORKERS="${VENDAS_WORKERS:-2}"
export VENDAS_THREADS="${VENDAS_THREADS:-4}"
export VENDAS_ADMIN_USUARIO="${VENDAS_ADMIN_USUARIO:-elvis}"
export VENDAS_ADMIN_EMAIL="${VENDAS_ADMIN_EMAIL:-contato@elvisalmeida.com.br}"
export VENDAS_BACKUP_DIAS="${VENDAS_BACKUP_DIAS:-30}"

if [[ "$AMBIENTE" == "dev" && "$VENDAS_STACK" == "vendas" ]]; then
  echo "O .env.dev está com VENDAS_STACK=vendas (o nome da produção). Use vendas-dev." >&2
  exit 1
fi

cat <<RESUMO
    stack ............ $VENDAS_STACK
    domínio .......... https://$VENDAS_DOMINIO
    rede do Traefik .. $VENDAS_REDE_TRAEFIK  (certresolver: $VENDAS_CERTRESOLVER, entrypoint: $VENDAS_ENTRYPOINT)
    réplicas ......... $VENDAS_REPLICAS × ($VENDAS_WORKERS workers, $VENDAS_THREADS threads)
    admin ............ $VENDAS_ADMIN_USUARIO <$VENDAS_ADMIN_EMAIL>
    backup ........... $VENDAS_BACKUP_DIAS dias
RESUMO

if [[ "$CONFERIR" == 1 ]]; then
  export VENDAS_TAG="${VENDAS_TAG:-conferencia}"
  echo "==> Como a stack ficaria (docker stack config), sem publicar:"
  docker stack config -c docker-compose.yml | grep -E "^\s+(image|replicas|VENDAS_[A-Z_]+|traefik\.http\.routers\.[^.]+\.rule|traefik\.docker\.network|name):" | sed 's/^/    /'
  exit 0
fi

if ! docker info --format '{{.Swarm.ControlAvailable}}' 2>/dev/null | grep -q true; then
  echo "Rode no nó manager do Swarm." >&2
  exit 1
fi
if ! docker network inspect "$VENDAS_REDE_TRAEFIK" >/dev/null 2>&1; then
  echo "A rede do Traefik \"$VENDAS_REDE_TRAEFIK\" não existe. Ajuste VENDAS_REDE_TRAEFIK no $ARQUIVO_ENV." >&2
  echo "Redes overlay deste servidor:" >&2
  docker network ls --filter driver=overlay --format '    {{.Name}}' >&2
  exit 1
fi

# ---------- 2. imagem ----------
VERSAO="$(date +%Y%m%d-%H%M%S)"
if git rev-parse --short HEAD >/dev/null 2>&1; then
  VERSAO="$VERSAO-$(git rev-parse --short HEAD)"
fi
export VENDAS_TAG="$VERSAO"
echo "==> Construindo vendas-online:$VERSAO"
docker build --pull --build-arg "VERSAO=$VERSAO" -t "vendas-online:$VERSAO" -t vendas-online:latest .

# ---------- 3. segredos ----------
# Usa o valor do .env, se houver; senão gera um aleatório.
criar_segredo() {
  local nome="${VENDAS_STACK}_$1"
  if docker secret inspect "$nome" >/dev/null 2>&1; then
    return 1
  fi
  printf '%s' "$2" | docker secret create "$nome" - >/dev/null
  echo "    segredo $nome criado"
}

echo "==> Conferindo segredos"
criar_segredo secret_key "${VENDAS_SECRET_KEY:-$(openssl rand -base64 48 | tr -d '\n')}" || true
criar_segredo db_password "${VENDAS_DB_PASSWORD:-$(openssl rand -hex 24)}" || true
SENHA_ADMIN="${VENDAS_ADMIN_SENHA:-$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-20)}"
if criar_segredo admin_senha "$SENHA_ADMIN" && [[ -z "${VENDAS_ADMIN_SENHA:-}" ]]; then
  cat <<AVISO

    ┌────────────────────────────────────────────────────────────┐
      Admin:   https://$VENDAS_DOMINIO/admin
      Usuário: $VENDAS_ADMIN_USUARIO
      Senha:   $SENHA_ADMIN
      Guarde agora: ela não aparece de novo.
    └────────────────────────────────────────────────────────────┘

AVISO
fi
# os valores dos segredos não seguem para o docker stack deploy
unset VENDAS_SECRET_KEY VENDAS_DB_PASSWORD VENDAS_ADMIN_SENHA SENHA_ADMIN

# ---------- 4. stack ----------
echo "==> Publicando a stack $VENDAS_STACK"
# --detach=false: espera os serviços convergirem (ou o rollback acontecer)
if ! docker stack deploy --prune --detach=false -c docker-compose.yml "$VENDAS_STACK"; then
  echo "!!  A publicação não convergiu. Veja: docker service logs ${VENDAS_STACK}_api" >&2
  exit 1
fi

IMAGEM_ATUAL="$(docker service inspect "${VENDAS_STACK}_api" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')"
if [[ "$IMAGEM_ATUAL" != vendas-online:"$VERSAO"* ]]; then
  echo "!!  O Swarm voltou para a versão anterior ($IMAGEM_ATUAL)." >&2
  echo "    Veja o motivo: docker service logs --since 10m ${VENDAS_STACK}_api" >&2
  exit 1
fi

echo "==> No ar: vendas-online:$VERSAO"
if curl -fsS --max-time 10 "https://$VENDAS_DOMINIO/healthz" >/dev/null 2>&1; then
  echo "    https://$VENDAS_DOMINIO respondendo."
else
  echo "    (https://$VENDAS_DOMINIO ainda não respondeu: o certificado pode levar"
  echo "     um minuto na primeira vez. Confira o DNS se continuar.)"
fi
