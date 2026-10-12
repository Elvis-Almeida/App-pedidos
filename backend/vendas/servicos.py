"""
Regras da sincronização entre aparelhos e servidor.

O aparelho trabalha offline e guarda numa fila tudo o que fez (pedido novo,
devolução, esgotado, Pix…). Quando tem internet, manda a fila inteira para
`aplicar_operacoes`, na ordem em que aconteceu. Cada operação tem um id único,
então reenviar a mesma fila (ex.: a resposta se perdeu no caminho) não duplica
nada.

Depois o aparelho pede `montar_estado(desde=<última revisão vista>)` e recebe a
configuração, o cardápio e os pedidos do evento que mudaram.
"""

import logging
import uuid as uuidlib
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Max, Prefetch
from django.utils import timezone

from .models import (
    Configuracao,
    Devolucao,
    DevolucaoItem,
    Dispositivo,
    Evento,
    Item,
    ItemPedido,
    Pedido,
    RegistroAlteracao,
    revisao_atual,
)
from .pix import erro_configuracao_pix

log = logging.getLogger(__name__)


class ErroOperacao(Exception):
    def __init__(self, codigo, mensagem, pedido=None):
        super().__init__(mensagem)
        self.codigo = codigo
        self.mensagem = mensagem
        self.pedido = pedido


# =============================================================
#  Serialização
# =============================================================


def _url(campo):
    return campo.url if campo else None


def serializar_config(config):
    return {
        "nome_app": config.nome_app,
        "nome_curto": config.nome_curto,
        "logo": _url(config.icone_512) or _url(config.logo),
        "pix": config.pix_publico(),
        "atualizado_por": config.atualizado_por,
    }


def serializar_item(item):
    return {
        "id": item.id,
        "nome": item.nome,
        "preco": item.preco,
        "imagem": _url(item.imagem),
        "ordem": item.ordem,
        "esgotado": item.esgotado,
    }


def _itens_json(itens):
    return [{"item_id": i.item_id, "nome": i.nome, "preco": i.preco, "qtd": i.qtd} for i in itens]


def serializar_pedido(p, dispositivo=None):
    return {
        "uuid": str(p.uuid),
        "evento_id": p.evento_id,
        "codigo": p.codigo,
        "prefixo": p.prefixo,
        "numero": p.numero,
        "pessoa": p.pessoa.nome,
        "dispositivo_id": p.dispositivo_id,
        "meu": dispositivo is not None and p.dispositivo_id == dispositivo.id,
        "criado_em": p.criado_em.isoformat(),
        "forma": p.forma,
        "total": p.total,
        "recebido": p.recebido,
        "troco": p.troco,
        "cancelado": p.cancelado,
        "itens": _itens_json([i for i in p.itens.all() if i.qtd > 0]),
        "devolucoes": [
            {
                "uuid": str(d.uuid),
                "criado_em": d.criado_em.isoformat(),
                "valor": d.valor,
                "itens": _itens_json(d.itens.all()),
            }
            for d in p.devolucoes.all()
        ],
        "rev": p.rev,
    }


def _pedidos_com_detalhes():
    return Pedido.objects.select_related("pessoa").prefetch_related(
        "itens", Prefetch("devolucoes", queryset=Devolucao.objects.prefetch_related("itens"))
    )


# =============================================================
#  Estado (o que o aparelho baixa)
# =============================================================


def montar_estado(dispositivo, desde=0):
    with transaction.atomic():
        evento = Evento.atual()  # pode abrir um evento novo (e mudar a revisão)
    # A revisão é lida ANTES dos dados: se algo mudar no meio, vem de novo na
    # próxima vez (repetido, nunca perdido).
    rev = revisao_atual()
    config = Configuracao.atual()

    pedidos = _pedidos_com_detalhes().filter(evento=evento)
    completo = desde <= 0 or evento.rev > desde
    if not completo:
        pedidos = pedidos.filter(rev__gt=desde)

    ultimo_numero = (
        Pedido.objects.filter(evento=evento, dispositivo=dispositivo).aggregate(m=Max("numero"))["m"] or 0
    )

    return {
        "rev": rev,
        "servidor_agora": timezone.now().isoformat(),
        "completo": completo,
        "dispositivo": {
            "id": dispositivo.id,
            "prefixo": dispositivo.prefixo,
            "pessoa": dispositivo.pessoa.nome,
            "permissoes": dispositivo.permissoes(config),
            "ultimo_numero": ultimo_numero,
        },
        "config": serializar_config(config),
        "itens": [serializar_item(i) for i in Item.objects.filter(ativo=True)],
        "evento": {"id": evento.id, "nome": evento.nome, "inicio": evento.inicio.isoformat()},
        "pedidos": [serializar_pedido(p, dispositivo) for p in pedidos.order_by("criado_em")],
    }


