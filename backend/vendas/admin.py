"""
Admin (com o visual do app). O dashboard fica em painel.py.
"""

from decimal import ROUND_HALF_UP, Decimal

import segno
from django import forms
from django.contrib import admin, messages
from django.db.models import Count, Max, Q, Sum
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

from .models import (
    Configuracao,
    Convite,
    Devolucao,
    Dispositivo,
    Evento,
    Item,
    ItemPedido,
    Pedido,
    Pessoa,
    RegistroAlteracao,
)


def reais(centavos):
    if centavos is None:
        return "—"
    texto = f"{centavos / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {texto}"


def link_convite(request, convite):
    return request.build_absolute_uri(f"/?convite={convite.codigo}")


def qr_svg(texto, escala=5):
    return segno.make(texto, error="m").svg_inline(scale=escala, dark="#0d1018", light="#ffffff", border=2)


ONLINE_SEGUNDOS = 120


def esta_online(dispositivo):
    return bool(dispositivo.ultimo_contato and (timezone.now() - dispositivo.ultimo_contato).total_seconds() < ONLINE_SEGUNDOS)


# =============================================================
#  Configuração (uma linha só)
# =============================================================


@admin.register(Configuracao)
class ConfiguracaoAdmin(admin.ModelAdmin):
    fieldsets = [
        ("Marca do app", {"fields": ["nome_app", "nome_curto", "logo", "favicon", "previa_icones"]}),
        (
            "Pix",
            {
                "fields": ["pix_ativo", "pix_tipo", "pix_chave", "pix_nome", "pix_cidade", "previa_pix"],
                "description": "Vale para todos os aparelhos. O QR é gerado no próprio celular, mesmo sem internet.",
            },
        ),
        (
            "Bloqueios para os aparelhos",
            {
                "fields": ["bloquear_edicao_itens", "bloquear_edicao_pix", "bloquear_alteracao_pedidos"],
                "description": "Valem para todos. Para liberar ou travar um aparelho específico, use a tela Aparelhos.",
            },
        ),
        ("Histórico", {"fields": ["atualizado_em", "atualizado_por"]}),
    ]
    readonly_fields = ["previa_icones", "previa_pix", "atualizado_em", "atualizado_por"]

    def has_add_permission(self, request):
        return not Configuracao.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        config = Configuracao.atual()
        return HttpResponseRedirect(reverse("admin:vendas_configuracao_change", args=[config.pk]))

    @admin.display(description="Ícones gerados")
    def previa_icones(self, obj):
        if not obj.icone_192:
            return "Envie um logo para gerar os ícones do app (celular, aba do navegador)."
        return format_html(
            '<div class="previaIcones"><figure><img src="{}" alt=""><figcaption>App</figcaption></figure>'
            '<figure><img src="{}" alt="" class="redondo"><figcaption>Android</figcaption></figure>'
            '<figure><img src="{}" alt="" class="arredondado"><figcaption>iPhone</figcaption></figure>'
            '<figure><img src="{}" alt="" class="mini"><figcaption>Aba</figcaption></figure></div>',
            obj.icone_512.url,
            obj.icone_maskable.url,
            obj.icone_apple.url,
            obj.favicon_png.url if obj.favicon_png else obj.icone_192.url,
        )

    @admin.display(description="Teste")
    def previa_pix(self, obj):
        from .pix import erro_configuracao_pix

        erro = erro_configuracao_pix(obj.pix_tipo, obj.pix_chave, obj.pix_nome)
        if erro:
            return format_html('<span class="aviso">{}</span>', erro)
        return "Chave válida. Use o QR de teste de R$ 1,00 no menu do app (aba Pix) para conferir no banco."

    def save_model(self, request, obj, form, change):
        obj.atualizado_por = f"admin: {request.user.get_username()}"
        super().save_model(request, obj, form, change)
        mudou_pix = [c for c in form.changed_data if c.startswith("pix_")]
        if mudou_pix:
            RegistroAlteracao.objects.create(
                tipo="pix",
                descricao=f"Pix alterado no admin ({', '.join(mudou_pix)})",
                usuario=request.user,
                dados=obj.pix_publico(),
            )


# =============================================================
#  Cardápio
# =============================================================


