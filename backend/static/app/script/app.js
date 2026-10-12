// =============================================================
//  VENDAS ONLINE · tela principal e finalizar pedido
//
//  Igual ao app offline para quem atende. A diferença está por trás:
//  cardápio, Pix e esgotados vêm do servidor, e cada pedido vai para lá
//  assim que houver internet (sem internet, tudo continua funcionando).
// =============================================================

import * as db from "./db.js";
import { criarSincronizador, novoId } from "./api.js";
import { pedirConexao } from "./conectar.js";
import { formatarDinheiro, reaisParaCentavos, lerValorDigitado } from "./dinheiro.js";
import { abrirTela, fecharTela, telaAberta, dialogoAberto, cancelarDialogo, confirmar, avisar, escaparHtml, vibrar } from "./ui.js";
import { iniciarMenu, abrirMenu, atualizarMenu } from "./menu.js";
import { erroConfiguracao, payloadDoPedido, qrSvg } from "./pix.js";
import {
  loja,
  aoMudar,
  avisarMudanca,
  itens,
  itemPorId,
  eventoAtual,
  dispositivo,
  configPix,
  proximoNumero,
  recarregarPedidos,
  registrarOperacao,
  guardarPedido,
} from "./loja.js";

const $ = (sel) => document.querySelector(sel);

// ---------- Estado da tela ----------

const estado = {
  /** ids na ordem em que foram tocados (o "Apagar" tira o último) */
  pedido: [],
  /** valor recebido na tela Finalizar, em centavos */
  recebido: 0,
  salvando: false,
};

const pixPronto = () => {
  const pix = configPix();
  return pix.ativo && !erroConfiguracao(pix);
};

function agruparPedido(ids = estado.pedido) {
  const grupos = new Map();
  for (const id of ids) {
    const item = itemPorId(id);
    if (!item) continue;
    const g = grupos.get(id) || { ...item, qtd: 0 };
    g.qtd++;
    grupos.set(id, g);
  }
  return [...grupos.values()];
}

const totalDoPedido = () => estado.pedido.reduce((soma, id) => soma + (itemPorId(id)?.preco || 0), 0);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function salvarPedidoAtual() {
  db.salvarConfig("pedidoAtual", estado.pedido).catch(() => {});
}

// ---------- Tela principal ----------

function renderizarGrade() {
  const lista = itens();
  // item que saiu do cardápio não pode ficar no pedido em andamento
  const antes = estado.pedido.length;
  estado.pedido = estado.pedido.filter((id) => itemPorId(id));
  if (estado.pedido.length !== antes) salvarPedidoAtual();

  $("#grade").innerHTML = lista.length
    ? lista
        .map((i) => {
          const imagem = i.imagem
            ? `<img src="${escaparHtml(i.imagem)}" alt="" width="256" height="256" decoding="async" draggable="false" />`
            : `<span class="semImagem" aria-hidden="true">${escaparHtml(i.nome.slice(0, 1))}</span>`;
          return `
      <button type="button" class="item${i.esgotado ? " esgotado" : ""}" data-id="${i.id}"
        ${i.esgotado ? `aria-disabled="true" aria-label="${escaparHtml(i.nome)}, esgotado"` : ""}>
        ${imagem}
        <span class="itemNome">${escaparHtml(i.nome)}</span>
        <span class="itemPreco">${i.esgotado ? "Esgotado" : formatarDinheiro(i.preco)}</span>
        <span class="itemQtd" hidden></span>
      </button>`;
        })
        .join("")
    : `<p class="vazio">${loja.servidor ? "Nenhum item no cardápio ainda. Cadastre os itens no painel de administração." : "Carregando o cardápio…"}</p>`;
  renderizarPedido();
}

