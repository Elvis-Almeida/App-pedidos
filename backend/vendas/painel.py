"""
Admin com o visual do app: a página inicial é o dashboard.
"""

import csv

from django.contrib import admin
from django.db.models import Count, Q
from django.http import StreamingHttpResponse
from django.template.response import TemplateResponse
from django.urls import path
from django.utils import timezone

ONLINE_SEGUNDOS = 120


class _Eco:
    def write(self, valor):
        return valor


class PainelAdminSite(admin.AdminSite):
    site_header = "Vendas"
    site_title = "Vendas"
    index_title = "Dashboard"
    enable_nav_sidebar = True

    def each_context(self, request):
        contexto = super().each_context(request)
        from .models import Configuracao

        config = Configuracao.atual()
        contexto["site_header"] = config.nome_app
        contexto["site_title"] = config.nome_app
        return contexto

    def get_urls(self):
        extras = [path("exportar.csv", self.admin_view(self.exportar), name="exportar")]
        return extras + super().get_urls()

    @staticmethod
    def _filtros(request):
        def inteiro(nome):
            try:
                return int(request.GET.get(nome) or 0) or None
            except ValueError:
                return None

        return inteiro("evento"), inteiro("pessoa")

    def index(self, request, extra_context=None):
        from .analise import analisar
        from .models import Dispositivo, Evento, Item, Pessoa

        evento_id, pessoa_id = self._filtros(request)
        if request.GET.get("evento") is None:
            # sem filtro na URL: abre no evento atual (se tiver vendas), senão em todos
            atual = Evento.objects.filter(ativo=True).first()
            if atual and atual.pedidos.exists():
                evento_id = atual.id

        agora = timezone.now()
        aparelhos = list(
            Dispositivo.objects.filter(ativo=True)
            .select_related("pessoa")
            .order_by("-ultimo_contato")
        )
        online = [d for d in aparelhos if d.ultimo_contato and (agora - d.ultimo_contato).total_seconds() < ONLINE_SEGUNDOS]

        contexto = {
            **self.each_context(request),
            "title": "Dashboard",
            "subtitle": None,
            "app_list": self.get_app_list(request),
            "dados": analisar(evento_id, pessoa_id),
            "eventos": Evento.objects.annotate(n=Count("pedidos", filter=Q(pedidos__cancelado_em__isnull=True))),
            "pessoas": Pessoa.objects.order_by("nome"),
            "evento_id": evento_id,
            "pessoa_id": pessoa_id,
            "evento_sel": Evento.objects.filter(pk=evento_id).first() if evento_id else None,
            "aparelhos_online": online,
            "n_aparelhos": len(aparelhos),
            "n_itens": Item.objects.filter(ativo=True).count(),
            "n_esgotados": Item.objects.filter(ativo=True, esgotado=True).count(),
            **(extra_context or {}),
        }
        request.current_app = self.name
        return TemplateResponse(request, "admin/index.html", contexto)

    def exportar(self, request):
        """CSV com uma linha por item vendido (abre direto no Excel/Sheets)."""
        from .models import ItemPedido

        evento_id, pessoa_id = self._filtros(request)
        linhas = ItemPedido.objects.select_related("pedido__evento", "pedido__pessoa").order_by("pedido__criado_em")
        if evento_id:
            linhas = linhas.filter(pedido__evento_id=evento_id)
        if pessoa_id:
            linhas = linhas.filter(pedido__pessoa_id=pessoa_id)

        def gerar():
            escritor = csv.writer(_Eco(), delimiter=";")
            yield "﻿"
            yield escritor.writerow(
                ["evento", "pedido", "data", "hora", "pessoa", "pagamento", "item", "preco", "qtd_vendida",
                 "qtd_final", "subtotal", "total_pedido", "recebido", "troco", "cancelado"]
            )
            for l in linhas.iterator(chunk_size=2000):
                p = l.pedido
                quando = timezone.localtime(p.criado_em)
                dinheiro = lambda c: "" if c is None else f"{c / 100:.2f}".replace(".", ",")  # noqa: E731
                yield escritor.writerow(
                    [p.evento.nome, p.codigo, quando.strftime("%d/%m/%Y"), quando.strftime("%H:%M:%S"), p.pessoa.nome,
                     p.forma, l.nome, dinheiro(l.preco), l.qtd_original, l.qtd, dinheiro(l.preco * l.qtd),
                     dinheiro(p.total), dinheiro(p.recebido), dinheiro(p.troco), "sim" if p.cancelado else "não"]
                )

        resposta = StreamingHttpResponse(gerar(), content_type="text/csv; charset=utf-8")
        resposta["Content-Disposition"] = f'attachment; filename="vendas-{timezone.localdate():%Y-%m-%d}.csv"'
        return resposta
