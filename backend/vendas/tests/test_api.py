import json
import uuid
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from vendas.models import Configuracao, Convite, Dispositivo, Evento, Item, Pedido, Pessoa, RegistroAlteracao


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.ana = Pessoa.objects.create(nome="Ana Souza")
        self.beto = Pessoa.objects.create(nome="Beto Lima")
        self.caldo = Item.objects.create(nome="Caldo", preco=500, ordem=1)
        self.espeto = Item.objects.create(nome="Espetinho", preco=2000, ordem=2)

    def conectar(self, pessoa, aparelho="Teste"):
        convite = Convite.objects.create(pessoa=pessoa)
        r = self.client.post("/api/auth/convite/", {"codigo": convite.codigo, "aparelho": aparelho}, "application/json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["token"]

    def get(self, token, desde=0):
        r = self.client.get(f"/api/estado/?desde={desde}", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def sync(self, token, ops):
        r = self.client.post(
            "/api/sincronizar/", {"operacoes": ops}, "application/json", HTTP_AUTHORIZATION=f"Bearer {token}"
        )
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["resultados"]

    def pedido_op(self, numero=1, itens=None, **extra):
        itens = itens or [
            {"item_id": self.caldo.id, "nome": "Caldo", "preco": 500, "qtd": 2},
            {"item_id": self.espeto.id, "nome": "Espetinho", "preco": 2000, "qtd": 1},
        ]
        return {
            "id": str(uuid.uuid4()),
            "tipo": "criar_pedido",
            "uuid": str(uuid.uuid4()),
            "numero": numero,
            "criado_em": timezone.now().isoformat(),
            "forma": "dinheiro",
            "recebido": 5000,
            "itens": itens,
            **extra,
        }


class ConviteTests(Base):
    def test_conecta_uma_vez_so(self):
        convite = Convite.objects.create(pessoa=self.ana)
        r1 = self.client.post("/api/auth/convite/", {"codigo": convite.codigo.lower().replace("-", " ")}, "application/json")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r1.json()["dispositivo"]["prefixo"], "AS")
        r2 = self.client.post("/api/auth/convite/", {"codigo": convite.codigo}, "application/json")
        self.assertEqual(r2.status_code, 400)
        self.assertIn("já foi usado", r2.json()["erro"])

    def test_expirado_revogado_inexistente(self):
        c1 = Convite.objects.create(pessoa=self.ana, expira_em=timezone.now() - timedelta(days=1))
        c2 = Convite.objects.create(pessoa=self.ana, revogado=True)
        for codigo, texto in [(c1.codigo, "expirou"), (c2.codigo, "cancelado"), ("ZZZZ-ZZZZ", "não encontrado")]:
            r = self.client.post("/api/auth/convite/", {"codigo": codigo}, "application/json")
            self.assertEqual(r.status_code, 400)
            self.assertIn(texto, r.json()["erro"])

    def test_token_e_desconexao(self):
        token = self.conectar(self.ana)
        self.assertEqual(self.get(token)["dispositivo"]["pessoa"], "Ana Souza")
        Dispositivo.objects.update(ativo=False)
        r = self.client.get("/api/estado/", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(r.status_code, 401)
        r = self.client.get("/api/estado/", HTTP_AUTHORIZATION="Bearer falso")
        self.assertEqual(r.status_code, 401)

    def test_limite_de_tentativas(self):
        for _ in range(10):
            self.client.post("/api/auth/convite/", {"codigo": "AAAA-BBBB"}, "application/json")
        r = self.client.post("/api/auth/convite/", {"codigo": "AAAA-BBBB"}, "application/json")
        self.assertEqual(r.status_code, 429)

    def test_prefixos_unicos(self):
        self.conectar(self.ana)
        self.conectar(self.ana)
        self.assertEqual(sorted(Dispositivo.objects.values_list("prefixo", flat=True)), ["AS", "AS2"])


class EstadoTests(Base):
    def test_estado_completo_abre_evento(self):
        token = self.conectar(self.ana)
        e = self.get(token)
        self.assertTrue(e["completo"])
        self.assertEqual([i["nome"] for i in e["itens"]], ["Caldo", "Espetinho"])
        self.assertTrue(Evento.objects.get(ativo=True).nome.startswith("Vendas de"))
        self.assertEqual(e["config"]["pix"]["ativo"], False)

    def test_incremental_e_troca_de_evento(self):
        a, b = self.conectar(self.ana), self.conectar(self.beto)
        e0 = self.get(b)
        self.sync(a, [self.pedido_op()])
        e1 = self.get(b, e0["rev"])
        self.assertFalse(e1["completo"])
        self.assertEqual(len(e1["pedidos"]), 1)
        self.assertFalse(e1["pedidos"][0]["meu"])
        self.assertEqual(e1["pedidos"][0]["codigo"], "AS-1")
        self.assertEqual(self.get(b, e1["rev"])["pedidos"], [])
        Evento.objects.create(nome="Festa", ativo=True)
        e2 = self.get(b, e1["rev"])
        self.assertTrue(e2["completo"])
        self.assertEqual(e2["evento"]["nome"], "Festa")
        self.assertEqual(e2["pedidos"], [])


class PedidoTests(Base):
    def test_cria_e_reenvio_nao_duplica(self):
        token = self.conectar(self.ana)
        op = self.pedido_op()
        r1 = self.sync(token, [op])
        r2 = self.sync(token, [op])
        self.assertTrue(r1[0]["ok"] and r2[0]["ok"])
        self.assertEqual(Pedido.objects.count(), 1)
        p = Pedido.objects.get()
        self.assertEqual((p.total, p.troco, p.pessoa, p.codigo), (3000, 2000, self.ana, "AS-1"))

    def test_numero_repetido_vira_proximo(self):
        token = self.conectar(self.ana)
        self.sync(token, [self.pedido_op(numero=1), self.pedido_op(numero=1)])
        self.assertEqual(sorted(Pedido.objects.values_list("numero", flat=True)), [1, 2])

    def test_pix_sem_troco(self):
        token = self.conectar(self.ana)
        self.sync(token, [self.pedido_op(forma="pix")])
        p = Pedido.objects.get()
        self.assertEqual((p.forma, p.recebido, p.troco), ("pix", None, None))

    def test_devolucao_e_desfazer(self):
        token = self.conectar(self.ana)
        criar = self.pedido_op()
        self.sync(token, [criar])
        dev_id = str(uuid.uuid4())
        dev = {"id": "d1", "tipo": "devolver", "uuid": dev_id, "pedido_uuid": criar["uuid"],
               "itens": [{"item_id": self.caldo.id, "nome": "Caldo", "qtd": 1}]}
        r = self.sync(token, [dev, dev])  # repetido de propósito
        self.assertTrue(r[0]["ok"] and r[1]["ok"])
        p = Pedido.objects.get()
        self.assertEqual(p.total, 2500)
        self.assertEqual(p.devolucoes.count(), 1)
        self.assertEqual(r[0]["pedido"]["itens"][0]["qtd"], 1)
        self.sync(token, [{"id": "u", "tipo": "desfazer_devolucao", "devolucao_uuid": dev_id}])
        p.refresh_from_db()
        self.assertEqual((p.total, p.devolucoes.count()), (3000, 0))

    def test_devolucao_total_cancela(self):
        token = self.conectar(self.ana)
        criar = self.pedido_op(itens=[{"item_id": self.caldo.id, "nome": "Caldo", "preco": 500, "qtd": 1}])
        self.sync(token, [criar, {"id": "d", "tipo": "devolver", "uuid": str(uuid.uuid4()),
                                   "pedido_uuid": criar["uuid"], "itens": [{"nome": "Caldo", "qtd": 1}]}])
        self.assertTrue(Pedido.objects.get().cancelado)

    def test_cancelar_e_restaurar(self):
        token = self.conectar(self.ana)
        criar = self.pedido_op()
        self.sync(token, [criar])
        self.sync(token, [{"id": "c", "tipo": "cancelar_pedido", "pedido_uuid": criar["uuid"]}])
        self.assertTrue(Pedido.objects.get().cancelado)
        self.sync(token, [{"id": "r", "tipo": "restaurar_pedido", "pedido_uuid": criar["uuid"]}])
        self.assertFalse(Pedido.objects.get().cancelado)

    def test_nao_altera_pedido_de_outro_aparelho(self):
        a, b = self.conectar(self.ana), self.conectar(self.beto)
        criar = self.pedido_op()
        self.sync(a, [criar])
        r = self.sync(b, [{"id": "c", "tipo": "cancelar_pedido", "pedido_uuid": criar["uuid"]}])
        self.assertEqual(r[0]["codigo"], "bloqueado")
        self.assertFalse(Pedido.objects.get().cancelado)


class BloqueioTests(Base):
    def test_bloqueio_geral_de_pedidos_enviados(self):
        token = self.conectar(self.ana)
        enviado = self.pedido_op()
        self.sync(token, [enviado])
        config = Configuracao.atual()
        config.bloquear_alteracao_pedidos = True
        config.save()

        r = self.sync(token, [{"id": "c", "tipo": "cancelar_pedido", "pedido_uuid": enviado["uuid"]}])
        self.assertEqual(r[0]["codigo"], "bloqueado")
        self.assertFalse(r[0]["pedido"]["cancelado"])  # devolve a versão do servidor
        self.assertTrue(RegistroAlteracao.objects.filter(tipo="bloqueado").exists())

        # pedido feito offline e corrigido antes de chegar ao servidor: pode
        novo = self.pedido_op(numero=2)
        r = self.sync(token, [novo, {"id": "c2", "tipo": "cancelar_pedido", "pedido_uuid": novo["uuid"]}])
        self.assertTrue(r[1]["ok"])
        self.assertFalse(self.get(token)["dispositivo"]["permissoes"]["alterar_pedidos"])

    def test_permissao_por_aparelho(self):
        a, b = self.conectar(self.ana), self.conectar(self.beto)
        Dispositivo.objects.filter(pessoa=self.beto).update(pode_editar_itens=False, pode_editar_pix=False)
        op = {"id": "e", "tipo": "item_esgotado", "item_id": self.caldo.id, "esgotado": True}
        self.assertEqual(self.sync(b, [op])[0]["codigo"], "bloqueado")
        self.assertTrue(self.sync(a, [op])[0]["ok"])
        self.caldo.refresh_from_db()
        self.assertTrue(self.caldo.esgotado)
        # o outro aparelho recebe a mudança
        self.assertTrue(next(i for i in self.get(b)["itens"] if i["id"] == self.caldo.id)["esgotado"])

    def test_bloqueio_geral_de_itens_e_pix(self):
        token = self.conectar(self.ana)
        config = Configuracao.atual()
        config.bloquear_edicao_itens = config.bloquear_edicao_pix = True
        config.save()
        r = self.sync(token, [
            {"id": "e", "tipo": "item_esgotado", "item_id": self.caldo.id, "esgotado": True},
            {"id": "p", "tipo": "pix", "pix": {"ativo": False, "tipo": "email", "chave": "a@b.com", "nome": "X"}},
        ])
        self.assertEqual([x["codigo"] for x in r], ["bloqueado", "bloqueado"])

    def test_pix_valida_e_propaga(self):
        a, b = self.conectar(self.ana), self.conectar(self.beto)
        ruim = {"id": "p1", "tipo": "pix", "pix": {"ativo": True, "tipo": "cpf", "chave": "111.111.111-11", "nome": "Igreja"}}
        self.assertEqual(self.sync(a, [ruim])[0]["codigo"], "invalido")
        bom = {"id": "p2", "tipo": "pix", "pix": {"ativo": True, "tipo": "celular", "chave": "(81) 99999-1234",
                                                  "nome": "Paróquia", "cidade": "Recife"}}
        self.assertTrue(self.sync(a, [bom])[0]["ok"])
        pix = self.get(b)["config"]["pix"]
        self.assertEqual((pix["ativo"], pix["chave"]), (True, "(81) 99999-1234"))
        self.assertIn("Ana Souza", self.get(b)["config"]["atualizado_por"])


class PaginasTests(TestCase):
    def test_paginas_do_app(self):
        self.assertEqual(self.client.get("/healthz").json(), {"ok": True})
        r = self.client.get("/manifest.webmanifest")
        self.assertEqual(r.json()["name"], "SCJ Pedidos")
        self.assertIn("Service-Worker-Allowed", self.client.get("/sw.js"))
        self.assertEqual(self.client.get("/").status_code, 200)


class AdminTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model

        self.admin = get_user_model().objects.create_superuser("adm", "a@b.com", "senha-admin-123")
        self.client.force_login(self.admin)

    def test_novo_evento_atual_pelo_admin(self):
        antigo = Evento.objects.create(nome="Antigo", ativo=True)
        r = self.client.post(
            "/admin/vendas/evento/add/",
            {"nome": "Novo", "inicio_0": "12/10/2026", "inicio_1": "18:00:00", "ativo": "on", "observacoes": ""},
        )
        self.assertEqual(r.status_code, 302, r.content[:2000])
        antigo.refresh_from_db()
        self.assertFalse(antigo.ativo)
        self.assertEqual(Evento.objects.get(ativo=True).nome, "Novo")

    def test_paginas_do_admin_abrem(self):
        Convite.objects.create(pessoa=Pessoa.objects.create(nome="Ana"))
        for url in ["/admin/", "/admin/?evento=0", "/admin/vendas/item/", "/admin/vendas/pessoa/",
                    "/admin/vendas/convite/", "/admin/vendas/dispositivo/", "/admin/vendas/pedido/",
                    "/admin/vendas/evento/", "/admin/vendas/registroalteracao/", "/admin/exportar.csv"]:
            r = self.client.get(url, follow=True)
            self.assertEqual(r.status_code, 200, url)
        r = self.client.get(f"/admin/vendas/convite/{Convite.objects.get().pk}/change/")
        self.assertContains(r, "<svg")  # QR do convite
