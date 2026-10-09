// =============================================================
//  MENU SECRETO (abre com 5 toques rápidos no topo)
//  Abas: Resumo · Pedidos · Itens
// =============================================================

import * as db from "./db.js";
import { formatarDinheiro } from "./dinheiro.js";
import { abrirTela, fecharTela, confirmar, avisar, escaparHtml } from "./ui.js";
import {
  calcularResumo,
  formatarHora,
  textoItens,
  textoPagamento,
  baixarRelatorio,
  compartilharRelatorio,
  podeCompartilhar,
} from "./relatorio.js";

const $ = (sel) => document.querySelector(sel);

let ctx = null; // funções/dados vindos do app.js
let pedidos = [];
let abaAtual = "Resumo";

const ICONE_LIXO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

export function iniciarMenu(contexto) {
  ctx = contexto;

  $("#btnFecharMenu").addEventListener("click", fecharTela);
  ligarDevolucao();

  document.querySelector("#telaMenu .abas").addEventListener("click", (e) => {
    const aba = e.target.closest(".aba");
    if (aba) mostrarAba(aba.dataset.aba);
  });

  // Ações dentro dos painéis (delegação: o HTML é recriado a cada render)
  $("#telaMenu").addEventListener("click", async (e) => {
    const alvo = e.target.closest("[data-acao]");
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === "baixar") return exportar(false);
    if (acao === "compartilhar") return exportar(true);
    if (acao === "zerar") return zerarHistorico();
    if (acao === "desfazer") return desfazerUltimo();
    if (acao === "excluir") return excluir(Number(alvo.dataset.id));
    if (acao === "devolver") return abrirDevolucao(Number(alvo.dataset.id));
    if (acao === "mostrarTodos") {
      await ctx.mostrarTodos();
      renderizarItens();
    }
  });

  $("#painelItens").addEventListener("change", async (e) => {
    const chave = e.target.closest("input[data-id]");
    if (!chave) return;
    await ctx.setOculto(chave.dataset.id, !chave.checked);
    renderizarItens();
  });
}

export async function abrirMenu() {
  pedidos = await db.listarPedidos();
  mostrarAba(abaAtual);
  abrirTela($("#telaMenu"));
}

async function recarregar() {
  pedidos = await db.listarPedidos();
  mostrarAba(abaAtual);
}

function mostrarAba(nome) {
  abaAtual = nome;
  document.querySelectorAll("#telaMenu .aba").forEach((aba) => {
    aba.setAttribute("aria-selected", String(aba.dataset.aba === nome));
  });
  for (const painel of ["Resumo", "Pedidos", "Itens"]) {
    $(`#painel${painel}`).hidden = painel !== nome;
  }
  ({ Resumo: renderizarResumo, Pedidos: renderizarPedidos, Itens: renderizarItens })[nome]();
  $(`#painel${nome}`).scrollTop = 0;
}

// ---------- Aba Resumo ----------

