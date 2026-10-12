"""
Modelos do Vendas Online.

Valores em dinheiro são sempre CENTAVOS (inteiros), como no app.

Sincronização: tudo que os aparelhos precisam acompanhar (configuração, itens,
eventos, pedidos) tem um campo `rev`, tirado de um contador global. O aparelho
guarda o maior `rev` que já viu e pergunta "o que mudou depois disso?".
O contador é travado até o fim da transação, então a ordem dos `rev` é a mesma
ordem em que as mudanças ficam visíveis — nenhum aparelho perde uma alteração.
"""

import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F, Q
from django.utils import timezone

from . import imagens
from .pix import TIPOS_CHAVE, erro_configuracao_pix

# Sem 0/O, 1/I/L: fácil de ditar e de digitar
ALFABETO_CONVITE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


# =============================================================
#  Revisão global (para a sincronização incremental)
# =============================================================


class Revisao(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    valor = models.BigIntegerField(default=0)

    class Meta:
        verbose_name = "revisão"


def proxima_revisao():
    """Devolve o próximo número de revisão. Trava a linha até o commit."""
    with transaction.atomic():
        Revisao.objects.get_or_create(id=1)
        Revisao.objects.select_for_update().filter(id=1).update(valor=F("valor") + 1)
        return Revisao.objects.get(id=1).valor


def revisao_atual():
    obj = Revisao.objects.filter(id=1).first()
    return obj.valor if obj else 0


class ComRevisao(models.Model):
    rev = models.BigIntegerField(default=0, db_index=True, editable=False)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        with transaction.atomic():
            self.rev = proxima_revisao()
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = {*kwargs["update_fields"], "rev"}
            super().save(*args, **kwargs)


# =============================================================
#  Configuração geral (uma linha só)
# =============================================================


class Configuracao(ComRevisao):
    nome_app = models.CharField("nome do app", max_length=40, default="SCJ Pedidos")
    nome_curto = models.CharField(
        "nome curto", max_length=15, default="SCJ Pedidos", help_text="Aparece embaixo do ícone no celular."
    )
    logo = models.ImageField(
        upload_to="marca/",
        blank=True,
        help_text="Quadrada, de preferência 512×512 ou maior. Vira o ícone do app no celular.",
    )
    favicon = models.ImageField(
        upload_to="marca/", blank=True, help_text="Ícone da aba do navegador. Se ficar vazio, usa o logo."
    )
    # gerados automaticamente a partir do logo
    icone_192 = models.ImageField(upload_to="marca/", blank=True, editable=False)
    icone_512 = models.ImageField(upload_to="marca/", blank=True, editable=False)
    icone_maskable = models.ImageField(upload_to="marca/", blank=True, editable=False)
    icone_apple = models.ImageField(upload_to="marca/", blank=True, editable=False)
    favicon_png = models.ImageField(upload_to="marca/", blank=True, editable=False)

    # ---------- Pix ----------
    pix_ativo = models.BooleanField(
        "mostrar QR Code Pix no fim do pedido", default=False
    )
    pix_tipo = models.CharField("tipo de chave", max_length=10, choices=TIPOS_CHAVE.items(), default="cpf")
    pix_chave = models.CharField("chave Pix", max_length=80, blank=True)
    pix_nome = models.CharField("nome de quem recebe", max_length=25, blank=True)
    pix_cidade = models.CharField("cidade", max_length=15, blank=True)

    # ---------- Bloqueios ----------
    bloquear_edicao_itens = models.BooleanField(
        "bloquear esgotados nos aparelhos",
        default=False,
        help_text="Os aparelhos não conseguem marcar/desmarcar itens como esgotados.",
    )
    bloquear_edicao_pix = models.BooleanField(
        "bloquear Pix nos aparelhos", default=False, help_text="Os aparelhos não conseguem mudar a configuração do Pix."
    )
    bloquear_alteracao_pedidos = models.BooleanField(
        "bloquear alteração de pedidos enviados",
        default=False,
        help_text="Depois que o pedido chega ao servidor, nenhum aparelho consegue devolver item, desfazer ou excluir.",
    )

    atualizado_em = models.DateTimeField(auto_now=True)
    atualizado_por = models.CharField(max_length=80, blank=True, editable=False)

    class Meta:
        verbose_name = "configuração"
        verbose_name_plural = "configuração"

    def __str__(self):
        return "Configuração"

    @classmethod
    def atual(cls):
        obj = cls.objects.filter(pk=1).first()
        if obj is None:
            obj = cls(pk=1)
            obj.save()
        return obj

    def clean(self):
        if self.pix_ativo:
            erro = erro_configuracao_pix(self.pix_tipo, self.pix_chave, self.pix_nome)
            if erro:
                raise ValidationError({"pix_chave": f"Para ligar o Pix: {erro}"})

    def save(self, *args, **kwargs):
        self.pk = 1
        anterior = Configuracao.objects.filter(pk=1).first()
        logo_mudou = bool(self.logo) and (not anterior or anterior.logo.name != self.logo.name)
        favicon_mudou = bool(self.favicon) and (not anterior or anterior.favicon.name != self.favicon.name)

        if self.logo and not getattr(self.logo, "_committed", True):
            imagens.salvar_logo_original(self)
        if self.favicon and not getattr(self.favicon, "_committed", True):
            imagens.salvar_favicon(self)
            favicon_mudou = True
        if logo_mudou:
            imagens.gerar_icones(self)
        if favicon_mudou or (logo_mudou and not self.favicon):
            imagens.gerar_favicon_png(self)
        if not self.logo and anterior and anterior.logo:
            for campo in ("icone_192", "icone_512", "icone_maskable", "icone_apple"):
                setattr(self, campo, None)
            if not self.favicon:
                self.favicon_png = None
        super().save(*args, **kwargs)

    def pix_publico(self):
        return {
            "ativo": self.pix_ativo,
            "tipo": self.pix_tipo,
            "chave": self.pix_chave,
            "nome": self.pix_nome,
            "cidade": self.pix_cidade,
        }


# =============================================================
#  Pessoas, convites e aparelhos
# =============================================================


class Pessoa(models.Model):
    nome = models.CharField(max_length=80)
    telefone = models.CharField(max_length=30, blank=True)
    observacoes = models.TextField("observações", blank=True)
    ativa = models.BooleanField(default=True, help_text="Desativar desconecta todos os aparelhos da pessoa.")
    criada_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["nome"]

    def __str__(self):
        return self.nome

    def iniciais(self):
        partes = [p for p in self.nome.split() if len(p) > 2 or len(self.nome.split()) == 1]
        partes = partes or self.nome.split() or ["X"]
        letras = (partes[0][0] + (partes[-1][0] if len(partes) > 1 else partes[0][1:2] or "X")).upper()
        return "".join(c for c in letras if c.isalnum()) or "AP"


def gerar_codigo_convite():
    while True:
        bruto = "".join(secrets.choice(ALFABETO_CONVITE) for _ in range(8))
        codigo = f"{bruto[:4]}-{bruto[4:]}"
        if not Convite.objects.filter(codigo=codigo).exists():
            return codigo


def normalizar_codigo(texto):
    """'abcd 1234', 'ABCD-1234' → 'ABCD-1234' (ou '' se não tiver 8 caracteres)"""
    limpo = "".join(c for c in str(texto).upper() if c.isalnum())
    return f"{limpo[:4]}-{limpo[4:]}" if len(limpo) == 8 else ""


def validade_padrao():
    return timezone.now() + timedelta(days=30)


class Convite(models.Model):
    codigo = models.CharField("código", max_length=9, unique=True, default=gerar_codigo_convite, editable=False)
    pessoa = models.ForeignKey(Pessoa, on_delete=models.CASCADE, related_name="convites")
    criado_em = models.DateTimeField(auto_now_add=True)
    criado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, editable=False
    )
    expira_em = models.DateTimeField(
        "vale até", null=True, blank=True, default=validade_padrao, help_text="Deixe vazio para não expirar."
    )
    usado_em = models.DateTimeField(null=True, blank=True, editable=False)
    dispositivo = models.OneToOneField(
        "Dispositivo", null=True, blank=True, on_delete=models.SET_NULL, editable=False, related_name="convite"
    )
    revogado = models.BooleanField(default=False)

    class Meta:
        ordering = ["-criado_em"]

    def __str__(self):
        return f"{self.codigo} · {self.pessoa}"

    @property
    def status(self):
        if self.usado_em:
            return "usado"
        if self.revogado:
            return "revogado"
        if self.expira_em and self.expira_em < timezone.now():
            return "expirado"
        if not self.pessoa.ativa:
            return "pessoa inativa"
        return "disponível"

    @property
    def disponivel(self):
        return self.status == "disponível"


