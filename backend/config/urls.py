from django.contrib import admin
from django.urls import path, re_path

from vendas import api, views

urlpatterns = [
    # App (PWA)
    path("", views.index, name="app"),
    path("manifest.webmanifest", views.manifest, name="manifest"),
    path("sw.js", views.service_worker, name="sw"),
    re_path(r"^media/(?P<caminho>.+)$", views.media, name="media"),
    # API dos aparelhos
    path("api/auth/convite/", api.conectar_com_convite, name="api-convite"),
    path("api/estado/", api.estado, name="api-estado"),
    path("api/sincronizar/", api.sincronizar, name="api-sincronizar"),
    path("healthz", api.saude, name="saude"),
    # Admin (com o visual do app e o dashboard)
    path("admin/", admin.site.urls),
]
