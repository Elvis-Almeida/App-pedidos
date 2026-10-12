"""
Tratamento das imagens enviadas pelo admin.

- Fotos dos itens viram WebP de até 512 px (leves para o celular baixar).
- O logo gera os ícones do app (192, 512, "maskable" e o do iPhone).
- Os nomes levam um pedaço do hash do conteúdo: quando a imagem muda, o nome
  muda, então dá para o navegador guardar para sempre sem ficar desatualizado.
"""

import hashlib
import io

from django.core.files.base import ContentFile
from django.utils.text import slugify
from PIL import Image, ImageOps

COR_FUNDO_ICONE = (13, 16, 24)  # #0d1018, o fundo do app


def _abrir(arquivo):
    arquivo.seek(0)
    img = Image.open(arquivo)
    img = ImageOps.exif_transpose(img)  # foto de celular vem "deitada" sem isto
    return img.convert("RGBA")


def _hash(dados):
    return hashlib.sha256(dados).hexdigest()[:10]


def _webp(img, maximo, qualidade=82):
    copia = img.copy()
    copia.thumbnail((maximo, maximo), Image.LANCZOS)
    saida = io.BytesIO()
    copia.save(saida, "WEBP", quality=qualidade, method=6)
    return saida.getvalue()


def _png(img):
    saida = io.BytesIO()
    img.save(saida, "PNG", optimize=True)
    return saida.getvalue()


def _quadrado(img, lado, fundo=None, margem=0.0):
    """Encaixa a imagem num quadrado `lado`×`lado`, centralizada."""
    tela = Image.new("RGBA", (lado, lado), fundo + (255,) if fundo else (0, 0, 0, 0))
    util = int(lado * (1 - 2 * margem))
    copia = img.copy()
    copia.thumbnail((util, util), Image.LANCZOS)
    tela.alpha_composite(copia, ((lado - copia.width) // 2, (lado - copia.height) // 2))
    return tela


def salvar_foto_item(item):
    img = _abrir(item.imagem)
    dados = _webp(img, 512)
    nome = f"{slugify(item.nome) or 'item'}-{_hash(dados)}.webp"
    item.imagem.save(nome, ContentFile(dados), save=False)


def salvar_logo_original(config):
    img = _abrir(config.logo)
    dados = _png(_quadrado(img, 1024))
    config.logo.save(f"logo-{_hash(dados)}.png", ContentFile(dados), save=False)


def salvar_favicon(config):
    img = _abrir(config.favicon)
    dados = _png(_quadrado(img, 256))
    config.favicon.save(f"favicon-orig-{_hash(dados)}.png", ContentFile(dados), save=False)


def gerar_icones(config):
    img = _abrir(config.logo)
    variantes = {
        "icone_192": _quadrado(img, 192),
        "icone_512": _quadrado(img, 512),
        # "maskable": o Android recorta em círculo/gota, então precisa de margem
        "icone_maskable": _quadrado(img, 512, fundo=COR_FUNDO_ICONE, margem=0.12),
        # iPhone não aceita transparência no ícone
        "icone_apple": _quadrado(img, 180, fundo=COR_FUNDO_ICONE, margem=0.06),
    }
    for campo, imagem in variantes.items():
        dados = _png(imagem)
        getattr(config, campo).save(f"{campo.replace('_', '-')}-{_hash(dados)}.png", ContentFile(dados), save=False)


def gerar_favicon_png(config):
    origem = config.favicon or config.logo
    if not origem:
        config.favicon_png = None
        return
    dados = _png(_quadrado(_abrir(origem), 64))
    config.favicon_png.save(f"favicon-{_hash(dados)}.png", ContentFile(dados), save=False)