class ItemForm(forms.ModelForm):
    preco_reais = forms.DecimalField(
        label="Preço (R$)", max_digits=8, decimal_places=2, min_value=Decimal("0"), help_text="Ex.: 5 ou 3,50"
    )

    class Meta:
        model = Item
        fields = ["nome", "preco_reais", "imagem", "ordem", "ativo", "esgotado"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields["preco_reais"].initial = Decimal(self.instance.preco) / 100

    def save(self, commit=True):
        valor = self.cleaned_data["preco_reais"] * 100
        self.instance.preco = int(valor.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        return super().save(commit)


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    form = ItemForm
    list_display = ["miniatura", "nome", "preco_formatado", "ativo", "esgotado", "ordem", "vendidos_evento"]
    list_display_links = ["miniatura", "nome"]
    list_editable = ["ativo", "esgotado", "ordem"]
    list_filter = ["ativo", "esgotado"]
    search_fields = ["nome"]
    readonly_fields = ["previa"]
    fields = ["nome", "preco_reais", "imagem", "previa", "ordem", "ativo", "esgotado"]

    @admin.display(description="")
    def miniatura(self, obj):
        if obj.imagem:
            return format_html('<img class="miniatura" src="{}" alt="">', obj.imagem.url)
        return format_html('<span class="miniatura vazia">{}</span>', obj.nome[:1])

    @admin.display(description="Prévia")
    def previa(self, obj):
        if not obj.imagem:
            return "Sem foto. Envie uma imagem (será convertida para WebP de até 512 px)."
        return format_html('<img class="previaItem" src="{}" alt="">', obj.imagem.url)

    @admin.display(description="Preço", ordering="preco")
    def preco_formatado(self, obj):
        return reais(obj.preco)

    @admin.display(description="Vendidos no evento atual")
    def vendidos_evento(self, obj):
        return getattr(obj, "_vendidos", None) or "—"

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        evento = Evento.objects.filter(ativo=True).first()
        if evento:
            qs = qs.annotate(
                _vendidos=Sum(
                    "vendas__qtd", filter=Q(vendas__pedido__evento=evento, vendas__pedido__cancelado_em__isnull=True)
                )
            )
        return qs

    def save_model(self, request, obj, form, change):
        antes = Item.objects.filter(pk=obj.pk).values_list("esgotado", flat=True).first() if change else None
        super().save_model(request, obj, form, change)
        if change and antes is not None and antes != obj.esgotado:
            RegistroAlteracao.objects.create(
                tipo="esgotado",
                descricao=f"{obj.nome} {'esgotou' if obj.esgotado else 'voltou a ter'} (admin)",
                usuario=request.user,
                item=obj,
                evento=Evento.objects.filter(ativo=True).first(),
                dados={"esgotado": obj.esgotado},
            )


# =============================================================
#  Eventos
# =============================================================


@admin.register(Evento)
class EventoAdmin(admin.ModelAdmin):
    list_display = ["nome", "inicio", "fim", "ativo", "n_pedidos", "arrecadado", "ver_dashboard"]
    list_filter = ["ativo"]
    search_fields = ["nome"]
    actions = ["tornar_atual", "encerrar"]
    fields = ["nome", "inicio", "fim", "ativo", "observacoes"]

    def get_queryset(self, request):
        validos = Q(pedidos__cancelado_em__isnull=True)
        return super().get_queryset(request).annotate(
            _n=Count("pedidos", filter=validos), _total=Sum("pedidos__total", filter=validos)
        )

    @admin.display(description="Pedidos", ordering="_n")
    def n_pedidos(self, obj):
        return obj._n

    @admin.display(description="Arrecadado", ordering="_total")
    def arrecadado(self, obj):
        return reais(obj._total or 0)

    @admin.display(description="")
    def ver_dashboard(self, obj):
        return format_html('<a class="botaoLinha" href="{}?evento={}">Dashboard</a>', reverse("admin:index"), obj.pk)

    @admin.action(description="Tornar o evento atual (os aparelhos passam a vender nele)")
    def tornar_atual(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(request, "Escolha um evento só.", messages.WARNING)
            return
        evento = queryset.first()
        evento.ativo, evento.fim = True, None
        evento.save()
        self.message_user(request, f"“{evento}” agora é o evento atual. Os aparelhos mudam na próxima sincronização.")

    @admin.action(description="Encerrar evento")
    def encerrar(self, request, queryset):
        for evento in queryset:
            evento.ativo = False
            evento.fim = evento.fim or timezone.now()
            evento.save()
        self.message_user(request, "Encerrado. Se os aparelhos venderem de novo, um evento novo é aberto com a data do dia.")


# =============================================================
#  Pessoas, convites e aparelhos
# =============================================================


class ConviteInline(admin.TabularInline):
    model = Convite
    extra = 0
    fields = ["codigo", "status_convite", "criado_em", "expira_em", "usado_em", "revogado"]
    readonly_fields = ["codigo", "status_convite", "criado_em", "usado_em"]
    show_change_link = True

    @admin.display(description="Situação")
    def status_convite(self, obj):
        return obj.status if obj.pk else "—"


class DispositivoInline(admin.TabularInline):
    model = Dispositivo
    extra = 0
    can_delete = False
    fields = ["prefixo", "nome", "situacao", "ultimo_contato", "ativo", "pode_editar_itens", "pode_editar_pix", "pode_alterar_pedidos"]
    readonly_fields = ["prefixo", "nome", "situacao", "ultimo_contato"]
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return False

    @admin.display(description="Agora")
    def situacao(self, obj):
        return format_html('<span class="selo {}">{}</span>', *(("ok", "online") if esta_online(obj) else ("off", "offline")))


@admin.register(Pessoa)
class PessoaAdmin(admin.ModelAdmin):
    list_display = ["nome", "ativa", "aparelhos", "convites_livres", "n_pedidos", "total_vendido", "ultima_venda"]
    list_filter = ["ativa"]
    search_fields = ["nome", "telefone"]
    inlines = [ConviteInline, DispositivoInline]
    actions = ["gerar_convite"]
    fields = ["nome", "telefone", "ativa", "observacoes"]

    def get_queryset(self, request):
        validos = Q(pedidos__cancelado_em__isnull=True)
        return super().get_queryset(request).annotate(
            _aparelhos=Count("dispositivos", filter=Q(dispositivos__ativo=True), distinct=True),
            _livres=Count(
                "convites",
                filter=Q(convites__usado_em__isnull=True, convites__revogado=False)
                & (Q(convites__expira_em__isnull=True) | Q(convites__expira_em__gt=timezone.now())),
                distinct=True,
            ),
            _n=Count("pedidos", filter=validos, distinct=True),
            _total=Sum("pedidos__total", filter=validos),
            _ultima=Max("pedidos__criado_em"),
        )

    @admin.display(description="Aparelhos", ordering="_aparelhos")
    def aparelhos(self, obj):
        return obj._aparelhos

    @admin.display(description="Convites livres", ordering="_livres")
    def convites_livres(self, obj):
        return obj._livres

    @admin.display(description="Pedidos", ordering="_n")
    def n_pedidos(self, obj):
        return obj._n

    @admin.display(description="Total vendido", ordering="_total")
    def total_vendido(self, obj):
        return reais(obj._total or 0)

    @admin.display(description="Última venda", ordering="_ultima")
    def ultima_venda(self, obj):
        return timezone.localtime(obj._ultima).strftime("%d/%m %H:%M") if obj._ultima else "—"

    @admin.action(description="Gerar código de convite")
    def gerar_convite(self, request, queryset):
        criados = [Convite.objects.create(pessoa=p, criado_por=request.user) for p in queryset.filter(ativa=True)]
        if len(criados) == 1:
            return HttpResponseRedirect(reverse("admin:vendas_convite_change", args=[criados[0].pk]))
        lista = format_html_join(mark_safe("<br>"), "{}: <b>{}</b>", ((c.pessoa, c.codigo) for c in criados))
        self.message_user(request, format_html("Convites criados:<br>{}", lista))

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if not change:
            Convite.objects.create(pessoa=obj, criado_por=request.user)
            self.message_user(request, "Um código de convite foi criado para esta pessoa (veja abaixo).")

    def save_formset(self, request, form, formset, change):
        for f in formset.forms:
            if isinstance(f.instance, Convite) and not f.instance.pk:
                f.instance.criado_por = request.user
        super().save_formset(request, form, formset, change)


@admin.register(Convite)
class ConviteAdmin(admin.ModelAdmin):
    list_display = ["codigo", "pessoa", "status_convite", "criado_em", "expira_em", "usado_em", "dispositivo"]
    list_filter = ["revogado", ("usado_em", admin.EmptyFieldListFilter)]
    search_fields = ["codigo", "pessoa__nome"]
    autocomplete_fields = ["pessoa"]
    actions = ["revogar"]

    def get_fields(self, request, obj=None):
        if obj is None:
            return ["pessoa", "expira_em"]
        return ["cartao_convite", "pessoa", "status_convite", "expira_em", "revogado", "usado_em", "dispositivo", "criado_em", "criado_por"]

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return []
        return ["cartao_convite", "pessoa", "status_convite", "usado_em", "dispositivo", "criado_em", "criado_por"]

    @admin.display(description="Situação")
    def status_convite(self, obj):
        classe = {"disponível": "ok", "usado": "neutro"}.get(obj.status, "off")
        return format_html('<span class="selo {}">{}</span>', classe, obj.status)

    @admin.display(description="Convite")
    def cartao_convite(self, obj):
        link = link_convite(self._request, obj)
        if not obj.disponivel:
            return format_html('<div class="cartaoConvite usado"><div class="codigo">{}</div><p>Convite {}.</p></div>', obj.codigo, obj.status)
        return format_html(
            '<div class="cartaoConvite"><div class="qr">{}</div><div>'
            '<div class="codigo">{}</div>'
            "<p>Para <b>{}</b>. Mande o link ou mostre o QR: o celular abre o app e já se conecta. "
            "Se preferir, a pessoa digita o código na tela inicial do app.</p>"
            '<p class="link"><a href="{}">{}</a></p>'
            "<p>Vale para <b>um aparelho</b>{}.</p></div></div>",
            mark_safe(qr_svg(link)),
            obj.codigo,
            obj.pessoa,
            link,
            link,
            f" até {timezone.localtime(obj.expira_em):%d/%m/%Y %H:%M}" if obj.expira_em else "",
        )

    def change_view(self, request, object_id, form_url="", extra_context=None):
        self._request = request
        return super().change_view(request, object_id, form_url, extra_context)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.criado_por = request.user
        super().save_model(request, obj, form, change)

    def response_add(self, request, obj, post_url_continue=None):
        return HttpResponseRedirect(reverse("admin:vendas_convite_change", args=[obj.pk]))

    @admin.action(description="Revogar convites (não podem mais ser usados)")
    def revogar(self, request, queryset):
        n = queryset.filter(usado_em__isnull=True).update(revogado=True)
        self.message_user(request, f"{n} convite(s) revogado(s).")


@admin.register(Dispositivo)
class DispositivoAdmin(admin.ModelAdmin):
    list_display = [
        "prefixo", "pessoa", "nome", "situacao", "ultimo_contato", "versao_app",
        "ativo", "pode_editar_itens", "pode_editar_pix", "pode_alterar_pedidos",
    ]
    list_editable = ["ativo", "pode_editar_itens", "pode_editar_pix", "pode_alterar_pedidos"]
    list_filter = ["ativo", "pessoa"]
    search_fields = ["prefixo", "pessoa__nome", "nome"]
    fields = [
        "pessoa", "prefixo", "nome", "ativo", "pode_editar_itens", "pode_editar_pix", "pode_alterar_pedidos",
        "criado_em", "ultimo_contato", "ultimo_ip", "versao_app",
    ]
    readonly_fields = ["pessoa", "criado_em", "ultimo_contato", "ultimo_ip", "versao_app"]
    actions = ["desconectar"]

    def has_add_permission(self, request):
        return False  # aparelho só entra por convite

    @admin.display(description="Agora")
    def situacao(self, obj):
        return format_html('<span class="selo {}">{}</span>', *(("ok", "online") if esta_online(obj) else ("off", "offline")))

    @admin.action(description="Desconectar aparelhos (precisarão de um convite novo)")
    def desconectar(self, request, queryset):
        n = queryset.update(ativo=False)
        self.message_user(request, f"{n} aparelho(s) desconectado(s).")


# =============================================================
#  Pedidos
# =============================================================


class ItemPedidoInline(admin.TabularInline):
    model = ItemPedido
    extra = 0
    can_delete = False
    fields = ["nome", "preco_formatado", "qtd_original", "qtd"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False

    @admin.display(description="Preço")
    def preco_formatado(self, obj):
        return reais(obj.preco)


class DevolucaoInline(admin.TabularInline):
    model = Devolucao
    extra = 0
    can_delete = False
    fields = ["criado_em", "dispositivo", "itens_devolvidos", "valor_formatado"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False

    @admin.display(description="Itens")
    def itens_devolvidos(self, obj):
        return ", ".join(f"{i.qtd}× {i.nome}" for i in obj.itens.all())

    @admin.display(description="Valor")
    def valor_formatado(self, obj):
        return reais(obj.valor)


@admin.register(Pedido)
class PedidoAdmin(admin.ModelAdmin):
    list_display = ["codigo_pedido", "criado_em", "pessoa", "evento", "resumo_itens", "forma", "total_formatado", "situacao"]
    list_filter = ["evento", "pessoa", "forma", ("cancelado_em", admin.EmptyFieldListFilter)]
    search_fields = ["prefixo", "pessoa__nome", "itens__nome"]
    date_hierarchy = "criado_em"
    inlines = [ItemPedidoInline, DevolucaoInline]
    actions = ["cancelar", "restaurar"]
    list_select_related = ["pessoa", "evento"]
    list_per_page = 50
    fields = [
        "codigo_pedido", "evento", "pessoa", "dispositivo", "criado_em", "recebido_em", "forma",
        "total_formatado", "total_original_formatado", "recebido_formatado", "troco_formatado", "cancelado_em", "cancelado_por",
    ]
    readonly_fields = fields

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("itens")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return request.method in ("GET", "HEAD") or obj is None

    @admin.display(description="Pedido", ordering="prefixo")
    def codigo_pedido(self, obj):
        return f"#{obj.codigo}"

    @admin.display(description="Itens")
    def resumo_itens(self, obj):
        return ", ".join(f"{i.qtd}× {i.nome}" for i in obj.itens.all() if i.qtd)

    @admin.display(description="Total", ordering="total")
    def total_formatado(self, obj):
        return reais(obj.total)

    @admin.display(description="Total original")
    def total_original_formatado(self, obj):
        return reais(obj.total_original)

    @admin.display(description="Recebido")
    def recebido_formatado(self, obj):
        return reais(obj.recebido)

    @admin.display(description="Troco")
    def troco_formatado(self, obj):
        return reais(obj.troco)

    @admin.display(description="Situação")
    def situacao(self, obj):
        if obj.cancelado:
            return mark_safe('<span class="selo off">cancelado</span>')
        if obj.total != obj.total_original:
            return mark_safe('<span class="selo aviso">com devolução</span>')
        return mark_safe('<span class="selo ok">ok</span>')

    @admin.action(description="Cancelar pedidos selecionados")
    def cancelar(self, request, queryset):
        n = 0
        for p in queryset.filter(cancelado_em__isnull=True):
            p.cancelado_em, p.cancelado_por = timezone.now(), f"admin: {request.user.get_username()}"
            p.save()
            RegistroAlteracao.objects.create(
                tipo="cancelamento", descricao=f"Pedido #{p.codigo} cancelado (admin)", usuario=request.user, pedido=p, evento=p.evento
            )
            n += 1
        self.message_user(request, f"{n} pedido(s) cancelado(s).")

    @admin.action(description="Restaurar pedidos cancelados")
    def restaurar(self, request, queryset):
        n = 0
        for p in queryset.filter(cancelado_em__isnull=False, total__gt=0):
            p.cancelado_em, p.cancelado_por = None, ""
            p.save()
            n += 1
        self.message_user(request, f"{n} pedido(s) restaurado(s).")


@admin.register(RegistroAlteracao)
class RegistroAlteracaoAdmin(admin.ModelAdmin):
    list_display = ["quando", "tipo", "descricao", "autor", "evento"]
    list_filter = ["tipo", "evento"]
    search_fields = ["descricao"]
    date_hierarchy = "quando"
    list_select_related = ["dispositivo__pessoa", "usuario", "evento"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
