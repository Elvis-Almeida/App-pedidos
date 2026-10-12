from django.templatetags.static import static


def marca(request):
    """Nome e logo do app disponíveis em todos os templates (admin incluso)."""
    if not request.path.startswith("/admin"):
        return {}
    from .models import Configuracao

    config = Configuracao.atual()
    return {
        "marca_nome": config.nome_app,
        "marca_logo": config.icone_192.url if config.icone_192 else static("app/images/icone-padrao-192.png"),
        "marca_favicon": config.favicon_png.url if config.favicon_png else static("app/images/icone-padrao-192.png"),
    }