function renderizarResumo() {
  const r = calcularResumo(pedidos);
  const maiorQtd = r.ranking[0]?.qtd || 1;
  const aviso = db.bancoEmMemoria()
    ? `<p class="alerta">Este navegador não está salvando os dados. Ao fechar o app, o histórico some.</p>`
    : "";

  $("#painelResumo").innerHTML = `
    ${aviso}
    <div class="cartoes">
      <div class="cartao destaque"><span>Total arrecadado</span><strong>${formatarDinheiro(r.arrecadado)}</strong></div>
      <div class="cartao"><span>Pedidos</span><strong>${r.quantidadePedidos}</strong></div>
      <div class="cartao"><span>Itens vendidos</span><strong>${r.itensVendidos}</strong></div>
      <div class="cartao"><span>Ticket médio</span><strong>${formatarDinheiro(r.ticketMedio)}</strong></div>
    </div>
    ${r.devolvido ? `<p class="notaDevolvido">↩ ${formatarDinheiro(r.devolvido)} devolvidos a clientes (já descontados do total)</p>` : ""}

    <h3 class="tituloSecao">Vendas por item</h3>
    ${
      r.ranking.length
        ? `<ol class="ranking">${r.ranking
            .map(
              (i) => `
          <li>
            <span class="barra" style="--p:${((i.qtd / maiorQtd) * 100).toFixed(1)}%"></span>
            <span class="rankQtd">${i.qtd}</span>
            <span class="rankNome">${escaparHtml(i.nome)}</span>
            <span class="rankTotal">${formatarDinheiro(i.total)}</span>
          </li>`,
            )
            .join("")}</ol>`
        : `<p class="vazio">Nenhum pedido salvo ainda.</p>`
    }

    <div class="acoesMenu">
      <button type="button" class="botao verde" data-acao="baixar" ${pedidos.length ? "" : "disabled"}>Baixar relatório</button>
      ${
        podeCompartilhar()
          ? `<button type="button" class="botao azul" data-acao="compartilhar" ${pedidos.length ? "" : "disabled"}>Compartilhar</button>`
          : ""
      }
    </div>
    <button type="button" class="botao contorno perigo" data-acao="zerar" ${pedidos.length ? "" : "disabled"}>
      Zerar histórico (novo evento)
    </button>
    <p class="rodape">Os dados ficam salvos só neste aparelho.</p>`;
}

async function exportar(compartilhar) {
  if (!pedidos.length) return;
  if (compartilhar) await compartilharRelatorio(pedidos);
  else {
    baixarRelatorio(pedidos);
    avisar("Relatório baixado");
  }
}

async function zerarHistorico() {
  const r = calcularResumo(pedidos);
  const ok = await confirmar({
    titulo: "Apagar todo o histórico?",
    texto: `${r.quantidadePedidos} pedidos · ${formatarDinheiro(r.arrecadado)}. Baixe o relatório antes — isso não pode ser desfeito.`,
    ok: "Apagar tudo",
    perigo: true,
  });
  if (!ok) return;
  await db.limparPedidos();
  await recarregar();
  avisar("Histórico zerado");
}

// ---------- Aba Pedidos ----------

function renderizarPedidos() {
  const ultimo = pedidos.at(-1);
  const lista = [...pedidos].reverse();

  $("#painelPedidos").innerHTML = `
    ${
      ultimo
        ? `<button type="button" class="botao contorno" data-acao="desfazer">
            Desfazer último pedido <small>#${ultimo.numero} · ${formatarDinheiro(ultimo.total)}</small>
          </button>`
        : ""
    }
    ${
      lista.length
        ? `<ul class="listaPedidos">${lista
            .map(
              (p) => `
          <li class="cartaoPedido">
            <div class="pedidoTopo">
              <span class="pedidoNumero">#${p.numero}</span>
              <span class="pedidoHora">${formatarHora(p.data)}</span>
              <strong class="pedidoTotal">${formatarDinheiro(p.total)}</strong>
              <button type="button" class="botaoIcone pequeno" data-acao="excluir" data-id="${p.id}" aria-label="Excluir pedido ${p.numero}">${ICONE_LIXO}</button>
            </div>
            <p class="pedidoItens">${escaparHtml(textoItens(p.itens))}</p>
            ${p.recebido ? `<p class="pedidoPagamento${p.troco < 0 ? " faltou" : ""}">${textoPagamento(p)}</p>` : ""}
            ${(p.devolucoes || [])
              .map(
                (d) =>
                  `<p class="pedidoDevolucao">↩ Devolvido ${formatarHora(d.data)}: ${escaparHtml(textoItens(d.itens))} · ${formatarDinheiro(d.valor)}</p>`,
              )
              .join("")}
            <button type="button" class="botao contorno pequeno botaoDevolver" data-acao="devolver" data-id="${p.id}">
              ↩ Devolver item
            </button>
          </li>`,
            )
            .join("")}</ul>`
        : `<p class="vazio">Nenhum pedido salvo ainda.</p>`
    }`;
}

