// =============================================================
//  SCJ - PEDIDOS · tela principal e finalizar pedido
// =============================================================

import { CARDAPIO } from "./cardapio.js";
import * as db from "./db.js";
import { formatarDinheiro, reaisParaCentavos, lerValorDigitado } from "./dinheiro.js";
import { migrarHistoricoAntigo } from "./migracao.js";
import { abrirTela, fecharTela, telaAberta, dialogoAberto, cancelarDialogo, confirmar, avisar, escaparHtml, vibrar } from "./ui.js";
import { iniciarMenu, abrirMenu } from "./menu.js";

const $ = (sel) => document.querySelector(sel);

// ---------- Cardápio preparado ----------

const criarId = (nome) =>
  nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** @type {{id:string, nome:string, preco:number, src:string}[]} preco em centavos */
const ITENS = CARDAPIO.map((c) => ({
  id: criarId(c.nome),
  nome: c.nome,
  preco: reaisParaCentavos(c.preco),
  src: `./images/alimentos/${c.imagem}`,
}));
const ITEM_POR_ID = new Map(ITENS.map((i) => [i.id, i]));

// ---------- Estado ----------

const estado = {
  /** ids na ordem em que foram tocados (o "Apagar" tira o último) */
  pedido: [],
  /** ids dos itens esgotados (escondidos da grade) */
  ocultos: new Set(),
  /** valor recebido na tela Finalizar, em centavos */
  recebido: 0,
  salvando: false,
};

function agruparPedido(ids = estado.pedido) {
  const grupos = new Map();
  for (const id of ids) {
    const item = ITEM_POR_ID.get(id);
    if (!item) continue;
    const g = grupos.get(id) || { ...item, qtd: 0 };
    g.qtd++;
    grupos.set(id, g);
  }
  return [...grupos.values()];
}

const totalDoPedido = () => estado.pedido.reduce((soma, id) => soma + (ITEM_POR_ID.get(id)?.preco || 0), 0);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function salvarPedidoAtual() {
  db.salvarConfig("pedidoAtual", estado.pedido).catch(() => {});
}

// ---------- Tela principal ----------

function renderizarGrade() {
  $("#grade").innerHTML = ITENS.map((i) => {
    const esgotado = estado.ocultos.has(i.id);
    return `
      <button type="button" class="item${esgotado ? " esgotado" : ""}" data-id="${i.id}"
        ${esgotado ? `aria-disabled="true" aria-label="${escaparHtml(i.nome)}, esgotado"` : ""}>
        <img src="${i.src}" alt="" width="256" height="256" decoding="async" draggable="false" />
        <span class="itemNome">${escaparHtml(i.nome)}</span>
        <span class="itemPreco">${esgotado ? "Esgotado" : formatarDinheiro(i.preco)}</span>
        <span class="itemQtd" hidden></span>
      </button>`;
  }).join("");
  renderizarPedido();
}

function renderizarPedido() {
  const grupos = agruparPedido();
  const total = totalDoPedido();
  const qtd = estado.pedido.length;

  $("#listaPedido").innerHTML = grupos
    .map((g) => `<span class="chip"><b>${g.qtd}</b>${escaparHtml(g.nome)}</span>`)
    .join("");
  // mantém o último item adicionado visível
  $("#listaPedido").scrollTop = $("#listaPedido").scrollHeight;

  $("#valorTotal").textContent = formatarDinheiro(total);
  $("#qtdItens").textContent = plural(qtd, "item", "itens");

  const porId = new Map(grupos.map((g) => [g.id, g.qtd]));
  document.querySelectorAll(".item").forEach((botao) => {
    const n = porId.get(botao.dataset.id) || 0;
    const badge = botao.querySelector(".itemQtd");
    badge.hidden = n === 0;
    badge.textContent = n;
    botao.classList.toggle("noPedido", n > 0);
  });

  const vazio = qtd === 0;
  for (const id of ["#btnResetar", "#btnFinalizar", "#btnApagar"]) {
    $(id).setAttribute("aria-disabled", String(vazio));
  }
}

function pulsar(el) {
  el.classList.remove("pulso");
  void el.offsetWidth;
  el.classList.add("pulso");
}