function renderizarPedido() {
  const grupos = agruparPedido();
  const total = totalDoPedido();
  const qtd = estado.pedido.length;

  $("#listaPedido").innerHTML = grupos
    .map((g) => `<span class="chip"><b>${g.qtd}</b>${escaparHtml(g.nome)}</span>`)
    .join("");
  $("#listaPedido").scrollTop = $("#listaPedido").scrollHeight;

  $("#valorTotal").textContent = formatarDinheiro(total);
  $("#qtdItens").textContent = plural(qtd, "item", "itens");

  const porId = new Map(grupos.map((g) => [g.id, g.qtd]));
  document.querySelectorAll(".item").forEach((botao) => {
    const n = porId.get(Number(botao.dataset.id)) || 0;
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

/** Bolinha de sincronização no topo: some quando está tudo enviado */
function renderizarStatus() {
  const el = $("#statusSync");
  const { situacao, pendentes } = loja.status;
  let texto = "";
  let classe = "ok";
  if (situacao === "offline") {
    classe = "offline";
    texto = pendentes ? `offline · ${pendentes}` : "offline";
  } else if (pendentes) {
    classe = situacao === "erro" ? "erro" : "pendente";
    texto = plural(pendentes, "pendente", "pendentes");
  }
  el.className = `statusSync ${classe}`;
  el.querySelector("span").textContent = texto;
  el.title =
    classe === "ok"
      ? "Tudo enviado ao servidor"
      : classe === "offline"
        ? "Sem internet: as vendas ficam guardadas e vão quando a conexão voltar"
        : "Enviando para o servidor";
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
  prepararPix();
  definirRecebido(0);
  abrirTela($("#telaFinalizar"));
  $("#listaResumo").scrollTop = 0;
}

// O QR aparece sozinho com o valor do pedido. Se a pessoa digitar ou tocar
// numa nota (pagamento em dinheiro), o QR some e a tela volta ao normal.
function prepararPix() {
  const usar = pixPronto();
  $("#telaFinalizar").classList.toggle("comPix", usar);
  if (!usar) return;
  const pix = configPix();
  const total = totalDoPedido();
  $("#qrPix").innerHTML = qrSvg(payloadDoPedido(pix, total));
  $("#valorPix").textContent = formatarDinheiro(total);
  $("#recebedorPix").textContent = pix.nome;
}

function atualizarModoPix() {
  const mostrar = pixPronto() && estado.recebido === 0;
  $("#areaPix").hidden = !mostrar;
  $("#btnPagoPix").hidden = !mostrar;
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
  atualizarModoPix();
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

/** @param {"dinheiro"|"pix"} forma */
async function salvarPedido(forma = "dinheiro") {
  if (estado.salvando || !estado.pedido.length) return;
  const total = totalDoPedido();
  const pix = forma === "pix";

  if (!pix && estado.recebido > 0 && estado.recebido < total) {
    const seguir = await confirmar({
      titulo: `Falta ${formatarDinheiro(total - estado.recebido)}`,
      texto: "O valor recebido é menor que o total. Salvar mesmo assim?",
      ok: "Salvar",
    });
    if (!seguir) return;
  }

  estado.salvando = true;
  try {
    const disp = dispositivo();
    const numero = proximoNumero();
    const recebido = !pix && estado.recebido ? estado.recebido : null;
    const pedido = {
      uuid: novoId(),
      evento_id: eventoAtual()?.id ?? null,
      prefixo: disp?.prefixo || "",
      numero,
      codigo: `${disp?.prefixo || ""}-${numero}`,
      pessoa: disp?.pessoa || "",
      meu: true,
      criado_em: new Date().toISOString(),
      forma,
      total,
      recebido,
      troco: recebido ? recebido - total : null, // negativo = faltou dinheiro
      cancelado: false,
      itens: agruparPedido().map((g) => ({ item_id: g.id, nome: g.nome, preco: g.preco, qtd: g.qtd })),
      devolucoes: [],
      sincronizado: false,
    };
    // primeiro no aparelho (vale mesmo sem internet), depois na fila
    await guardarPedido(pedido);
    await registrarOperacao({
      tipo: "criar_pedido",
      uuid: pedido.uuid,
      evento_id: pedido.evento_id,
      numero,
      criado_em: pedido.criado_em,
      forma,
      recebido,
      itens: pedido.itens,
    });

    estado.pedido = [];
    renderizarPedido();
    salvarPedidoAtual();
    fecharTela();
    vibrar(30);
    avisar(`Pedido #${pedido.codigo} salvo · ${formatarDinheiro(total)}${pix ? " no Pix" : ""}`);
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
    const id = Number(botao.dataset.id);
    if (botao.classList.contains("esgotado")) {
      avisar(`${itemPorId(id)?.nome} está esgotado`);
      return;
    }
    adicionarItem(id);
  });

  $("#topo").addEventListener("click", contarToque);

  $("#btnResetar").addEventListener("click", resetarPedido);
  $("#btnFinalizar").addEventListener("click", abrirFinalizar);
  $("#btnApagar").addEventListener("click", apagarUltimo);

  $("#btnVoltar").addEventListener("click", fecharTela);
  $("#btnSalvar").addEventListener("click", () => salvarPedido("dinheiro"));
  $("#btnPagoPix").addEventListener("click", () => salvarPedido("pix"));

  const campo = $("#inputPago");
  campo.addEventListener("input", () => {
    let v = campo.value.replace(/[^\d,]/g, "");
    const [inteiro, ...resto] = v.split(",");
    v = resto.length ? `${inteiro},${resto.join("").slice(0, 2)}` : inteiro;
    if (v !== campo.value) campo.value = v;
    definirRecebido(lerValorDigitado(v), { atualizarCampo: false });
  });
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      campo.blur();
      salvarPedido("dinheiro");
    }
  });

  $("#notasRapidas").addEventListener("click", (e) => {
    const nota = e.target.closest(".nota[data-valor]");
    if (nota) definirRecebido(estado.recebido + reaisParaCentavos(nota.dataset.valor));
  });
  $("#btnExato").addEventListener("click", () => definirRecebido(totalDoPedido()));
  $("#btnLimparPago").addEventListener("click", () => definirRecebido(0));

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (dialogoAberto()) cancelarDialogo();
    else if (telaAberta()) fecharTela();
  });
}