async function desfazerUltimo() {
  const ultimo = pedidos.at(-1);
  if (!ultimo) return;
  const ok = await confirmar({
    titulo: `Desfazer pedido #${ultimo.numero}?`,
    texto: `${textoItens(ultimo.itens)} · ${formatarDinheiro(ultimo.total)}. Ele sai do histórico e, se a tela estiver vazia, os itens voltam para ela para você corrigir.`,
    ok: "Desfazer",
    perigo: true,
  });
  if (!ok) return;

  await db.excluirPedido(ultimo.id);
  const voltou = ctx.restaurarNaTela(ultimo.itens);
  if (voltou) {
    fecharTela();
    avisar(`Pedido #${ultimo.numero} desfeito · itens de volta na tela`);
  } else {
    await recarregar();
    avisar(`Pedido #${ultimo.numero} desfeito`);
  }
}

async function excluir(id) {
  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) return;
  const ok = await confirmar({
    titulo: `Excluir pedido #${pedido.numero}?`,
    texto: `${textoItens(pedido.itens)} · ${formatarDinheiro(pedido.total)}`,
    ok: "Excluir",
    perigo: true,
  });
  if (!ok) return;
  await db.excluirPedido(id);
  await recarregar();
  avisar(`Pedido #${pedido.numero} excluído`, {
    acao: "Desfazer",
    aoAgir: async () => {
      await db.adicionarPedido(pedido);
      await recarregar();
    },
  });
}

// ---------- Devolver itens de um pedido já salvo ----------
// Ex.: o cliente pagou 2 Caldos, só tinha 1 e voltou para pegar o dinheiro.
// O item sai do pedido, o total diminui e fica registrada a devolução.

let edicao = null; // { pedido, devolver: number[] }  (qtd devolvida por linha)

function abrirDevolucao(id) {
  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) return;
  edicao = { pedido, devolver: pedido.itens.map(() => 0) };
  $("#devolucaoTitulo").textContent = `Devolver itens do pedido #${pedido.numero}`;
  renderizarDevolucao();
  $("#devolucao").hidden = false;
  $("#devolucaoCancelar").focus({ preventScroll: true });
}

function fecharDevolucao() {
  $("#devolucao").hidden = true;
  edicao = null;
}

function valorDevolvido() {
  return edicao.pedido.itens.reduce((soma, item, i) => soma + item.preco * edicao.devolver[i], 0);
}

function renderizarDevolucao() {
  const { pedido, devolver } = edicao;
  $("#devolucaoLista").innerHTML = pedido.itens
    .map((item, i) => {
      const fica = item.qtd - devolver[i];
      return `
      <li class="${devolver[i] ? "comDevolucao" : ""}">
        <span class="devNome">${escaparHtml(item.nome)}
          <small>${formatarDinheiro(item.preco)} cada${devolver[i] ? ` · <b>devolver ${devolver[i]}</b>` : ""}</small>
        </span>
        <span class="contador">
          <button type="button" class="botaoIcone pequeno" data-mudar="-1" data-linha="${i}" aria-label="Devolver um ${escaparHtml(item.nome)}" ${fica === 0 ? "disabled" : ""}>−</button>
          <span class="contadorValor" aria-label="Fica no pedido">${fica}</span>
          <button type="button" class="botaoIcone pequeno" data-mudar="1" data-linha="${i}" aria-label="Manter um ${escaparHtml(item.nome)}" ${devolver[i] === 0 ? "disabled" : ""}>+</button>
        </span>
      </li>`;
    })
    .join("");

  const valor = valorDevolvido();
  const tudo = devolver.every((d, i) => d === pedido.itens[i].qtd);
  $("#devolucaoValor").innerHTML = valor
    ? `<span>Devolver ao cliente</span><strong>${formatarDinheiro(valor)}</strong>`
    : `<span>Nenhum item selecionado</span>`;
  $("#devolucaoValor").classList.toggle("ativo", valor > 0);

  const ok = $("#devolucaoOk");
  ok.disabled = valor === 0;
  ok.textContent = tudo ? "Devolver tudo" : "Confirmar";
}