# =============================================================
#  Operações vindas da fila do aparelho
# =============================================================


def _int(valor, minimo=None, padrao=None):
    try:
        n = int(valor)
    except (TypeError, ValueError):
        return padrao
    if minimo is not None and n < minimo:
        return padrao
    return n


def _data(texto):
    try:
        d = datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return timezone.now()
    if timezone.is_naive(d):
        d = timezone.make_aware(d)
    # relógio do aparelho muito adiantado: usa a hora do servidor
    return min(d, timezone.now() + timedelta(minutes=5))


def _uuid(texto):
    try:
        return uuidlib.UUID(str(texto))
    except (TypeError, ValueError):
        raise ErroOperacao("invalido", "Identificador inválido")


def _registrar(tipo, descricao, dispositivo, **extra):
    RegistroAlteracao.objects.create(tipo=tipo, descricao=descricao[:255], dispositivo=dispositivo, **extra)


def _pedido_editavel(dispositivo, perms, uuid_pedido, criados_agora):
    pedido = Pedido.objects.select_for_update().filter(uuid=_uuid(uuid_pedido)).first()
    if pedido is None:
        raise ErroOperacao("nao_encontrado", "Pedido não encontrado no servidor")
    if pedido.dispositivo_id != dispositivo.id:
        raise ErroOperacao("bloqueado", "Só o aparelho que vendeu pode alterar este pedido", pedido)
    if not perms["alterar_pedidos"] and pedido.uuid not in criados_agora:
        raise ErroOperacao("bloqueado", "Alterar pedidos enviados está bloqueado pelo administrador", pedido)
    return pedido


def op_criar_pedido(dispositivo, op, ctx):
    uuid_pedido = _uuid(op.get("uuid"))
    existente = Pedido.objects.filter(uuid=uuid_pedido).first()
    if existente:
        return existente  # reenvio: já está aqui

    itens = []
    for bruto in op.get("itens") or []:
        qtd = _int(bruto.get("qtd"), 1)
        preco = _int(bruto.get("preco"), 0)
        nome = str(bruto.get("nome") or "").strip()[:30]
        if not qtd or preco is None or not nome:
            raise ErroOperacao("invalido", "Item do pedido inválido")
        itens.append((_int(bruto.get("item_id")), nome, preco, qtd))
    if not itens:
        raise ErroOperacao("invalido", "Pedido sem itens")

    evento = Evento.objects.filter(pk=_int(op.get("evento_id"))).first() or Evento.atual()
    total = sum(preco * qtd for _, _, preco, qtd in itens)
    forma = op.get("forma") if op.get("forma") in Pedido.FORMAS else "dinheiro"
    recebido = _int(op.get("recebido"), 0) if forma == "dinheiro" else None
    recebido = recebido or None

    numero = _int(op.get("numero"), 1)
    ocupados = Pedido.objects.filter(evento=evento, dispositivo=dispositivo)
    if not numero or ocupados.filter(numero=numero).exists():
        numero = (ocupados.aggregate(m=Max("numero"))["m"] or 0) + 1

    pedido = Pedido(
        uuid=uuid_pedido,
        evento=evento,
        dispositivo=dispositivo,
        pessoa=dispositivo.pessoa,
        prefixo=dispositivo.prefixo,
        numero=numero,
        criado_em=_data(op.get("criado_em")),
        forma=forma,
        total=total,
        total_original=total,
        recebido=recebido,
        troco=(recebido - total) if recebido else None,
    )
    pedido.save()
    ids_validos = set(Item.objects.filter(pk__in=[i for i, *_ in itens if i]).values_list("pk", flat=True))
    ItemPedido.objects.bulk_create(
        ItemPedido(
            pedido=pedido,
            item_id=item_id if item_id in ids_validos else None,
            nome=nome,
            preco=preco,
            qtd=qtd,
            qtd_original=qtd,
        )
        for item_id, nome, preco, qtd in itens
    )
    ctx["criados"].add(pedido.uuid)
    return pedido