def _hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Dispositivo(models.Model):
    pessoa = models.ForeignKey(Pessoa, on_delete=models.PROTECT, related_name="dispositivos")
    prefixo = models.CharField(
        max_length=6, unique=True, help_text="Aparece no número dos pedidos deste aparelho (ex.: EL-12)."
    )
    nome = models.CharField("aparelho", max_length=120, blank=True)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    criado_em = models.DateTimeField("conectado em", auto_now_add=True)
    ultimo_contato = models.DateTimeField("último contato", null=True, blank=True)
    ultimo_ip = models.GenericIPAddressField(null=True, blank=True)
    versao_app = models.CharField("versão do app", max_length=40, blank=True)
    ativo = models.BooleanField(default=True, help_text="Desmarque para desconectar este aparelho.")

    # Permissões deste aparelho (valem junto com os bloqueios gerais da Configuração)
    pode_editar_itens = models.BooleanField("pode marcar esgotados", default=True)
    pode_editar_pix = models.BooleanField("pode mudar o Pix", default=True)
    pode_alterar_pedidos = models.BooleanField(
        "pode alterar pedidos enviados", default=True, help_text="Devolver item, desfazer ou excluir pedido já enviado."
    )

    class Meta:
        ordering = ["pessoa__nome", "prefixo"]
        verbose_name = "aparelho"
        verbose_name_plural = "aparelhos"

    def __str__(self):
        return f"{self.prefixo} · {self.pessoa}"

    @classmethod
    def criar_para(cls, pessoa, nome=""):
        """Cria o aparelho e devolve (dispositivo, token). O token só existe aqui."""
        token = secrets.token_urlsafe(32)
        base = pessoa.iniciais()[:4]
        prefixo, n = base, 2
        while cls.objects.filter(prefixo=prefixo).exists():
            prefixo = f"{base}{n}"
            n += 1
        disp = cls.objects.create(pessoa=pessoa, prefixo=prefixo, nome=nome[:120], token_hash=_hash_token(token))
        return disp, token

    @classmethod
    def pelo_token(cls, token):
        if not token:
            return None
        return (
            cls.objects.select_related("pessoa")
            .filter(token_hash=_hash_token(token), ativo=True, pessoa__ativa=True)
            .first()
        )

    def permissoes(self, config=None):
        config = config or Configuracao.atual()
        return {
            "editar_itens": self.pode_editar_itens and not config.bloquear_edicao_itens,
            "editar_pix": self.pode_editar_pix and not config.bloquear_edicao_pix,
            "alterar_pedidos": self.pode_alterar_pedidos and not config.bloquear_alteracao_pedidos,
        }


