// =============================================================
//  PIX — gera o "copia e cola" (BR Code) e o QR Code com valor
//  Tudo no aparelho, sem internet e sem passar por servidor.
//
//  Padrão: Manual de Padrões para Iniciação do Pix (Banco Central),
//  formato EMV-MPM com CRC16-CCITT no final.
// =============================================================

import qrcode from "./vendor/qrcode.js";

export const TIPOS_CHAVE = {
  cpf: "CPF / CNPJ",
  celular: "Celular",
  email: "E-mail",
  aleatoria: "Chave aleatória",
};

export const PIX_PADRAO = { ativo: false, tipo: "cpf", chave: "", nome: "", cidade: "" };

/** Tira acentos e caracteres que alguns bancos não aceitam */
function textoSimples(texto, max) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max);
}

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

function cnpjValido(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(cnpj[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

/**
 * Coloca a chave no formato que o Pix exige e diz se está certa.
 * @returns {{ chave: string, erro: string|null }}
 */
export function normalizarChave(tipo, bruta) {
  const texto = String(bruta || "").trim();
  if (!texto) return { chave: "", erro: "Digite a chave Pix" };

  if (tipo === "cpf") {
    const n = texto.replace(/\D/g, "");
    if (n.length === 11) return { chave: n, erro: cpfValido(n) ? null : "CPF inválido" };
    if (n.length === 14) return { chave: n, erro: cnpjValido(n) ? null : "CNPJ inválido" };
    return { chave: n, erro: "CPF tem 11 números e CNPJ tem 14" };
  }
  if (tipo === "celular") {
    let n = texto.replace(/\D/g, "");
    if ((n.length === 12 || n.length === 13) && n.startsWith("55")) n = n.slice(2);
    if (n.length !== 10 && n.length !== 11) return { chave: n, erro: "Use DDD + número, ex.: (11) 98765-4321" };
    return { chave: "+55" + n, erro: null };
  }
  if (tipo === "email") {
    const e = texto.toLowerCase();
    return { chave: e, erro: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77 ? null : "E-mail inválido" };
  }
  // chave aleatória (EVP): 32 hexadecimais com hífens
  const evp = texto.toLowerCase();
  return {
    chave: evp,
    erro: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(evp)
      ? null
      : "Chave aleatória tem o formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  };
}

/** Confere se a configuração está pronta para gerar QR. Devolve o erro ou null. */
export function erroConfiguracao(config) {
  const { erro } = normalizarChave(config.tipo, config.chave);
  if (erro) return erro;
  if (!textoSimples(config.nome, 25)) return "Digite o nome de quem recebe";
  return null;
}

// ---------- BR Code ----------

const campo = (id, valor) => id + String(valor.length).padStart(2, "0") + valor;

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF) — exigido pelo Pix */
export function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Monta o código "copia e cola".
 * @param {{chave:string, nome:string, cidade?:string, valor?:number, txid?:string}} d
 *        valor em centavos (0/undefined = cliente digita o valor)
 */
export function gerarPayload({ chave, nome, cidade, valor, txid = "***" }) {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave);
  let payload =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (valor ? campo("54", (valor / 100).toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", textoSimples(nome, 25)) +
    campo("60", textoSimples(cidade, 15) || "BRASIL") +
    campo("62", campo("05", txid));
  payload += "6304";
  return payload + crc16(payload);
}

/** Payload pronto a partir da configuração salva + valor em centavos */
export function payloadDoPedido(config, valor) {
  const { chave } = normalizarChave(config.tipo, config.chave);
  return gerarPayload({ chave, nome: config.nome, cidade: config.cidade, valor });
}

/** Desenha o QR em SVG (nítido em qualquer tamanho) */
export function qrSvg(texto) {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const margem = 3;
  let caminho = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) caminho += `M${x + margem} ${y + margem}h1v1h-1z`;
    }
  }
  const total = n + margem * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR Code Pix">
    <rect width="${total}" height="${total}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}
