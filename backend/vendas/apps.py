from django.apps import AppConfig
from django.contrib.admin.apps import AdminConfig


class VendasConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "vendas"
    verbose_name = "Vendas"


class PainelAdminConfig(AdminConfig):
    """Admin do Django com o visual do app e o dashboard na página inicial."""

    default_site = "vendas.painel.PainelAdminSite"
