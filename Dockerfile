# Vendas Online — imagem única para desenvolvimento e produção.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VENDAS_MEDIA_ROOT=/app/media

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ .
COPY docker/gunicorn.conf.py docker/entrypoint.sh /app/

# Arquivos estáticos entram na imagem (servidos pelo WhiteNoise)
RUN VENDAS_SECRET_KEY=build-apenas VENDAS_DEBUG=0 python manage.py collectstatic --noinput -v 0 \
    && rm -f dev.sqlite3 \
    && useradd --uid 1000 --create-home --home-dir /home/vendas vendas \
    && mkdir -p /app/media \
    && chown -R vendas:vendas /app/media

# Versão publicada: vai para o service worker (atualiza os aparelhos)
ARG VERSAO=dev
ENV VENDAS_VERSAO=${VERSAO}

USER vendas
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/healthz',headers={'Host':(os.environ.get('VENDAS_HOSTS','localhost').split(',')[0])}),timeout=4)"

ENTRYPOINT ["/app/entrypoint.sh"]
