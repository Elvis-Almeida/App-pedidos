"""
Carrega o cardápio da versão offline (com as fotos) no banco.

    python manage.py carregar_cardapio

Só cria itens que ainda não existem (pelo nome), então pode rodar de novo
sem duplicar. Depois disso, preços e fotos se mudam pelo admin.
"""

from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand

from vendas.models import Item

SEMENTES = Path(__file__).resolve().parents[2] / "sementes" / "itens"

# (nome, preço em centavos, arquivo da foto, aparece no cardápio)
CARDAPIO = [
    ("Caldo P", 300, "caldo_p.webp", True),
    ("Caldo", 500, "caldo.webp", True),
    ("Canjica P", 300, "canjica_p.webp", True),
    ("Canjica", 500, "canjica.webp", True),
    ("Crepe", 500, "crepe.webp", True),
    ("Espetinho", 2000, "espetinho.webp", True),
    ("Galin. caip.", 2000, "galinha_caip.webp", True),
    ("Misto", 500, "misto.webp", True),
    ("BomBom", 500, "bombom.webp", True),
    ("Açaí 250ml", 1000, "acai_250ml.webp", True),
    ("Açaí 400ml", 1500, "acai_400ml.webp", True),
    ("Açaí 500ml", 1800, "acai_500ml.webp", True),
    ("C. quente", 500, "cachorro_quente.webp", True),
    ("Coca-cola", 1500, "coca-cola.webp", True),
    ("Fanta", 1500, "fanta.webp", True),
    ("Antarctica", 1500, "guarana_antarctica.webp", True),
    ("River", 1000, "river.webp", True),
    ("Rivinho", 300, "pitchula.webp", True),
    ("Copo suco", 500, "copo_de_suco.webp", True),
    ("Jarra suco", 1500, "jarra_de_suco.webp", True),
    ("Água min.", 300, "garrafa_de_agua.webp", True),
    ("Pula pula", 700, "pula_pula.webp", True),
    ("Copo refri", 200, "copo_de_refri.webp", False),
    ("Bolo pote", 700, "bolo_no_pote.webp", False),
    ("Pedaço bolo", 500, "pedaco_de_bolo.webp", False),
    ("Torta doce", 500, "torta_doce.webp", False),
    ("Salgados", 500, "salgados.webp", False),
]


class Command(BaseCommand):
    help = "Cria os itens do cardápio original (com fotos), se ainda não existirem."

    def handle(self, *args, **opcoes):
        criados = 0
        for ordem, (nome, preco, arquivo, ativo) in enumerate(CARDAPIO, start=1):
            if Item.objects.filter(nome=nome).exists():
                continue
            item = Item(nome=nome, preco=preco, ordem=ordem * 10, ativo=ativo)
            caminho = SEMENTES / arquivo
            if caminho.exists():
                with caminho.open("rb") as f:
                    item.imagem = File(f, name=arquivo)  # passa pelo mesmo tratamento do admin
                    item.save()
            else:
                item.save()
            criados += 1
        self.stdout.write(self.style.SUCCESS(f"{criados} itens criados ({Item.objects.count()} no total)."))
