"""
Gera eventos, pessoas e pedidos de mentira para ver o dashboard funcionando.

    python manage.py dados_exemplo          # cria
    python manage.py dados_exemplo --apagar # remove só o que foi criado aqui

Use só em desenvolvimento/homologação. Tudo que é criado leva "[exemplo]"
no nome (eventos e pessoas), para não se misturar com dados reais.
"""

import random
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from vendas.models import (
    Devolucao,
    DevolucaoItem,
    Dispositivo,
    Evento,
    Item,
    ItemPedido,
    Pedido,
    Pessoa,
    RegistroAlteracao,
)

MARCA = "[exemplo]"
NOMES = ["Ana Souza", "Beto Lima", "Carla Dias", "Davi Rocha", "Elisa Prado", "Fábio Nunes"]
EVENTOS = [
    ("Festa Junina", 112, 5.0, 1.0),
    ("Bazar Beneficente", 70, 4.0, 0.8),
    ("Festa do Padroeiro", 40, 6.0, 1.25),
    ("Quermesse de Outubro", 8, 5.0, 1.1),
]


class Command(BaseCommand):
    help = "Cria (ou apaga com --apagar) dados de exemplo para o dashboard."

    def add_arguments(self, parser):
        parser.add_argument("--apagar", action="store_true")
        parser.add_argument("--semente", type=int, default=7)

    def handle(self, *args, **opcoes):
        if opcoes["apagar"]:
            return self.apagar()
        if not Item.objects.filter(ativo=True).exists():
            raise CommandError("Cadastre itens antes (python manage.py carregar_cardapio).")
        random.seed(opcoes["semente"])
        with transaction.atomic():
            self.criar()

    def apagar(self):
        with transaction.atomic():
            eventos = Evento.objects.filter(nome__startswith=MARCA)
            Pedido.objects.filter(evento__in=eventos).delete()
            RegistroAlteracao.objects.filter(evento__in=eventos).delete()
            pessoas = Pessoa.objects.filter(nome__startswith=MARCA)
            RegistroAlteracao.objects.filter(dispositivo__pessoa__in=pessoas).delete()
            Dispositivo.objects.filter(pessoa__in=pessoas).delete()
            pessoas.delete()
            n = eventos.count()
            eventos.delete()
        self.stdout.write(self.style.SUCCESS(f"{n} eventos de exemplo apagados."))

    def criar(self):
        itens = list(Item.objects.filter(ativo=True))
        # popularidade: alguns itens vendem muito mais (curva de Pareto)
        pesos = {i.id: random.paretovariate(1.6) for i in itens}
        pares = [(a, b) for a in itens for b in itens if a.id < b.id]
        combos = random.sample(pares, k=min(4, len(pares)))  # itens que "andam juntos"

        aparelhos = []
        for nome in NOMES:
            pessoa = Pessoa.objects.create(nome=f"{MARCA} {nome}")
            disp, _ = Dispositivo.criar_para(pessoa, "Exemplo")
            disp.prefixo = "".join(p[0] for p in nome.split()).upper() + "X"
            disp.save()
            ritmo = random.uniform(0.6, 1.5)  # uns atendem mais rápido
            aparelhos.append((disp, ritmo))

        total = 0
        for nome, dias_atras, horas, fator in EVENTOS:
            inicio = (timezone.now() - timedelta(days=dias_atras)).replace(hour=17, minute=0, second=0, microsecond=0)
            evento = Evento.objects.create(
                nome=f"{MARCA} {nome}", inicio=inicio, fim=inicio + timedelta(hours=horas), ativo=False
            )
            escalados = random.sample(aparelhos, k=random.randint(3, len(aparelhos)))
            esgotou = {}
            # um ou dois itens populares esgotam no meio do evento
            for item in sorted(itens, key=lambda i: -pesos[i.id])[:2]:
                if random.random() < 0.7:
                    quando = inicio + timedelta(hours=horas * random.uniform(0.45, 0.8))
                    esgotou[item.id] = quando
                    RegistroAlteracao.objects.create(
                        tipo="esgotado", descricao=f"{item.nome} esgotou", dispositivo=escalados[0][0],
                        evento=evento, item=item, quando=quando, dados={"esgotado": True},
                    )

            minutos = int(horas * 60)
            for minuto in range(minutos):
                # movimento em "sino": pico entre 40% e 60% do evento
                x = minuto / minutos
                intensidade = 0.25 + 2.2 * max(0, 1 - abs(x - 0.5) * 2.3) ** 1.5
                for disp, ritmo in escalados:
                    if random.random() > 0.11 * intensidade * ritmo * fator:
                        continue
                    momento = inicio + timedelta(minutes=minuto, seconds=random.randint(0, 59))
                    disponiveis = [i for i in itens if not (i.id in esgotou and momento >= esgotou[i.id])]
                    escolha = {}
                    for _ in range(max(1, int(random.expovariate(0.55)))):
                        item = random.choices(disponiveis, weights=[pesos[i.id] for i in disponiveis])[0]
                        escolha[item] = escolha.get(item, 0) + random.choice([1, 1, 1, 2])
                        for a, b in combos:
                            if item == a and b in disponiveis and random.random() < 0.5:
                                escolha[b] = escolha.get(b, 0) + 1
                    valor = sum(i.preco * q for i, q in escolha.items())
                    pix = random.random() < (0.25 + 0.3 * (dias_atras < 50))
                    recebido = None if pix else _nota(valor)
                    pedido = Pedido(
                        evento=evento, dispositivo=disp, pessoa=disp.pessoa, prefixo=disp.prefixo,
                        numero=Pedido.objects.filter(evento=evento, dispositivo=disp).count() + 1,
                        criado_em=momento, forma="pix" if pix else "dinheiro", total=valor, total_original=valor,
                        recebido=recebido, troco=(recebido - valor) if recebido else None,
                    )
                    pedido.save()
                    linhas = [
                        ItemPedido(pedido=pedido, item=i, nome=i.nome, preco=i.preco, qtd=q, qtd_original=q)
                        for i, q in escolha.items()
                    ]
                    ItemPedido.objects.bulk_create(linhas)
                    total += 1
                    sorte = random.random()
                    if sorte < 0.015:
                        pedido.cancelado_em = momento + timedelta(minutes=2)
                        pedido.cancelado_por = str(disp.pessoa)
                        pedido.save()
                    elif sorte < 0.04:
                        linha = random.choice(linhas)
                        dev = Devolucao.objects.create(
                            pedido=pedido, dispositivo=disp, criado_em=momento + timedelta(minutes=8), valor=linha.preco
                        )
                        DevolucaoItem.objects.create(devolucao=dev, item=linha.item, nome=linha.nome, preco=linha.preco, qtd=1)
                        linha.qtd -= 1
                        linha.save()
                        pedido.total -= linha.preco
                        pedido.save()
            Pedido.objects.filter(evento=evento).update(recebido_em=timezone.now())
            self.stdout.write(f"  {evento.nome}: {evento.pedidos.count()} pedidos")
        self.stdout.write(self.style.SUCCESS(f"{total} pedidos de exemplo criados."))


def _nota(valor):
    """Simula o dinheiro entregue: valor exato ou a nota seguinte."""
    reais = valor / 100
    if random.random() < 0.3:
        return valor
    for nota in (5, 10, 20, 50, 100, 200):
        if nota >= reais:
            return int(nota * 100)
    return valor
