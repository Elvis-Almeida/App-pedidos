"""
Inteligência de dados do dashboard.

Tudo é calculado em Python a partir dos pedidos (um evento grande tem alguns
milhares de linhas: rápido o bastante e fácil de entender/alterar).

Valores em centavos; horários no fuso local (America/Sao_Paulo).
"""

import math
from collections import Counter, defaultdict
from datetime import timedelta
from itertools import combinations
from statistics import median

from django.utils import timezone

from .models import Devolucao, DevolucaoItem, Evento, ItemPedido, Pedido, RegistroAlteracao

NOTAS = [200, 100, 50, 20, 10, 5, 2]  # em reais


def _local(dt):
    return timezone.localtime(dt)


def _pct(parte, todo):
    return round(100 * parte / todo, 1) if todo else 0.0


# =============================================================
#  Carga dos dados
# =============================================================


def _carregar(eventos, pessoa_id=None):
    filtro = {"evento__in": eventos}
    if pessoa_id:
        filtro["pessoa_id"] = pessoa_id
    pedidos = list(
        Pedido.objects.filter(**filtro).values(
            "uuid", "criado_em", "total", "forma", "recebido", "troco", "cancelado_em",
            "pessoa_id", "pessoa__nome", "evento_id", "prefixo", "numero",
        )
    )
    for p in pedidos:
        p["hora"] = _local(p["criado_em"])
    validos = [p for p in pedidos if p["cancelado_em"] is None]
    ids = {p["uuid"] for p in validos}

    linhas = list(
        ItemPedido.objects.filter(pedido__evento__in=eventos, qtd__gt=0, pedido_id__in=ids).values(
            "pedido_id", "item_id", "nome", "preco", "qtd"
        )
    )
    devolucoes = list(
        Devolucao.objects.filter(pedido__evento__in=eventos, **({"pedido__pessoa_id": pessoa_id} if pessoa_id else {})).values(
            "valor", "pedido__pessoa_id"
        )
    )
    itens_devolvidos = Counter()
    for d in DevolucaoItem.objects.filter(devolucao__pedido__evento__in=eventos).values("nome", "qtd"):
        itens_devolvidos[d["nome"]] += d["qtd"]
    return pedidos, validos, linhas, devolucoes, itens_devolvidos


# =============================================================
#  Indicadores principais
# =============================================================


def _indicadores(pedidos, validos, linhas, devolucoes):
    arrecadado = sum(p["total"] for p in validos)
    pix = sum(p["total"] for p in validos if p["forma"] == "pix")
    n = len(validos)
    itens = sum(l["qtd"] for l in linhas)
    cancelados = [p for p in pedidos if p["cancelado_em"] is not None]
    # duração = soma do período de vendas de cada evento (não o intervalo entre eventos)
    por_evento = defaultdict(list)
    for p in validos:
        por_evento[p["evento_id"]].append(p["hora"])
    duracao = sum((max(h) - min(h)).total_seconds() / 3600 for h in por_evento.values() if len(h) > 1)
    trocos = [p["troco"] for p in validos if p["forma"] == "dinheiro" and p["troco"] and p["troco"] > 0]
    return {
        "arrecadado": arrecadado,
        "pedidos": n,
        "ticket_medio": round(arrecadado / n) if n else 0,
        "itens": itens,
        "itens_por_pedido": round(itens / n, 2) if n else 0,
        "pix": pix,
        "dinheiro": arrecadado - pix,
        "pix_pct": _pct(pix, arrecadado),
        "devolvido": sum(d["valor"] for d in devolucoes),
        "devolucoes": len(devolucoes),
        "cancelados": len(cancelados),
        "cancelados_valor": sum(p["total"] for p in cancelados),
        "pessoas": len({p["pessoa_id"] for p in validos}),
        "duracao_horas": round(duracao, 1),
        "pedidos_por_hora": round(n / duracao, 1) if duracao >= 0.5 else None,
        "troco_total": sum(trocos),
        "troco_medio": round(sum(trocos) / len(trocos)) if trocos else 0,
    }


def _variacao(atual, anterior, chaves=("arrecadado", "pedidos", "ticket_medio", "itens", "pix_pct")):
    out = {}
    for k in chaves:
        a, b = atual.get(k) or 0, anterior.get(k) or 0
        out[k] = None if not b else round(100 * (a - b) / b, 1)
    return out


# =============================================================
#  Fluxo no tempo
# =============================================================


