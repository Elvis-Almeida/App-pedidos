from django import template

register = template.Library()


@register.filter
def reais(centavos):
    """7550 → 'R$ 75,50'"""
    if centavos in (None, ""):
        return "—"
    texto = f"{int(centavos) / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {texto}"


@register.filter
def decimal_br(valor):
    """12.5 → '12,5'"""
    if valor in (None, ""):
        return "—"
    return f"{valor}".replace(".", ",")


@register.filter
def variacao(valor):
    """+12,5% / −3% (com sinal de verdade)"""
    if valor is None:
        return ""
    sinal = "+" if valor > 0 else "−" if valor < 0 else ""
    return f"{sinal}{abs(valor):g}%".replace(".", ",")
