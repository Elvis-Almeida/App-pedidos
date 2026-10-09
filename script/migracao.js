// =============================================================
//  MIGRAÇÃO do histórico da versão antiga (localStorage → IndexedDB)
//  Roda uma vez só. Os dados antigos NÃO são apagados do
//  localStorage, por segurança — só deixam de ser usados.
// =============================================================

import { adicionarVariosPedidos } from "./db.js";
import { lerValorFormatado, reaisParaCentavos } from "./dinheiro.js";

const MARCA = "scj-migrado-indexeddb";

// Formato antigo de cada pedido salvo:
// "-------- 3 -------- <br> 24/05/2025 - 19:40 <br> <br> {itens} Total = R$ 75,00 <br> <br> "
const REGEX_PEDIDO =
  /-+\s*(\d+)\s*-+\s*<br>\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})\s*<br>\s*<br>([\s\S]*?)Total\s*=\s*(R\$\s*[\d.,]+)/g;

function lerItens(htmlItens, cardapio) {
  const precoDe = (nome) => {
    const item = cardapio.find((c) => c.nome === nome);
    return item ? reaisParaCentavos(item.preco) : 0;
  };

  // Formato mais novo: <div class='itemPedidoLinha'><span class='itemNome'>…
  if (htmlItens.includes("itemPedidoLinha")) {
    const doc = new DOMParser().parseFromString(htmlItens, "text/html");
    return [...doc.querySelectorAll(".itemPedidoLinha")].map((linha) => {
      const nome = linha.querySelector(".itemNome")?.textContent.trim() || "?";
      const qtd = parseInt(linha.querySelector(".itemQtd")?.textContent.replace(/\D/g, ""), 10) || 1;
      const subtotal = lerValorFormatado(linha.querySelector(".itemPreco")?.textContent || "");
      return { nome, qtd, preco: subtotal ? Math.round(subtotal / qtd) : precoDe(nome) };
    });
  }

  // Formato mais antigo: "2 Caldo,<br> 1 Misto,<br>"
  const texto = htmlItens.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
  const itens = [];
  for (const [, qtd, nome] of texto.matchAll(/(\d+)\s+([^,]+?)\s*,/g)) {
    itens.push({ nome, qtd: parseInt(qtd, 10), preco: precoDe(nome) });
  }
  return itens;
}

export async function migrarHistoricoAntigo(cardapio) {
  try {
    if (localStorage.getItem(MARCA)) return 0;

    // Chaves temporárias da versão antiga, sem valor
    localStorage.removeItem("totalPedido");
    localStorage.removeItem("historicoDeInserção");

    const antigo = localStorage.getItem("historicoDePedidos") || "";
    const pedidos = [];
    for (const m of antigo.matchAll(REGEX_PEDIDO)) {
      const [, numero, dia, mes, ano, hora, minuto, htmlItens, total] = m;
      const itens = lerItens(htmlItens, cardapio);
      if (!itens.length) continue;
      pedidos.push({
        numero: parseInt(numero, 10),
        data: new Date(+ano, +mes - 1, +dia, +hora, +minuto).toISOString(),
        itens,
        total: lerValorFormatado(total),
        recebido: null,
        troco: null,
        migrado: true,
      });
    }

    if (pedidos.length) await adicionarVariosPedidos(pedidos);
    localStorage.setItem(MARCA, new Date().toISOString());
    return pedidos.length;
  } catch (erro) {
    console.warn("Não foi possível migrar o histórico antigo:", erro);
    return 0;
  }
}
