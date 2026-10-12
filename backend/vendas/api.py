"""
API usada pelo app (PWA).

    POST /api/auth/convite/   código de convite → token do aparelho (para sempre)
    GET  /api/estado/?desde=N configuração, cardápio, evento e pedidos que mudaram
    POST /api/sincronizar/    fila de operações feitas no aparelho (offline ou não)

O aparelho se identifica com "Authorization: Bearer <token>". O token não
expira; o admin desconecta o aparelho desmarcando "ativo" (ou a pessoa).
"""

import json
import logging
from datetime import timedelta
from functools import wraps

from django.core.cache import cache
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .models import Convite, Dispositivo, RegistroAlteracao, normalizar_codigo
from .servicos import aplicar_operacoes, montar_estado

log = logging.getLogger(__name__)


def _ip(request):
    # Atrás do Traefik o IP real vem no X-Forwarded-For (o primeiro da lista)
    encaminhado = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (encaminhado.split(",")[0].strip() or request.META.get("REMOTE_ADDR")) or None


def _json(request):
    try:
        return json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        return None


def erro(mensagem, status=400, **extra):
    return JsonResponse({"erro": mensagem, **extra}, status=status)


def com_aparelho(view):
    """Exige um aparelho conectado e ativo; anota último contato."""

    @wraps(view)
    def envolta(request, *args, **kwargs):
        cabecalho = request.META.get("HTTP_AUTHORIZATION", "")
        token = cabecalho[7:] if cabecalho.startswith("Bearer ") else ""
        dispositivo = Dispositivo.pelo_token(token)
        if dispositivo is None:
            return erro("Aparelho desconectado. Peça um novo código de convite.", 401, codigo="desconectado")

        agora = timezone.now()
        versao = request.META.get("HTTP_X_APP_VERSAO", "")[:40]
        if (
            not dispositivo.ultimo_contato
            or agora - dispositivo.ultimo_contato > timedelta(seconds=60)
            or dispositivo.versao_app != versao
        ):
            Dispositivo.objects.filter(pk=dispositivo.pk).update(
                ultimo_contato=agora, ultimo_ip=_ip(request), versao_app=versao
            )
        request.dispositivo = dispositivo
        return view(request, *args, **kwargs)

    return envolta


@csrf_exempt
@require_POST
@never_cache
def conectar_com_convite(request):
    # Limite simples por IP (o Traefik também limita esta rota)
    chave = f"convite:{_ip(request)}"
    tentativas = cache.get(chave, 0)
    if tentativas >= 10:
        return erro("Muitas tentativas. Espere um minuto e tente de novo.", 429)
    cache.set(chave, tentativas + 1, 60)

    dados = _json(request)
    if dados is None:
        return erro("Requisição inválida")
    codigo = normalizar_codigo(dados.get("codigo", ""))
    if not codigo:
        return erro("O código tem 8 letras/números, como ABCD-2345.")

    with transaction.atomic():
        convite = Convite.objects.select_for_update().select_related("pessoa").filter(codigo=codigo).first()
        if convite is None:
            return erro("Código não encontrado. Confira com quem organiza.")
        if not convite.disponivel:
            mensagens = {
                "usado": "Este código já foi usado em outro aparelho. Peça um novo.",
                "revogado": "Este código foi cancelado. Peça um novo.",
                "expirado": "Este código expirou. Peça um novo.",
                "pessoa inativa": "Este código não está mais liberado.",
            }
            return erro(mensagens.get(convite.status, "Código indisponível."))

        dispositivo, token = Dispositivo.criar_para(convite.pessoa, str(dados.get("aparelho", ""))[:120])
        dispositivo.ultimo_contato, dispositivo.ultimo_ip = timezone.now(), _ip(request)
        dispositivo.save(update_fields=["ultimo_contato", "ultimo_ip"])
        convite.usado_em, convite.dispositivo = timezone.now(), dispositivo
        convite.save(update_fields=["usado_em", "dispositivo"])
        RegistroAlteracao.objects.create(
            tipo="aparelho",
            descricao=f"{convite.pessoa} conectou um aparelho ({dispositivo.prefixo})",
            dispositivo=dispositivo,
        )

    log.info("Aparelho %s conectado para %s", dispositivo.prefixo, convite.pessoa)
    return JsonResponse(
        {"token": token, "dispositivo": {"prefixo": dispositivo.prefixo, "pessoa": convite.pessoa.nome}},
        status=201,
    )


@require_GET
@never_cache
@com_aparelho
def estado(request):
    try:
        desde = max(0, int(request.GET.get("desde", 0)))
    except ValueError:
        desde = 0
    return JsonResponse(montar_estado(request.dispositivo, desde))


@csrf_exempt
@require_POST
@never_cache
@com_aparelho
def sincronizar(request):
    dados = _json(request)
    if dados is None or not isinstance(dados.get("operacoes"), list):
        return erro("Requisição inválida")
    resultados = aplicar_operacoes(request.dispositivo, dados["operacoes"])
    return JsonResponse({"resultados": resultados})


@never_cache
def saude(request):
    return JsonResponse({"ok": True})
