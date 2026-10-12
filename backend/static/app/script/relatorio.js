// =============================================================
//  RELATÓRIO: totais, vendas por item e arquivo para exportar
// =============================================================

import { formatarDinheiro } from "./dinheiro.js";

const doisDigitos = (n) => String(n).padStart(2, "0");

export function formatarData(iso, { comAno = true } = {}) {
  const d = new Date(iso);
  const data = `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}` + (comAno ? `/${d.getFullYear()}` : "");
  return `${data} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

export function formatarHora(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hora = `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
  return mesmoDia ? hora : `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${hora}`;
}

/** "Recebido R$ 50,00 · Troco R$ 5,00"  ou  "… · Faltou R$ 2,00" */
export function textoPagamento(p) {
  if (!p.recebido) return "";
  const troco = p.troco ?? 0;
  return `Recebido ${formatarDinheiro(p.recebido)} · ${troco < 0 ? "Faltou" : "Troco"} ${formatarDinheiro(Math.abs(troco))}`;
}

export function textoItens(itens) {
  return itens.map((i) => `${i.qtd}× ${i.nome}`).join(", ");
}

/** Soma tudo: arrecadado, nº de pedidos, itens vendidos e ranking por item */
export function calcularResumo(pedidos) {
  const porItem = new Map();
  let arrecadado = 0;
  let itensVendidos = 0;
  let devolvido = 0;
  const porForma = { dinheiro: 0, pix: 0 };
  const porPessoa = new Map();

  for (const pedido of pedidos) {
    arrecadado += pedido.total;
    porForma[pedido.forma === "pix" ? "pix" : "dinheiro"] += pedido.total;
    const pessoa = porPessoa.get(pedido.pessoa) || { pessoa: pedido.pessoa || "—", pedidos: 0, total: 0 };
    pessoa.pedidos += 1;
    pessoa.total += pedido.total;
    porPessoa.set(pedido.pessoa, pessoa);
    for (const d of pedido.devolucoes || []) devolvido += d.valor;
    for (const item of pedido.itens) {
      itensVendidos += item.qtd;
      const atual = porItem.get(item.nome) || { nome: item.nome, qtd: 0, total: 0 };
      atual.qtd += item.qtd;
      atual.total += item.qtd * item.preco;
      porItem.set(item.nome, atual);
    }
  }

  const ranking = [...porItem.values()].sort((a, b) => b.qtd - a.qtd || b.total - a.total);
  return {
    arrecadado,
    quantidadePedidos: pedidos.length,
    itensVendidos,
    devolvido,
    porForma,
    porPessoa: [...porPessoa.values()].sort((a, b) => b.total - a.total),
    ticketMedio: pedidos.length ? Math.round(arrecadado / pedidos.length) : 0,
    ranking,
  };
}

export function gerarTextoRelatorio(pedidos, titulo = "") {
  const r = calcularResumo(pedidos);
  const linha = "=".repeat(40);
  const largura = Math.max(10, ...r.ranking.map((i) => i.nome.length), ...r.porPessoa.map((p) => p.pessoa.length));
  const partes = [];

  partes.push(`RELATÓRIO DE VENDAS${titulo ? ` · ${titulo}` : ""}`);
  partes.push(`Gerado em ${formatarData(new Date().toISOString())}`);
  if (pedidos.length) {
    partes.push(`Período: ${formatarData(pedidos[0].criado_em)} até ${formatarData(pedidos.at(-1).criado_em)}`);
  }
  partes.push(linha);
  partes.push(`Total arrecadado: ${formatarDinheiro(r.arrecadado)}`);
  if (r.porForma.pix) {
    partes.push(`  Em dinheiro:    ${formatarDinheiro(r.porForma.dinheiro)}`);
    partes.push(`  No Pix:         ${formatarDinheiro(r.porForma.pix)}`);
  }
  partes.push(`Pedidos:          ${r.quantidadePedidos}`);
  partes.push(`Itens vendidos:   ${r.itensVendidos}`);
  partes.push(`Ticket médio:     ${formatarDinheiro(r.ticketMedio)}`);
  if (r.devolvido) partes.push(`Devolvido:        ${formatarDinheiro(r.devolvido)} (já descontado do total)`);
  if (r.porPessoa.length > 1) {
    partes.push("");
    partes.push("VENDAS POR PESSOA");
    partes.push(linha);
    for (const p of r.porPessoa) {
      partes.push(`${String(p.pedidos).padStart(4)}  ${p.pessoa.padEnd(largura)}  ${formatarDinheiro(p.total)}`);
    }
  }
  partes.push("");
  partes.push("VENDAS POR ITEM");
  partes.push(linha);
  for (const item of r.ranking) {
    partes.push(`${String(item.qtd).padStart(4)}  ${item.nome.padEnd(largura)}  ${formatarDinheiro(item.total)}`);
  }
  partes.push("");
  partes.push("PEDIDOS");
  partes.push(linha);
  for (const p of pedidos) {
    let cabecalho = `#${p.codigo} · ${formatarData(p.criado_em)} · ${p.pessoa} · ${formatarDinheiro(p.total)}`;
    if (p.forma === "pix") cabecalho += " (Pix)";
    else if (p.recebido) cabecalho += ` (${textoPagamento(p)})`;
    partes.push(cabecalho);
    partes.push(`   ${textoItens(p.itens)}`);
    for (const d of p.devolucoes || []) {
      partes.push(`   ↩ devolvido ${formatarData(d.criado_em)}: ${textoItens(d.itens)} · ${formatarDinheiro(d.valor)}`);
    }
  }
  partes.push("");
  return partes.join("\r\n");
}

function nomeArquivo() {
  const d = new Date();
  return `relatorio-pedidos-${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}.txt`;
}

function criarArquivo(pedidos, titulo) {
  // \ufeff = BOM, para acentos aparecerem certos no Bloco de Notas
  return new File(["\ufeff" + gerarTextoRelatorio(pedidos, titulo)], nomeArquivo(), {
    type: "text/plain;charset=utf-8",
  });
}

export function baixarRelatorio(pedidos, titulo) {
  const arquivo = criarArquivo(pedidos, titulo);
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = arquivo.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function podeCompartilhar() {
  try {
    const teste = new File(["x"], "x.txt", { type: "text/plain" });
    return !!navigator.canShare?.({ files: [teste] });
  } catch {
    return false;
  }
}

/** Abre o "compartilhar" do celular (WhatsApp, e-mail, Drive…) */
export async function compartilharRelatorio(pedidos, titulo) {
  const arquivo = criarArquivo(pedidos, titulo);
  try {
    await navigator.share({ files: [arquivo], title: "Relatório de pedidos" });
    return true;
  } catch (erro) {
    if (erro?.name === "AbortError") return false; // usuário cancelou
    baixarRelatorio(pedidos, titulo);
    return true;
  }
}