function adicionarItem(id) {
  estado.pedido.push(id);
  vibrar();
  renderizarPedido();
  salvarPedidoAtual();
  pulsar($("#caixaTotal"));
}

function apagarUltimo() {
  if (!estado.pedido.length) return;
  estado.pedido.pop();
  vibrar();
  renderizarPedido();
  salvarPedidoAtual();
}

function resetarPedido() {
  if (!estado.pedido.length) return;
  const anterior = [...estado.pedido];
  estado.pedido = [];
  renderizarPedido();
  salvarPedidoAtual();
  avisar("Pedido limpo", {
    acao: "Desfazer",
    aoAgir: () => {
      estado.pedido = anterior;
      renderizarPedido();
      salvarPedidoAtual();
    },
  });
}

// ---------- Finalizar pedido ----------

function abrirFinalizar() {
  if (!estado.pedido.length) {
    avisar("Adicione itens ao pedido primeiro");
    return;
  }
  const grupos = agruparPedido();
  $("#contadorItens").textContent = plural(estado.pedido.length, "item", "itens");
  $("#listaResumo").innerHTML = grupos
    .map(
      (g) => `
    <div class="linhaResumo">
      <span class="resumoNome">${escaparHtml(g.nome)}</span>
      <span class="resumoQtd">×${g.qtd}</span>
      <span class="resumoPreco">${formatarDinheiro(g.qtd * g.preco)}</span>
    </div>`,
    )
    .join("");
  $("#finTotal").textContent = formatarDinheiro(totalDoPedido());
  definirRecebido(0);
  abrirTela($("#telaFinalizar"));
  $("#listaResumo").scrollTop = 0;
}

function definirRecebido(centavos, { atualizarCampo = true } = {}) {
  estado.recebido = Math.max(0, centavos);
  if (atualizarCampo) {
    $("#inputPago").value = estado.recebido
      ? (estado.recebido / 100).toLocaleString("pt-BR", {
          minimumFractionDigits: estado.recebido % 100 ? 2 : 0,
          maximumFractionDigits: 2,
        })
      : "";
  }
  atualizarTroco();
}

function atualizarTroco() {
  const total = totalDoPedido();
  const box = $("#boxTroco");
  const diferenca = estado.recebido - total;

  box.classList.toggle("falta", estado.recebido > 0 && diferenca < 0);
  box.classList.toggle("ok", estado.recebido > 0 && diferenca >= 0);

  if (!estado.recebido) {
    $("#rotuloTroco").textContent = "Troco";
    $("#finTroco").textContent = "—";
  } else if (diferenca < 0) {
    $("#rotuloTroco").textContent = "Falta";
    $("#finTroco").textContent = formatarDinheiro(-diferenca);
  } else {
    $("#rotuloTroco").textContent = "Troco";
    $("#finTroco").textContent = formatarDinheiro(diferenca);
  }
}

async function proximoNumero() {
  const pedidos = await db.listarPedidos();
  return pedidos.reduce((max, p) => Math.max(max, p.numero || 0), 0) + 1;
}

async function salvarPedido() {
  if (estado.salvando || !estado.pedido.length) return;
  const total = totalDoPedido();

  if (estado.recebido > 0 && estado.recebido < total) {
    const seguir = await confirmar({
      titulo: `Falta ${formatarDinheiro(total - estado.recebido)}`,
      texto: "O valor recebido é menor que o total. Salvar mesmo assim?",
      ok: "Salvar",
    });
    if (!seguir) return;
  }

  estado.salvando = true;
  try {
    const numero = await proximoNumero();
    await db.adicionarPedido({
      numero,
      data: new Date().toISOString(),
      itens: agruparPedido().map((g) => ({ nome: g.nome, preco: g.preco, qtd: g.qtd })),
      total,
      recebido: estado.recebido || null,
      // negativo = faltou dinheiro
      troco: estado.recebido ? estado.recebido - total : null,
    });
    estado.pedido = [];
    renderizarPedido();
    salvarPedidoAtual();
    fecharTela();
    vibrar(30);
    avisar(`Pedido #${numero} salvo · ${formatarDinheiro(total)}`);
  } catch (erro) {
    console.error(erro);
    avisar("Não foi possível salvar o pedido. Tente de novo.");
  } finally {
    estado.salvando = false;
  }
}