// ---------- Início ----------

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  if (document.documentElement.dataset.debug === "1") {
    // em desenvolvimento o cache só atrapalha: tira o service worker
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    return;
  }
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((erro) => console.warn("Service worker falhou:", erro));
}

const MENSAGENS_RECUSA = {
  bloqueado: "bloqueado pelo administrador",
  invalido: "não aceito pelo servidor",
  nao_encontrado: "não encontrado no servidor",
};

async function iniciar() {
  ligarEventos();
  await db.iniciarBanco();

  loja.servidor = await db.lerConfig("servidor", null);
  loja.filtro = await db.lerConfig("filtro", "meus");
  await recarregarPedidos();
  estado.pedido = await db.lerConfig("pedidoAtual", []);
  renderizarGrade();

  const sincronizador = criarSincronizador({
    async aoMudarEstado(servidor) {
      loja.servidor = servidor;
      await recarregarPedidos();
      avisarMudanca("servidor");
    },
    aoMudarStatus(status) {
      loja.status = status;
      renderizarStatus();
      atualizarMenu("status");
    },
    async aoDesconectar(mensagem) {
      await conectarAparelho(mensagem);
    },
    aoRecusar(recusas) {
      const primeira = recusas[0];
      const quantas = recusas.length > 1 ? ` (+${recusas.length - 1})` : "";
      avisar(`${primeira.erro || MENSAGENS_RECUSA[primeira.codigo] || "Alteração recusada"}${quantas}`, { duracao: 5000 });
      recarregarPedidos().then(() => avisarMudanca("recusa"));
    },
  });
  loja.agendarSincronizacao = (ms) => sincronizador.agendar(ms);

  aoMudar((motivo) => {
    if (motivo === "servidor" || motivo === "itens") {
      renderizarGrade();
      const marca = loja.servidor?.config;
      if (marca?.nome_app) document.title = marca.nome_app;
      if (marca?.logo) document.querySelector(".logoConectar").src = marca.logo;
      if (marca?.nome_app) document.querySelector("#tituloConectar").textContent = marca.nome_app;
    }
    if (motivo === "fila") renderizarStatus();
    atualizarMenu(motivo);
  });

  iniciarMenu({
    /** "Desfazer último pedido": os itens voltam para a tela, se ela estiver vazia */
    restaurarNaTela(itensDoPedido) {
      if (estado.pedido.length) return false;
      estado.pedido = itensDoPedido.flatMap((i) => (itemPorId(i.item_id) ? Array(i.qtd).fill(i.item_id) : []));
      renderizarPedido();
      salvarPedidoAtual();
      return estado.pedido.length > 0;
    },
  });
  registrarServiceWorker();

  async function conectarAparelho(mensagem) {
    const marca = loja.servidor?.config;
    const { token } = await pedirConexao({ mensagem, nome: marca?.nome_app, logo: marca?.logo });
    await db.salvarConfig("token", token);
    await db.apagarConfig("servidor"); // aparelho novo: baixa tudo de novo
    loja.servidor = null;
    renderizarGrade();
    sincronizador.iniciar();
    avisar("Aparelho conectado");
  }

  if (await db.lerConfig("token")) sincronizador.iniciar();
  else await conectarAparelho();
}

iniciar();
