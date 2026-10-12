"""
Páginas do app (PWA): a página principal, o manifest e o service worker.

O nome, o logo e o favicon vêm da Configuração (admin). O service worker leva a
VERSAO do deploy: publicou de novo, os aparelhos baixam o app atualizado.
"""

import posixpath
from pathlib import Path

from django.conf import settings
from django.http import Http404, JsonResponse
from django.shortcuts import render
from django.templatetags.static import static
from django.views.decorators.cache import cache_control, never_cache
from django.views.static import serve

from .models import Configuracao

# Arquivos do app guardados para funcionar offline
ARQUIVOS_APP = [
    "app/css/style.css",
    "app/script/app.js",
    "app/script/api.js",
    "app/script/conectar.js",
    "app/script/db.js",
    "app/script/dinheiro.js",
    "app/script/loja.js",
    "app/script/menu.js",
    "app/script/pix.js",
    "app/script/relatorio.js",
    "app/script/ui.js",
    "app/script/vendor/qrcode.js",
    "app/fonts/nunito-latin-400-normal.woff2",
    "app/fonts/nunito-latin-600-normal.woff2",
    "app/fonts/nunito-latin-700-normal.woff2",
    "app/fonts/nunito-latin-800-normal.woff2",
    "app/images/icone-padrao-192.png",
    "app/images/icone-padrao-512.png",
]


def _icones(config):
    """URLs dos ícones: os gerados do logo ou os padrão."""
    return {
        "192": config.icone_192.url if config.icone_192 else static("app/images/icone-padrao-192.png"),
        "512": config.icone_512.url if config.icone_512 else static("app/images/icone-padrao-512.png"),
        "maskable": config.icone_maskable.url if config.icone_maskable else None,
        "apple": config.icone_apple.url if config.icone_apple else static("app/images/icone-padrao-192.png"),
        "favicon": config.favicon_png.url if config.favicon_png else static("app/images/icone-padrao-192.png"),
    }


@never_cache
def index(request):
    config = Configuracao.atual()
    return render(
        request,
        "vendas/index.html",
        {"config": config, "icones": _icones(config), "versao": settings.VERSAO, "debug": settings.DEBUG},
    )


@never_cache
def manifest(request):
    config = Configuracao.atual()
    icones = _icones(config)
    lista = [
        {"src": icones["192"], "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": icones["512"], "sizes": "512x512", "type": "image/png", "purpose": "any"},
    ]
    if icones["maskable"]:
        lista.append({"src": icones["maskable"], "sizes": "512x512", "type": "image/png", "purpose": "maskable"})
    dados = {
        "id": "/",
        "name": config.nome_app,
        "short_name": config.nome_curto or config.nome_app,
        "description": "Pedidos e troco para vendas em eventos",
        "lang": "pt-BR",
        "start_url": "/",
        "scope": "/",
        "display": "fullscreen",
        "orientation": "portrait-primary",
        "background_color": "#0d1018",
        "theme_color": "#0d1018",
        "icons": lista,
    }
    resposta = JsonResponse(dados, json_dumps_params={"ensure_ascii": False})
    resposta["Content-Type"] = "application/manifest+json"
    return resposta


@never_cache
def service_worker(request):
    arquivos = ["/", *[static(a) for a in ARQUIVOS_APP]]
    resposta = render(
        request,
        "vendas/sw.js",
        {"versao": settings.VERSAO, "arquivos": arquivos, "debug": settings.DEBUG},
        content_type="application/javascript",
    )
    # o service worker pode controlar o site todo, mesmo servido da raiz
    resposta["Service-Worker-Allowed"] = "/"
    return resposta


@cache_control(public=True, max_age=31536000, immutable=True)
def media(request, caminho):
    """Serve logo, favicon e fotos dos itens. Os nomes mudam quando o conteúdo
    muda (têm hash), então o navegador pode guardar para sempre."""
    caminho = posixpath.normpath(caminho).lstrip("/")
    if caminho.startswith("..") or not (caminho.startswith("itens/") or caminho.startswith("marca/")):
        raise Http404
    if not (Path(settings.MEDIA_ROOT) / caminho).is_file():
        raise Http404
    return serve(request, caminho, document_root=settings.MEDIA_ROOT)