def _fluxo(validos, um_evento):
    """Um evento: blocos de 15 min no horário real. Vários: por hora do dia."""
    if not validos:
        return {"tipo": "vazio", "blocos": []}
    blocos = defaultdict(lambda: {"dinheiro": 0, "pix": 0, "valor": 0})
    if um_evento:
        inicio = min(p["hora"] for p in validos).replace(minute=0, second=0, microsecond=0)
        fim = max(p["hora"] for p in validos)
        for p in validos:
            minuto = int((p["hora"] - inicio).total_seconds() // 900)
            b = blocos[minuto]
            b[p["forma"]] += 1
            b["valor"] += p["total"]
        total_blocos = int((fim - inicio).total_seconds() // 900) + 1
        lista = []
        for i in range(total_blocos):
            t = inicio + timedelta(minutes=15 * i)
            lista.append({"rotulo": t.strftime("%H:%M"), **blocos[i]})
        return {"tipo": "15min", "blocos": lista}
    for p in validos:
        b = blocos[p["hora"].hour]
        b[p["forma"]] += 1
        b["valor"] += p["total"]
    horas = sorted(blocos)
    lista = [{"rotulo": f"{h:02d}h", **blocos[h]} for h in range(horas[0], horas[-1] + 1)]
    return {"tipo": "hora", "blocos": lista}


# =============================================================
#  Pessoas
# =============================================================


def _pessoas(validos, linhas, pedidos, devolucoes):
    itens_por_pedido = Counter()
    for l in linhas:
        itens_por_pedido[l["pedido_id"]] += l["qtd"]
    grupos = defaultdict(list)
    for p in validos:
        grupos[(p["pessoa_id"], p["pessoa__nome"])].append(p)
    canc = Counter(p["pessoa_id"] for p in pedidos if p["cancelado_em"] is not None)
    devs = Counter(d["pedido__pessoa_id"] for d in devolucoes)

    tabela = []
    for (pid, nome), ps in grupos.items():
        ps.sort(key=lambda p: p["hora"])
        total = sum(p["total"] for p in ps)
        blocos_ativos = {(p["evento_id"], p["hora"].replace(minute=p["hora"].minute // 15 * 15, second=0, microsecond=0)) for p in ps}
        horas_ativas = len(blocos_ativos) * 0.25
        intervalos = [
            (b["hora"] - a["hora"]).total_seconds() / 60
            for a, b in zip(ps, ps[1:])
            if a["evento_id"] == b["evento_id"] and (b["hora"] - a["hora"]).total_seconds() < 1800
        ]
        tabela.append(
            {
                "pessoa_id": pid,
                "nome": nome,
                "pedidos": len(ps),
                "total": total,
                "ticket_medio": round(total / len(ps)),
                "itens_por_pedido": round(sum(itens_por_pedido[p["uuid"]] for p in ps) / len(ps), 1),
                "pix_pct": _pct(sum(p["total"] for p in ps if p["forma"] == "pix"), total),
                "ritmo": round(len(ps) / horas_ativas, 1) if horas_ativas else None,
                "intervalo_mediano": round(median(intervalos), 1) if intervalos else None,
                "cancelados": canc[pid],
                "devolucoes": devs[pid],
                "eventos": len({p["evento_id"] for p in ps}),
            }
        )
    tabela.sort(key=lambda r: -r["total"])
    return tabela


# =============================================================
#  Itens: ranking, curva ABC, pico, esgotamento
# =============================================================


def _itens(validos, linhas, eventos, um_evento, itens_devolvidos):
    hora_do_pedido = {p["uuid"]: p["hora"] for p in validos}
    n_pedidos = len(validos)
    por_item = defaultdict(lambda: {"qtd": 0, "receita": 0, "pedidos": set(), "horas": Counter()})
    for l in linhas:
        r = por_item[l["nome"]]
        r["qtd"] += l["qtd"]
        r["receita"] += l["qtd"] * l["preco"]
        r["pedidos"].add(l["pedido_id"])
        r["horas"][hora_do_pedido[l["pedido_id"]].hour] += l["qtd"]
        r["item_id"] = l["item_id"]

    receita_total = sum(r["receita"] for r in por_item.values()) or 1
    esgotamentos = {}
    if um_evento:
        evento = eventos[0]
        for reg in RegistroAlteracao.objects.filter(evento=evento, tipo="esgotado", dados__esgotado=True).order_by("quando"):
            esgotamentos.setdefault(reg.item_id, _local(reg.quando))
        horas = [p["hora"] for p in validos]
        abertura, fechamento = (min(horas), max(horas)) if horas else (None, None)

    tabela, acumulado = [], 0
    for nome, r in sorted(por_item.items(), key=lambda kv: -kv[1]["receita"]):
        acumulado += r["receita"]
        fatia = acumulado / receita_total
        linha = {
            "nome": nome,
            "qtd": r["qtd"],
            "receita": r["receita"],
            "receita_pct": _pct(r["receita"], receita_total),
            "classe": "A" if fatia <= 0.8 or not tabela else "B" if fatia <= 0.95 else "C",
            "penetracao": _pct(len(r["pedidos"]), n_pedidos),
            "hora_pico": f"{r['horas'].most_common(1)[0][0]:02d}h" if r["horas"] else None,
            "devolvidos": itens_devolvidos.get(nome, 0),
            "esgotou": None,
            "perdido_estimado": None,
        }
        quando = esgotamentos.get(r.get("item_id")) if um_evento else None
        if quando and abertura and fechamento and quando > abertura:
            vendidos_antes = sum(
                l["qtd"] for l in linhas if l["nome"] == nome and hora_do_pedido[l["pedido_id"]] <= quando
            )
            ritmo = vendidos_antes / max((quando - abertura).total_seconds() / 3600, 0.25)
            restante = max((fechamento - quando).total_seconds() / 3600, 0)
            linha["esgotou"] = quando.strftime("%H:%M")
            linha["perdido_estimado"] = round(ritmo * restante)
        tabela.append(linha)
    return tabela


def _mapa_calor(validos, linhas, ranking, limite=10):
    hora_do_pedido = {p["uuid"]: p["hora"].hour for p in validos}
    nomes = [r["nome"] for r in sorted(ranking, key=lambda r: -r["qtd"])[:limite]]
    grade = defaultdict(Counter)
    for l in linhas:
        if l["nome"] in nomes:
            grade[l["nome"]][hora_do_pedido[l["pedido_id"]]] += l["qtd"]
    horas = sorted({h for c in grade.values() for h in c})
    if not horas:
        return {"horas": [], "linhas": []}
    faixa = list(range(horas[0], horas[-1] + 1))
    return {
        "horas": [f"{h:02d}h" for h in faixa],
        "linhas": [{"nome": n, "valores": [grade[n][h] for h in faixa]} for n in nomes],
    }


# =============================================================
#  Cesta: o que é comprado junto
# =============================================================


def _cesta(linhas, n_pedidos):
    por_pedido = defaultdict(set)
    for l in linhas:
        por_pedido[l["pedido_id"]].add(l["nome"])
    contagem = Counter()
    pares = Counter()
    for nomes in por_pedido.values():
        contagem.update(nomes)
        pares.update(combinations(sorted(nomes), 2))
    minimo = 3 if n_pedidos >= 60 else 2
    resultado = []
    for (a, b), juntos in pares.items():
        if juntos < minimo:
            continue
        lift = (juntos * n_pedidos) / (contagem[a] * contagem[b])
        if lift < 1.15:
            continue
        # confiança no sentido mais forte (quem leva o menos vendido, leva o outro?)
        base, outro = (a, b) if contagem[a] <= contagem[b] else (b, a)
        resultado.append(
            {
                "a": base,
                "b": outro,
                "juntos": juntos,
                "suporte": _pct(juntos, n_pedidos),
                "confianca": _pct(juntos, contagem[base]),
                "lift": round(lift, 2),
            }
        )
    resultado.sort(key=lambda r: (-r["lift"] * math.log(1 + r["juntos"])))
    return resultado[:10]


# =============================================================
#  Pagamento, troco e tamanho dos pedidos
# =============================================================


def _decompor_troco(centavos):
    resto, notas = centavos, Counter()
    for nota in NOTAS:
        n, resto = divmod(resto, nota * 100)
        if n:
            notas[nota] += n
    return notas, resto


def _pagamento(validos, linhas, um_evento):
    itens_por_pedido = Counter()
    for l in linhas:
        itens_por_pedido[l["pedido_id"]] += l["qtd"]
    tamanhos = Counter(min(itens_por_pedido[p["uuid"]], 6) for p in validos)
    tamanho = [{"rotulo": f"{n}" if n < 6 else "6+", "pedidos": tamanhos.get(n, 0)} for n in range(1, 7)]

    dinheiro = [p for p in validos if p["forma"] == "dinheiro" and p["recebido"]]
    como = Counter()
    for p in dinheiro:
        if p["recebido"] == p["total"]:
            como["Exato"] += 1
        elif p["recebido"] % 100 == 0 and p["recebido"] // 100 in NOTAS:
            como[f"R$ {p['recebido'] // 100}"] += 1
        else:
            como["Outro valor"] += 1
    ordem = ["Exato", *[f"R$ {n}" for n in sorted(NOTAS)], "Outro valor"]
    notas_recebidas = [{"rotulo": k, "pedidos": como[k]} for k in ordem if como[k]]

    # troco na hora mais pesada → quanto levar de troco
    troco_por_hora = defaultdict(int)
    notas_por_hora = defaultdict(Counter)
    moedas_por_hora = defaultdict(int)
    for p in dinheiro:
        if p["troco"] and p["troco"] > 0:
            chave = (p["evento_id"], p["hora"].replace(minute=0, second=0, microsecond=0))
            troco_por_hora[chave] += p["troco"]
            notas, moedas = _decompor_troco(p["troco"])
            notas_por_hora[chave].update(notas)
            moedas_por_hora[chave] += moedas
    sugestao = None
    if troco_por_hora:
        pior = max(troco_por_hora, key=troco_por_hora.get)
        # leva o bastante para 2 horas de pico, com 20% de folga
        fator = 2.4
        sugestao = {
            "hora": pior[1].strftime("%d/%m %Hh"),
            "troco_hora": troco_por_hora[pior],
            "valor": int(math.ceil(troco_por_hora[pior] * fator / 1000) * 1000),
            "notas": [
                {"nota": n, "qtd": int(math.ceil(notas_por_hora[pior][n] * fator))}
                for n in sorted(notas_por_hora[pior], reverse=True)
            ],
            "moedas": int(math.ceil(moedas_por_hora[pior] * fator / 100) * 100),
        }
    return {"tamanho": tamanho, "notas_recebidas": notas_recebidas, "troco": sugestao}


# =============================================================
#  Comparação entre eventos e previsão
# =============================================================


def _comparar_eventos(eventos, pessoa_id=None):
    linhas = []
    for evento in sorted(eventos, key=lambda e: e.inicio):
        pedidos, validos, itens, devolucoes, _ = _carregar([evento], pessoa_id)
        if not pedidos:
            continue
        k = _indicadores(pedidos, validos, itens, devolucoes)
        vendas = Counter()
        for l in itens:
            vendas[l["nome"]] += l["qtd"]
        linhas.append(
            {
                "id": evento.id,
                "nome": evento.nome,
                "data": _local(evento.inicio).strftime("%d/%m/%Y"),
                "campeao": vendas.most_common(1)[0][0] if vendas else None,
                **{c: k[c] for c in ("arrecadado", "pedidos", "ticket_medio", "pix_pct", "pessoas", "duracao_horas", "pedidos_por_hora", "itens")},
            }
        )
    return linhas


def _previsao(eventos_base):
    """Sugestão de quantidade por item para o próximo evento.

    Média dos últimos eventos; quando o item esgotou, soma a demanda que
    ficou sem atender (estimada pelo ritmo de venda antes de esgotar).
    """
    base = sorted(eventos_base, key=lambda e: e.inicio)[-5:]
    if not base:
        return {"eventos": 0, "itens": []}
    demanda = defaultdict(list)
    for evento in base:
        pedidos, validos, linhas, devolucoes, devolvidos = _carregar([evento])
        if not validos:
            continue
        for r in _itens(validos, linhas, [evento], True, devolvidos):
            demanda[r["nome"]].append(r["qtd"] + (r["perdido_estimado"] or 0))
    n = len([e for e in base if e.pedidos.exists()])
    itens = []
    for nome, valores in demanda.items():
        valores += [0] * (n - len(valores))
        media = sum(valores) / n
        itens.append(
            {
                "nome": nome,
                "media": round(media, 1),
                "minimo": min(valores),
                "maximo": max(valores),
                "sugestao": int(math.ceil(media * 1.1)),
            }
        )
    itens.sort(key=lambda r: -r["sugestao"])
    return {"eventos": n, "itens": itens}


# =============================================================
#  Frases automáticas
# =============================================================


def _brl(c):
    return f"R$ {c / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _n(valor):
    """12.5 → '12,5' (número no padrão brasileiro)"""
    return f"{valor:g}".replace(".", ",")


def _insights(k, fluxo, pessoas, itens, cesta, pagamento, variacao):
    frases = []
    blocos = [b for b in fluxo["blocos"] if b["dinheiro"] + b["pix"]]
    if blocos:
        pico = max(blocos, key=lambda b: b["dinheiro"] + b["pix"])
        n = pico["dinheiro"] + pico["pix"]
        janela = "nos 15 min de" if fluxo["tipo"] == "15min" else "na faixa das"
        frases.append(f"Pico de movimento {janela} {pico['rotulo']}: {n} pedidos ({_brl(pico['valor'])}).")
    if itens:
        a = [i for i in itens if i["classe"] == "A"]
        frases.append(
            f"{len(a)} de {len(itens)} itens fazem 80% da receita; o campeão é {itens[0]['nome']} "
            f"({_n(itens[0]['receita_pct'])}% da receita)."
        )
        for i in itens:
            if i["esgotou"] and i["perdido_estimado"]:
                frases.append(
                    f"{i['nome']} esgotou às {i['esgotou']}; no ritmo em que vendia, faltaram cerca de "
                    f"{i['perdido_estimado']} unidades."
                )
    if len(pessoas) > 1:
        com_ritmo = [p for p in pessoas if p["ritmo"]]
        if com_ritmo:
            rapida = max(com_ritmo, key=lambda p: p["ritmo"])
            frases.append(f"Atendimento mais ágil: {rapida['nome']}, {_n(rapida['ritmo'])} pedidos por hora ativa.")
    if cesta:
        c = cesta[0]
        frases.append(
            f"Quem pede {c['a']} leva {c['b']} em {_n(c['confianca'])}% das vezes ({_n(round(c['lift'], 1))}× mais que o acaso): "
            "bom candidato a combo."
        )
    if k["pix"]:
        frases.append(f"{_n(k['pix_pct'])}% do valor entrou por Pix.")
    if pagamento["troco"]:
        t = pagamento["troco"]
        frases.append(f"Fundo de troco sugerido: {_brl(t['valor'])} (na hora mais pesada, {t['hora']}, saíram {_brl(t['troco_hora'])}).")
    if variacao and variacao.get("arrecadado") is not None:
        v = variacao["arrecadado"]
        frases.append(
            f"Arrecadação {'acima' if v >= 0 else 'abaixo'} do evento anterior ({variacao['evento']}): "
            f"{'+' if v >= 0 else '−'}{_n(abs(v))}%."
        )
    return frases


# =============================================================
#  Ponto de entrada
# =============================================================


def analisar(evento_id=None, pessoa_id=None):
    todos = list(Evento.objects.order_by("inicio"))
    eventos = [e for e in todos if e.id == evento_id] if evento_id else todos
    um_evento = len(eventos) == 1
    pedidos, validos, linhas, devolucoes, devolvidos = _carregar(eventos, pessoa_id)

    k = _indicadores(pedidos, validos, linhas, devolucoes)
    variacao = None
    if um_evento:
        anteriores = [e for e in todos if e.inicio < eventos[0].inicio]
        if anteriores:
            ped_a, val_a, lin_a, dev_a, _ = _carregar([anteriores[-1]], pessoa_id)
            if val_a:
                variacao = _variacao(k, _indicadores(ped_a, val_a, lin_a, dev_a))
                variacao["evento"] = anteriores[-1].nome

    fluxo = _fluxo(validos, um_evento)
    pessoas = _pessoas(validos, linhas, pedidos, devolucoes)
    itens = _itens(validos, linhas, eventos, um_evento, devolvidos)
    cesta = _cesta(linhas, len(validos))
    pagamento = _pagamento(validos, linhas, um_evento)
    passados = [e for e in todos if not e.ativo] or todos

    return {
        "um_evento": um_evento,
        "indicadores": k,
        "variacao": variacao,
        "fluxo": fluxo,
        "pessoas": pessoas,
        "itens": itens,
        "mapa_calor": _mapa_calor(validos, linhas, itens),
        "cesta": cesta,
        "pagamento": pagamento,
        "eventos": _comparar_eventos(todos, pessoa_id) if not um_evento else [],
        "previsao": _previsao(passados) if not pessoa_id else {"eventos": 0, "itens": []},
        "insights": _insights(k, fluxo, pessoas, itens, cesta, pagamento, variacao),
    }