def op_devolver(dispositivo, op, ctx):
    uuid_dev = _uuid(op.get("uuid"))
    if Devolucao.objects.filter(uuid=uuid_dev).exists():
        return Pedido.objects.get(devolucoes__uuid=uuid_dev)

    pedido = _pedido_editavel(dispositivo, ctx["perms"], op.get("pedido_uuid"), ctx["criados"])
    if pedido.cancelado:
        raise ErroOperacao("invalido", "Pedido já cancelado", pedido)

    linhas = list(pedido.itens.all())
    devolvidos = []
    for bruto in op.get("itens") or []:
        qtd = _int(bruto.get("qtd"), 1)
        if not qtd:
            continue
        item_id, nome = _int(bruto.get("item_id")), str(bruto.get("nome") or "")
        linha = next((l for l in linhas if item_id and l.item_id == item_id), None) or next(
            (l for l in linhas if l.nome == nome), None
        )
        if linha is None or qtd > linha.qtd:
            raise ErroOperacao("invalido", f"Não dá para devolver {qtd}× {nome}", pedido)
        devolvidos.append((linha, qtd))
    if not devolvidos:
        raise ErroOperacao("invalido", "Nenhum item para devolver", pedido)

    valor = sum(linha.preco * qtd for linha, qtd in devolvidos)
    dev = Devolucao.objects.create(
        uuid=uuid_dev, pedido=pedido, dispositivo=dispositivo, criado_em=_data(op.get("criado_em")), valor=valor
    )
    for linha, qtd in devolvidos:
        linha.qtd -= qtd
        linha.save(update_fields=["qtd"])
        DevolucaoItem.objects.create(devolucao=dev, item_id=linha.item_id, nome=linha.nome, preco=linha.preco, qtd=qtd)

    pedido.total = max(0, pedido.total - valor)
    if all(l.qtd == 0 for l in linhas):
        pedido.cancelado_em = dev.criado_em
        pedido.cancelado_por = f"devolução total ({dispositivo.prefixo})"
    pedido.save()
    _registrar(
        "devolucao",
        f"Devolução no pedido #{pedido.codigo}: " + ", ".join(f"{q}× {l.nome}" for l, q in devolvidos),
        dispositivo,
        pedido=pedido,
        evento=pedido.evento,
        dados={"valor": valor},
    )
    return pedido


def op_desfazer_devolucao(dispositivo, op, ctx):
    dev = Devolucao.objects.filter(uuid=_uuid(op.get("devolucao_uuid"))).select_related("pedido").first()
    if dev is None:
        return None  # já desfeita
    pedido = _pedido_editavel(dispositivo, ctx["perms"], dev.pedido_id, ctx["criados"])
    linhas = {(l.item_id, l.nome): l for l in pedido.itens.all()}
    for d in dev.itens.all():
        linha = linhas.get((d.item_id, d.nome)) or next(l for l in linhas.values() if l.nome == d.nome)
        linha.qtd += d.qtd
        linha.save(update_fields=["qtd"])
    pedido.total += dev.valor
    if pedido.cancelado_por.startswith("devolução total"):
        pedido.cancelado_em, pedido.cancelado_por = None, ""
    dev.delete()
    pedido.save()
    return pedido


def op_cancelar_pedido(dispositivo, op, ctx):
    pedido = _pedido_editavel(dispositivo, ctx["perms"], op.get("pedido_uuid"), ctx["criados"])
    if not pedido.cancelado:
        pedido.cancelado_em = _data(op.get("criado_em"))
        pedido.cancelado_por = f"{dispositivo.pessoa} ({dispositivo.prefixo})"
        pedido.save()
        _registrar(
            "cancelamento",
            f"Pedido #{pedido.codigo} cancelado ({pedido.total / 100:.2f})".replace(".", ","),
            dispositivo,
            pedido=pedido,
            evento=pedido.evento,
        )
    return pedido


def op_restaurar_pedido(dispositivo, op, ctx):
    pedido = _pedido_editavel(dispositivo, ctx["perms"], op.get("pedido_uuid"), ctx["criados"])
    if pedido.cancelado and pedido.total > 0:
        pedido.cancelado_em, pedido.cancelado_por = None, ""
        pedido.save()
    return pedido