async function confirmarDevolucao() {
  if (!edicao) return;
  const { pedido, devolver } = edicao;
  const valor = valorDevolvido();
  if (!valor) return;

  const itensDevolvidos = pedido.itens
    .map((item, i) => ({ nome: item.nome, preco: item.preco, qtd: devolver[i] }))
    .filter((i) => i.qtd > 0);
  const itensQueFicam = pedido.itens
    .map((item, i) => ({ ...item, qtd: item.qtd - devolver[i] }))
    .filter((i) => i.qtd > 0);
  const anterior = structuredClone(pedido);
  fecharDevolucao();

  // Devolveu tudo: o pedido deixa de existir
  if (!itensQueFicam.length) {
    await db.excluirPedido(pedido.id);
    await recarregar();
    avisar(`Pedido #${pedido.numero} devolvido inteiro · ${formatarDinheiro(valor)}`, {
      acao: "Desfazer",
      aoAgir: async () => {
        await db.adicionarPedido(anterior);
        await recarregar();
      },
    });
    return;
  }

  await db.atualizarPedido({
    ...pedido,
    itens: itensQueFicam,
    total: pedido.total - valor,
    devolucoes: [...(pedido.devolucoes || []), { data: new Date().toISOString(), itens: itensDevolvidos, valor }],
  });
  await recarregar();
  avisar(`Devolva ${formatarDinheiro(valor)} ao cliente`, {
    acao: "Desfazer",
    aoAgir: async () => {
      await db.atualizarPedido(anterior);
      await recarregar();
    },
  });
}

function ligarDevolucao() {
  $("#devolucaoLista").addEventListener("click", (e) => {
    const botao = e.target.closest("[data-mudar]");
    if (!botao || !edicao) return;
    const i = Number(botao.dataset.linha);
    const max = edicao.pedido.itens[i].qtd;
    // "-" tira do pedido (devolve mais um); "+" coloca de volta
    edicao.devolver[i] = Math.min(max, Math.max(0, edicao.devolver[i] - Number(botao.dataset.mudar)));
    renderizarDevolucao();
  });
  $("#devolucaoCancelar").addEventListener("click", fecharDevolucao);
  $("#devolucaoOk").addEventListener("click", confirmarDevolucao);
  $("#devolucao").addEventListener("click", (e) => e.target.id === "devolucao" && fecharDevolucao());
}

// ---------- Aba Itens (esgotados) ----------

function renderizarItens() {
  const ocultos = ctx.getOcultos();
  const disponiveis = ctx.itens.length - ocultos.size;

  $("#painelItens").innerHTML = `
    <div class="itensTopo">
      <span>${disponiveis} de ${ctx.itens.length} disponíveis</span>
      ${ocultos.size ? `<button type="button" class="botao contorno pequeno" data-acao="mostrarTodos">Mostrar todos</button>` : ""}
    </div>
    <p class="dicaMenu">Desligue o que acabou: o item fica cinza, marcado como esgotado, na tela de vendas.</p>
    <ul class="listaItens">
      ${ctx.itens
        .map((i) => {
          const disponivel = !ocultos.has(i.id);
          return `
        <li class="${disponivel ? "" : "esgotado"}">
          <label>
            <img src="${i.src}" alt="" width="40" height="40" />
            <span class="nomeItem">${escaparHtml(i.nome)}<small>${disponivel ? formatarDinheiro(i.preco) : "Esgotado"}</small></span>
            <input type="checkbox" role="switch" data-id="${i.id}" ${disponivel ? "checked" : ""} aria-label="${escaparHtml(i.nome)} disponível" />
            <span class="chave" aria-hidden="true"></span>
          </label>
        </li>`;
        })
        .join("")}
    </ul>`;
}