# =============================================================
#  Eventos e cardápio
# =============================================================


class Evento(ComRevisao):
    nome = models.CharField(max_length=80)
    inicio = models.DateTimeField("início", default=timezone.now)
    fim = models.DateTimeField(null=True, blank=True)
    ativo = models.BooleanField(
        "evento atual", default=False, help_text="Os aparelhos vendem no evento atual. Só um pode estar ativo."
    )
    observacoes = models.TextField("observações", blank=True)

    class Meta:
        ordering = ["-inicio"]
        constraints = [models.UniqueConstraint(fields=["ativo"], condition=Q(ativo=True), name="um_evento_ativo")]

    def __str__(self):
        return self.nome

    def validate_constraints(self, exclude=None):
        # "Só um evento ativo" é garantido no save (ele desativa o anterior);
        # validar antes impediria justamente marcar um evento novo como atual.
        constraints = [(c, cs) for c, cs in self.get_constraints()]
        outras = [(m, [c for c in cs if c.name != "um_evento_ativo"]) for m, cs in constraints]
        erros = {}
        for modelo, lista in outras:
            for constraint in lista:
                try:
                    constraint.validate(modelo, self, exclude=exclude)
                except ValidationError as e:
                    erros = e.update_error_dict(erros)
        if erros:
            raise ValidationError(erros)

    def save(self, *args, **kwargs):
        with transaction.atomic():
            if self.ativo:
                for outro in Evento.objects.filter(ativo=True).exclude(pk=self.pk):
                    outro.ativo = False
                    outro.fim = outro.fim or timezone.now()
                    outro.save()
            super().save(*args, **kwargs)

    @classmethod
    def atual(cls):
        """O evento ativo. Se não houver, abre um com a data de hoje."""
        evento = cls.objects.filter(ativo=True).first()
        if evento is None:
            hoje = timezone.localdate()
            evento = cls.objects.create(nome=f"Vendas de {hoje:%d/%m/%Y}", ativo=True)
        return evento


