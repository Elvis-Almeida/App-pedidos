"""
Roda ao subir o container, antes do gunicorn:

  1. migra o banco (com trava: duas réplicas subindo juntas não migram ao
     mesmo tempo)
  2. no primeiro uso (cardápio vazio), carrega o cardápio original com fotos
  3. se VENDAS_ADMIN_USUARIO e VENDAS_ADMIN_SENHA(_FILE) existirem e o usuário
     ainda não existir, cria o administrador

    python manage.py preparar
"""

import os
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection

TRAVA = 784512  # número qualquer, fixo: identifica a trava de migração


def _env(nome):
    arquivo = os.environ.get(f"VENDAS_{nome}_FILE")
    if arquivo and Path(arquivo).exists():
        return Path(arquivo).read_text().strip()
    return os.environ.get(f"VENDAS_{nome}", "")


class Command(BaseCommand):
    help = "Migra o banco (com trava), carrega o cardápio inicial e cria o admin, se configurado."

    def handle(self, *args, **opcoes):
        self._esperar_banco()
        postgres = connection.vendor == "postgresql"
        if postgres:
            with connection.cursor() as c:
                c.execute("SELECT pg_advisory_lock(%s)", [TRAVA])
        try:
            call_command("migrate", interactive=False, verbosity=1)
            from vendas.models import Item

            if not Item.objects.exists():
                call_command("carregar_cardapio")
            self._criar_admin()
        finally:
            if postgres:
                with connection.cursor() as c:
                    c.execute("SELECT pg_advisory_unlock(%s)", [TRAVA])

    def _esperar_banco(self, limite=90):
        """Na primeira subida da stack o Postgres pode ainda estar iniciando."""
        import time

        from django.db.utils import OperationalError

        inicio = time.monotonic()
        while True:
            try:
                connection.ensure_connection()
                return
            except OperationalError:
                if time.monotonic() - inicio > limite:
                    raise
                self.stdout.write("Esperando o banco ficar disponível…")
                connection.close()
                time.sleep(3)

    def _criar_admin(self):
        usuario, senha = _env("ADMIN_USUARIO"), _env("ADMIN_SENHA")
        if not (usuario and senha):
            return
        Usuario = get_user_model()
        if Usuario.objects.filter(username=usuario).exists():
            return
        Usuario.objects.create_superuser(username=usuario, email=_env("ADMIN_EMAIL") or None, password=senha)
        self.stdout.write(self.style.SUCCESS(f"Administrador “{usuario}” criado."))
