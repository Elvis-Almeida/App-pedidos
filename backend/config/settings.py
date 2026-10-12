"""
Configurações do Vendas Online.

Tudo que muda entre desenvolvimento e produção vem de variáveis de ambiente
VENDAS_*. Segredos podem vir como arquivo (VENDAS_SECRET_KEY_FILE,
VENDAS_DB_PASSWORD_FILE): variável aparece em `docker inspect`, arquivo não.
"""

import os
from pathlib import Path

from django.utils.csp import CSP

BASE_DIR = Path(__file__).resolve().parent.parent


def carregar_arquivo_env(caminho):
    """Lê um arquivo .env simples (NOME=valor) para o ambiente.

    Não sobrescreve o que já veio do terminal ou do Docker, ignora linhas
    em branco/comentários e valores vazios, e aceita arquivo salvo no Windows.
    """
    if not caminho.is_file():
        return
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.removeprefix("export ").split("=", 1)
        nome, valor = nome.strip(), valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        if nome and valor:
            os.environ.setdefault(nome, valor)


# backend/.env (para rodar sem Docker). No container não existe: lá tudo vem
# das variáveis do docker-compose.
carregar_arquivo_env(BASE_DIR / ".env")


def env(nome, padrao=None):
    """Lê VENDAS_<nome>; se existir VENDAS_<nome>_FILE, lê o conteúdo do arquivo."""
    arquivo = os.environ.get(f"VENDAS_{nome}_FILE")
    if arquivo:
        return Path(arquivo).read_text().strip()
    return os.environ.get(f"VENDAS_{nome}") or padrao


def env_lista(nome, padrao=""):
    return [v.strip() for v in (env(nome, padrao) or "").split(",") if v.strip()]


DEBUG = env("DEBUG", "0") == "1"

SECRET_KEY = env("SECRET_KEY") or ("dev-inseguro-nao-use-em-producao" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("Defina VENDAS_SECRET_KEY ou VENDAS_SECRET_KEY_FILE")

ALLOWED_HOSTS = env_lista("HOSTS", "localhost,127.0.0.1" if DEBUG else "")
CSRF_TRUSTED_ORIGINS = env_lista("CSRF", "")

# Versão publicada (o deploy.sh usa o commit/data). Entra no service worker:
# mudou a versão, os aparelhos baixam o app de novo.
VERSAO = env("VERSAO", "dev")

INSTALLED_APPS = [
    "vendas.apps.PainelAdminConfig",  # admin com o visual do app + dashboard
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "vendas.apps.VendasConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "django.template.context_processors.csp",
                "vendas.contexto.marca",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------- Banco ----------
# Sem VENDAS_DB_HOST, usa SQLite (útil para mexer rápido no código).
if env("DB_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("DB_NAME", "vendas"),
            "USER": env("DB_USER", "vendas"),
            "PASSWORD": env("DB_PASSWORD", ""),
            "HOST": env("DB_HOST"),
            "PORT": env("DB_PORT", "5432"),
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "dev.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

# ---------- Arquivos ----------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]

# Logo, favicon e fotos dos lanches enviados pelo admin
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
WHITENOISE_MAX_AGE = 60 if not DEBUG else 0

DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# ---------- Cache (limite de tentativas do convite) ----------
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# ---------- Segurança ----------
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = 60 * 60 * 12
CSRF_COOKIE_HTTPONLY = True
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

if not DEBUG:
    # O Traefik termina o HTTPS e repassa em HTTP; este cabeçalho diz ao Django
    # que a conexão original era segura.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # HSTS e o redirecionamento para HTTPS ficam no Traefik (stack.yml)
    SILENCED_SYSTEM_CHECKS = ["security.W004", "security.W008"]

SECURE_CSP = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF],
    "style-src": [CSP.SELF, CSP.UNSAFE_INLINE],
    "img-src": [CSP.SELF, "data:", "blob:"],
    "font-src": [CSP.SELF],
    "connect-src": [CSP.SELF],
    "manifest-src": [CSP.SELF],
    "worker-src": [CSP.SELF],
    "frame-ancestors": [CSP.NONE],
    "base-uri": [CSP.SELF],
    "form-action": [CSP.SELF],
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simples": {"format": "{asctime} {levelname} {name}: {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simples"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {"django.request": {"level": "WARNING"}},
}