class Item(ComRevisao):
    nome = models.CharField(max_length=30, help_text="Curto: cabe ~12 letras no card.")
    preco = models.PositiveIntegerField("preço (centavos)", help_text="Em centavos: 500 = R$ 5,00")
    imagem = models.ImageField(upload_to="itens/", blank=True)
    ordem = models.PositiveIntegerField(default=0, help_text="Menor aparece primeiro.")
    ativo = models.BooleanField("no cardápio", default=True, help_text="Desmarque para tirar o item do app.")
    esgotado = models.BooleanField(default=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["ordem", "nome"]
        verbose_name = "item do cardápio"
        verbose_name_plural = "itens do cardápio"

    def __str__(self):
        return self.nome

    def save(self, *args, **kwargs):
        if self.imagem and not getattr(self.imagem, "_committed", True):
            imagens.salvar_foto_item(self)
        super().save(*args, **kwargs)


# =============================================================
#  Pedidos
# =============================================================


class Pedido(ComRevisao):
    FORMAS = {"dinheiro": "Dinheiro", "pix": "Pix"}

    uuid = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    evento = models.ForeignKey(Evento, on_delete=models.PROTECT, related_name="pedidos")
    dispositivo = models.ForeignKey(Dispositivo, on_delete=models.PROTECT, related_name="pedidos")
    pessoa = models.ForeignKey(Pessoa, on_delete=models.PROTECT, related_name="pedidos")
    prefixo = models.CharField(max_length=6, editable=False)
    numero = models.PositiveIntegerField("número")
    criado_em = models.DateTimeField("feito em", db_index=True)
    recebido_em = models.DateTimeField("chegou ao servidor", auto_now_add=True)
    forma = models.CharField("pagamento", max_length=10, choices=FORMAS.items(), default="dinheiro")
    total = models.PositiveIntegerField(help_text="Centavos, já descontadas as devoluções")
    total_original = models.PositiveIntegerField(default=0)
    recebido = models.PositiveIntegerField(null=True, blank=True)
    troco = models.IntegerField(null=True, blank=True, help_text="Negativo = faltou dinheiro")
    cancelado_em = models.DateTimeField(null=True, blank=True)
    cancelado_por = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ["-criado_em"]
        indexes = [models.Index(fields=["evento", "rev"])]

    def __str__(self):
        return f"#{self.codigo}"

    @property
    def codigo(self):
        return f"{self.prefixo}-{self.numero}"

    @property
    def cancelado(self):
        return self.cancelado_em is not None


class ItemPedido(models.Model):
    pedido = models.ForeignKey(Pedido, on_delete=models.CASCADE, related_name="itens")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL, related_name="vendas")
    nome = models.CharField(max_length=30)
    preco = models.PositiveIntegerField()
    qtd = models.PositiveIntegerField("quantidade")
    qtd_original = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "item do pedido"
        verbose_name_plural = "itens do pedido"

    def __str__(self):
        return f"{self.qtd}× {self.nome}"


class Devolucao(models.Model):
    uuid = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pedido = models.ForeignKey(Pedido, on_delete=models.CASCADE, related_name="devolucoes")
    dispositivo = models.ForeignKey(Dispositivo, null=True, blank=True, on_delete=models.SET_NULL)
    criado_em = models.DateTimeField()
    valor = models.PositiveIntegerField()

    class Meta:
        ordering = ["criado_em"]
        verbose_name = "devolução"
        verbose_name_plural = "devoluções"


class DevolucaoItem(models.Model):
    devolucao = models.ForeignKey(Devolucao, on_delete=models.CASCADE, related_name="itens")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL)
    nome = models.CharField(max_length=30)
    preco = models.PositiveIntegerField()
    qtd = models.PositiveIntegerField()


# =============================================================
#  Registro de alterações (auditoria + "a que horas esgotou")
# =============================================================


class RegistroAlteracao(models.Model):
    TIPOS = {
        "esgotado": "Item esgotado / reposto",
        "pix": "Configuração do Pix",
        "devolucao": "Devolução de item",
        "cancelamento": "Pedido cancelado",
        "aparelho": "Aparelho conectado",
        "bloqueado": "Tentativa bloqueada",
    }

    quando = models.DateTimeField(default=timezone.now, db_index=True)
    tipo = models.CharField(max_length=20, choices=TIPOS.items())
    descricao = models.CharField("descrição", max_length=255)
    dispositivo = models.ForeignKey(Dispositivo, null=True, blank=True, on_delete=models.SET_NULL)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    evento = models.ForeignKey(Evento, null=True, blank=True, on_delete=models.SET_NULL)
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL)
    pedido = models.ForeignKey(Pedido, null=True, blank=True, on_delete=models.SET_NULL)
    dados = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-quando"]
        verbose_name = "registro de alteração"
        verbose_name_plural = "registro de alterações"

    def __str__(self):
        return self.descricao

    @property
    def autor(self):
        if self.dispositivo_id:
            return f"{self.dispositivo.pessoa} ({self.dispositivo.prefixo})"
        if self.usuario_id:
            return f"admin: {self.usuario}"
        return "sistema"