def op_item_esgotado(dispositivo, op, ctx):
    if not ctx["perms"]["editar_itens"]:
        raise ErroOperacao("bloqueado", "Marcar esgotados está bloqueado pelo administrador")
    item = Item.objects.select_for_update().filter(pk=_int(op.get("item_id")), ativo=True).first()
    if item is None:
        raise ErroOperacao("nao_encontrado", "Item não existe mais no cardápio")
    esgotado = bool(op.get("esgotado"))
    if item.esgotado != esgotado:
        item.esgotado = esgotado
        item.save()
        _registrar(
            "esgotado",
            f"{item.nome} {'esgotou' if esgotado else 'voltou a ter'}",
            dispositivo,
            item=item,
            evento=Evento.objects.filter(ativo=True).first(),
            dados={"esgotado": esgotado},
        )
    return None


def op_pix(dispositivo, op, ctx):
    if not ctx["perms"]["editar_pix"]:
        raise ErroOperacao("bloqueado", "Mudar o Pix está bloqueado pelo administrador")
    dados = op.get("pix") or {}
    config = Configuracao.atual()
    novo = {
        "pix_ativo": bool(dados.get("ativo")),
        "pix_tipo": dados.get("tipo") if dados.get("tipo") in dict(Configuracao._meta.get_field("pix_tipo").choices) else "cpf",
        "pix_chave": str(dados.get("chave") or "")[:80],
        "pix_nome": str(dados.get("nome") or "")[:25],
        "pix_cidade": str(dados.get("cidade") or "")[:15],
    }
    if novo["pix_ativo"]:
        erro = erro_configuracao_pix(novo["pix_tipo"], novo["pix_chave"], novo["pix_nome"])
        if erro:
            raise ErroOperacao("invalido", erro)
    if any(getattr(config, k) != v for k, v in novo.items()):
        for k, v in novo.items():
            setattr(config, k, v)
        config.atualizado_por = f"{dispositivo.pessoa} ({dispositivo.prefixo})"
        config.save()
        _registrar(
            "pix",
            f"Pix {'ligado' if novo['pix_ativo'] else 'desligado'} · chave {novo['pix_chave'] or '—'}",
            dispositivo,
            dados=novo,
        )
    return None


OPERACOES = {
    "criar_pedido": op_criar_pedido,
    "devolver": op_devolver,
    "desfazer_devolucao": op_desfazer_devolucao,
    "cancelar_pedido": op_cancelar_pedido,
    "restaurar_pedido": op_restaurar_pedido,
    "item_esgotado": op_item_esgotado,
    "pix": op_pix,
}

MAX_OPERACOES = 500


def aplicar_operacoes(dispositivo, operacoes):
    """Aplica a fila na ordem. Uma operação recusada não impede as outras."""
    ctx = {"perms": dispositivo.permissoes(), "criados": set()}
    resultados = []
    for op in operacoes[:MAX_OPERACOES]:
        resultado = {"id": op.get("id")}
        funcao = OPERACOES.get(op.get("tipo"))
        try:
            if funcao is None:
                raise ErroOperacao("invalido", "Operação desconhecida")
            with transaction.atomic():
                pedido = funcao(dispositivo, op, ctx)
            resultado["ok"] = True
            if pedido is not None:
                pedido = _pedidos_com_detalhes().get(pk=pedido.pk)
                resultado["pedido"] = serializar_pedido(pedido, dispositivo)
        except ErroOperacao as erro:
            resultado.update(ok=False, codigo=erro.codigo, erro=erro.mensagem)
            if erro.codigo == "bloqueado":
                # fora da transação desfeita, senão o registro some junto
                alvo = f" no pedido #{erro.pedido.codigo}" if erro.pedido is not None else ""
                _registrar(
                    "bloqueado",
                    f"Tentativa bloqueada ({op.get('tipo')}){alvo}: {erro.mensagem}",
                    dispositivo,
                    pedido=erro.pedido,
                    evento=erro.pedido.evento if erro.pedido is not None else None,
                )
            if erro.pedido is not None:
                atual = _pedidos_com_detalhes().get(pk=erro.pedido.pk)
                resultado["pedido"] = serializar_pedido(atual, dispositivo)
        except IntegrityError:
            log.exception("Conflito ao aplicar operação %s", op.get("tipo"))
            resultado.update(ok=False, codigo="conflito", erro="Conflito ao salvar; tente de novo")
        resultados.append(resultado)
    return resultados
