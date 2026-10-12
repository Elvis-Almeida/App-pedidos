"""
Validação da chave Pix no servidor (mesmas regras do app, em script/pix.js).
O QR em si é gerado no aparelho, offline.
"""

import re
import unicodedata

TIPOS_CHAVE = {
    "cpf": "CPF / CNPJ",
    "celular": "Celular",
    "email": "E-mail",
    "aleatoria": "Chave aleatória",
}


def texto_simples(texto, maximo):
    sem_acento = unicodedata.normalize("NFD", str(texto or ""))
    sem_acento = "".join(c for c in sem_acento if unicodedata.category(c) != "Mn")
    sem_acento = re.sub(r"[^A-Za-z0-9 .,\-]", "", sem_acento)
    return re.sub(r"\s+", " ", sem_acento).strip().upper()[:maximo]


def _cpf_valido(cpf):
    if not re.fullmatch(r"\d{11}", cpf) or len(set(cpf)) == 1:
        return False

    def dv(n):
        soma = sum(int(cpf[i]) * (n + 1 - i) for i in range(n))
        resto = (soma * 10) % 11
        return 0 if resto == 10 else resto

    return dv(9) == int(cpf[9]) and dv(10) == int(cpf[10])


def _cnpj_valido(cnpj):
    if not re.fullmatch(r"\d{14}", cnpj) or len(set(cnpj)) == 1:
        return False

    def dv(n):
        pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if n == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        resto = sum(int(cnpj[i]) * p for i, p in enumerate(pesos)) % 11
        return 0 if resto < 2 else 11 - resto

    return dv(12) == int(cnpj[12]) and dv(13) == int(cnpj[13])


def normalizar_chave(tipo, bruta):
    """Devolve (chave_normalizada, erro_ou_None)."""
    texto = str(bruta or "").strip()
    if not texto:
        return "", "Digite a chave Pix"
    if tipo == "cpf":
        n = re.sub(r"\D", "", texto)
        if len(n) == 11:
            return n, None if _cpf_valido(n) else "CPF inválido"
        if len(n) == 14:
            return n, None if _cnpj_valido(n) else "CNPJ inválido"
        return n, "CPF tem 11 números e CNPJ tem 14"
    if tipo == "celular":
        n = re.sub(r"\D", "", texto)
        if len(n) in (12, 13) and n.startswith("55"):
            n = n[2:]
        if len(n) not in (10, 11):
            return n, "Use DDD + número, ex.: (11) 98765-4321"
        return "+55" + n, None
    if tipo == "email":
        e = texto.lower()
        ok = re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", e) and len(e) <= 77
        return e, None if ok else "E-mail inválido"
    if tipo == "aleatoria":
        evp = texto.lower()
        ok = re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", evp)
        return evp, None if ok else "Chave aleatória tem o formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    return texto, "Tipo de chave desconhecido"


def erro_configuracao_pix(tipo, chave, nome):
    _, erro = normalizar_chave(tipo, chave)
    if erro:
        return erro
    if not texto_simples(nome, 25):
        return "Digite o nome de quem recebe"
    return None