// ---------- Menu secreto: 5 toques rápidos no topo ----------

let toques = [];
function contarToque() {
  const agora = Date.now();
  toques = toques.filter((t) => agora - t < 1800);
  toques.push(agora);
  if (toques.length >= 5) {
    toques = [];
    vibrar(40);
    abrirMenu();
  }
}

// ---------- Eventos ----------

function ligarEventos() {
  $("#grade").addEventListener("click", (e) => {
    const botao = e.target.closest(".item");
    if (!botao) return;
    if (botao.classList.contains("esgotado")) {
      avisar(`${ITEM_POR_ID.get(botao.dataset.id)?.nome} está esgotado`);
      return;
    }
    adicionarItem(botao.dataset.id);
  });

  $("#topo").addEventListener("click", contarToque);

  $("#btnResetar").addEventListener("click", resetarPedido);
  $("#btnFinalizar").addEventListener("click", abrirFinalizar);
  $("#btnApagar").addEventListener("click", apagarUltimo);

  $("#btnVoltar").addEventListener("click", fecharTela);
  $("#btnSalvar").addEventListener("click", salvarPedido);

  const campo = $("#inputPago");
  campo.addEventListener("input", () => {
    // só números e uma vírgula
    let v = campo.value.replace(/[^\d,]/g, "");
    const [inteiro, ...resto] = v.split(",");
    v = resto.length ? `${inteiro},${resto.join("").slice(0, 2)}` : inteiro;
    if (v !== campo.value) campo.value = v;
    definirRecebido(lerValorDigitado(v), { atualizarCampo: false });
  });
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      campo.blur();
      salvarPedido();
    }
  });

  $("#notasRapidas").addEventListener("click", (e) => {
    const nota = e.target.closest(".nota[data-valor]");
    if (nota) definirRecebido(estado.recebido + reaisParaCentavos(nota.dataset.valor));
  });
  $("#btnExato").addEventListener("click", () => definirRecebido(totalDoPedido()));
  $("#btnLimparPago").addEventListener("click", () => definirRecebido(0));

  // Esc fecha telas (no computador)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (dialogoAberto()) cancelarDialogo();
    else if (telaAberta()) fecharTela();
  });
}

// ---------- Início ----------

function registrarServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch((erro) => console.warn("Service worker falhou:", erro));
  }
}

async function iniciar() {
  ligarEventos();
  renderizarGrade(); // mostra a grade na hora, antes do banco responder

  await db.iniciarBanco();
  if (db.bancoEmMemoria()) {
    avisar("Atenção: este navegador não está salvando o histórico", { duracao: 6000 });
  }

  const migrados = await migrarHistoricoAntigo(CARDAPIO.map((c) => ({ nome: c.nome, preco: c.preco })));
  if (migrados) avisar(`${plural(migrados, "pedido antigo importado", "pedidos antigos importados")}`);

  estado.ocultos = new Set(await db.lerConfig("itensOcultos", []));
  const salvo = await db.lerConfig("pedidoAtual", []);
  estado.pedido = salvo.filter((id) => ITEM_POR_ID.has(id));

  iniciarMenu({
    itens: ITENS,
    getOcultos: () => estado.ocultos,
    async setOculto(id, oculto) {
      oculto ? estado.ocultos.add(id) : estado.ocultos.delete(id);
      await db.salvarConfig("itensOcultos", [...estado.ocultos]);
      renderizarGrade();
    },
    async mostrarTodos() {
      estado.ocultos.clear();
      await db.salvarConfig("itensOcultos", []);
      renderizarGrade();
    },
    /** Usado pelo "Desfazer último pedido": devolve os itens para a tela */
    restaurarNaTela(itens) {
      if (estado.pedido.length) return false;
      const porNome = new Map(ITENS.map((i) => [i.nome, i.id]));
      estado.pedido = itens.flatMap((i) => (porNome.has(i.nome) ? Array(i.qtd).fill(porNome.get(i.nome)) : []));
      renderizarPedido();
      salvarPedidoAtual();
      return estado.pedido.length > 0;
    },
  });

  renderizarGrade();
  registrarServiceWorker();
}

iniciar();
