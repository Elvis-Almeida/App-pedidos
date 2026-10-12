// =============================================================
//  MENU SECRETO (abre com 5 toques rápidos no topo)
//  Abas: Resumo · Pedidos · Itens · Pix
//
//  Versão online: Resumo e Pedidos têm o filtro "Meus / Todos"; mudanças em
//  Itens e Pix valem para todos os aparelhos; o admin pode bloquear edições.
// =============================================================

import * as db from "./db.js";
import { novoId } from "./api.js";
import { formatarDinheiro } from "./dinheiro.js";
import { abrirTela, fecharTela, telaAberta, confirmar, avisar, escaparHtml } from "./ui.js";
import {
  calcularResumo,
  formatarHora,
  textoItens,
  textoPagamento,
  baixarRelatorio,
  compartilharRelatorio,
  podeCompartilhar,
} from "./relatorio.js";
import { TIPOS_CHAVE, normalizarChave, erroConfiguracao, gerarPayload, qrSvg } from "./pix.js";
import {
  loja,
  avisarMudanca,
  itens,
  eventoAtual,
  dispositivo,
  configPix,
  permissoes,
  pedidosVisiveis,
  podeAlterar,
  recarregarPedidos,
  registrarOperacao,
  substituirOperacao,
  guardarPedido,
  esquecerPedidoNaoEnviado,
  devolverParaFila,
  alterarServidorLocal,
} from "./loja.js";

const $ = (sel) => document.querySelector(sel);

let ctx = { restaurarNaTela: () => false };
let abaAtual = "Resumo";

const ICONE_LIXO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const ICONE_CADEADO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

const bloqueio = (texto) => `<p class="bloqueioAdmin">${ICONE_CADEADO}<span>${texto}</span></p>`;

export function iniciarMenu(contexto = {}) {
  ctx = { ...ctx, ...contexto };

  $("#btnFecharMenu").addEventListener("click", fecharTela);
  ligarDevolucao();
  ligarPix();

  document.querySelector("#telaMenu .abas").addEventListener("click", (e) => {
    const aba = e.target.closest(".aba");
    if (aba) mostrarAba(aba.dataset.aba);
  });

  $("#telaMenu").addEventListener("click", async (e) => {
    const alvo = e.target.closest("[data-acao]");
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === "baixar") return exportar(false);
    if (acao === "compartilhar") return exportar(true);
    if (acao === "sincronizar") return loja.agendarSincronizacao(0);
    if (acao === "desfazer") return desfazerUltimo();
    if (acao === "excluir") return excluir(alvo.dataset.id);
    if (acao === "devolver") return abrirDevolucao(alvo.dataset.id);
    if (acao === "mostrarTodos") return mostrarTodosItens();
    if (acao === "filtro") {
      loja.filtro = alvo.dataset.valor;
      db.salvarConfig("filtro", loja.filtro).catch(() => {});
      mostrarAba(abaAtual);
    }
  });

  $("#painelItens").addEventListener("change", (e) => {
    const chave = e.target.closest("input[data-id]");
    if (chave) mudarEsgotado(Number(chave.dataset.id), !chave.checked, chave);
  });
}

export async function abrirMenu() {
  await recarregarPedidos();
  renderizarCabecalho();
  mostrarAba(abaAtual);
  abrirTela($("#telaMenu"));
}

/** Chamado quando chega coisa nova do servidor (ou a fila muda) */
export function atualizarMenu(motivo) {
  if (telaAberta() !== $("#telaMenu")) return;
  renderizarCabecalho();
  // não redesenha o formulário do Pix enquanto a pessoa digita
  if (abaAtual === "Pix" && $("#painelPix").contains(document.activeElement)) return;
  if (motivo === "status" && abaAtual !== "Resumo") return;
  const rolagem = $(`#painel${abaAtual}`).scrollTop;
  mostrarAba(abaAtual);
  $(`#painel${abaAtual}`).scrollTop = rolagem;
}

function renderizarCabecalho() {
  const disp = dispositivo();
  const evento = eventoAtual();
  $("#menuInfo").textContent = [evento?.nome, disp ? `${disp.pessoa} · ${disp.prefixo}` : null]
    .filter(Boolean)
    .join(" · ");
}

function mostrarAba(nome) {
  abaAtual = nome;
  document.querySelectorAll("#telaMenu .aba").forEach((aba) => {
    aba.setAttribute("aria-selected", String(aba.dataset.aba === nome));
  });
  for (const painel of ["Resumo", "Pedidos", "Itens", "Pix"]) {
    $(`#painel${painel}`).hidden = painel !== nome;
  }
  ({ Resumo: renderizarResumo, Pedidos: renderizarPedidos, Itens: renderizarItens, Pix: renderizarPix })[nome]();
}

function filtroHtml() {
  const botao = (valor, texto) =>
    `<button type="button" class="segmento" data-acao="filtro" data-valor="${valor}" aria-pressed="${loja.filtro === valor}">${texto}</button>`;
  return `<div class="filtro" role="group" aria-label="Mostrar pedidos">${botao("meus", "Meus")}${botao("todos", "Todos os aparelhos")}</div>`;
}

// ---------- Aba Resumo ----------

function textoStatus() {
  const { situacao, pendentes, ultima } = loja.status;
  const hora = ultima ? new Date(ultima).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
  if (situacao === "offline")
    return { classe: "offline", texto: `Sem internet${pendentes ? ` · ${pendentes} aguardando envio` : ""}` };
  if (situacao === "sincronizando") return { classe: "pendente", texto: "Sincronizando…" };
  if (situacao === "erro") return { classe: "erro", texto: `Servidor não respondeu${pendentes ? ` · ${pendentes} aguardando` : ""}` };
  if (pendentes) return { classe: "pendente", texto: `${pendentes} aguardando envio` };
  return { classe: "ok", texto: `Tudo enviado${hora ? ` · ${hora}` : ""}` };
}

function renderizarResumo() {
  const pedidos = pedidosVisiveis();
  const r = calcularResumo(pedidos);
  const maiorQtd = r.ranking[0]?.qtd || 1;
  const maiorPessoa = r.porPessoa[0]?.total || 1;
  const status = textoStatus();

  $("#painelResumo").innerHTML = `
    ${filtroHtml()}
    <div class="cartao destaque">
      <span class="cartaoRotulo">${loja.filtro === "todos" ? "Total do evento" : "Total que eu vendi"}</span>
      <strong class="cartaoValor">${formatarDinheiro(r.arrecadado)}</strong>
      <div class="rodapeDestaque">
        ${
          r.porForma.pix
            ? `<div class="linhaTicket"><span>Em dinheiro</span><strong>${formatarDinheiro(r.porForma.dinheiro)}</strong></div>
               <div class="linhaTicket"><span>No Pix</span><strong class="corPix">${formatarDinheiro(r.porForma.pix)}</strong></div>`
            : ""
        }
        <div class="linhaTicket"><span>Ticket médio</span><strong>${formatarDinheiro(r.ticketMedio)}</strong></div>
      </div>
    </div>
    <div class="cartoes">
      <div class="cartao">
        <span class="cartaoRotulo">Pedidos</span>
        <strong class="cartaoValor">${r.quantidadePedidos.toLocaleString("pt-BR")}</strong>
      </div>
      <div class="cartao">
        <span class="cartaoRotulo">Itens vendidos</span>
        <strong class="cartaoValor">${r.itensVendidos.toLocaleString("pt-BR")}</strong>
      </div>
    </div>
    ${r.devolvido ? `<p class="notaDevolvido">↩ ${formatarDinheiro(r.devolvido)} devolvidos a clientes (já descontados do total)</p>` : ""}

    ${
      loja.filtro === "todos" && r.porPessoa.length > 1
        ? `<h3 class="tituloSecao">Vendas por pessoa</h3>
           <ol class="ranking">${r.porPessoa
             .map(
               (p) => `
             <li>
               <span class="barra" style="--p:${((p.total / maiorPessoa) * 100).toFixed(1)}%"></span>
               <span class="rankQtd">${p.pedidos}</span>
               <span class="rankNome">${escaparHtml(p.pessoa)}</span>
               <span class="rankTotal">${formatarDinheiro(p.total)}</span>
             </li>`,
             )
             .join("")}</ol>`
        : ""
    }

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
        : `<p class="vazio">Nenhum pedido neste evento ainda.</p>`
    }

    <div class="acoesMenu">
      <button type="button" class="botao verde" data-acao="baixar" ${pedidos.length ? "" : "disabled"}>Baixar relatório</button>
      ${
        podeCompartilhar()
          ? `<button type="button" class="botao azul" data-acao="compartilhar" ${pedidos.length ? "" : "disabled"}>Compartilhar</button>`
          : ""
      }
    </div>

    <div class="cartaoSync ${status.classe}">
      <span class="bolinha" aria-hidden="true"></span>
      <span>${status.texto}</span>
      <button type="button" class="botao contorno pequeno" data-acao="sincronizar">Sincronizar agora</button>
    </div>
    <p class="rodape">${db.bancoEmMemoria() ? "Atenção: este navegador não guarda dados offline." : "Os pedidos são guardados no aparelho e enviados ao servidor."}</p>`;
}

async function exportar(compartilhar) {
  const pedidos = pedidosVisiveis();
  if (!pedidos.length) return;
  const titulo = `${eventoAtual()?.nome || "Vendas"}${loja.filtro === "todos" ? "" : ` · ${dispositivo()?.pessoa || ""}`}`;
  if (compartilhar) await compartilharRelatorio(pedidos, titulo);
  else {
    baixarRelatorio(pedidos, titulo);
    avisar("Relatório baixado");
  }
}

// ---------- Aba Pedidos ----------

function renderizarPedidos() {
  const perms = permissoes();
  const lista = [...pedidosVisiveis()].reverse();
  const ultimoMeu = pedidosVisiveis("meus").at(-1);
  const todos = loja.filtro === "todos";

  $("#painelPedidos").innerHTML = `
    ${filtroHtml()}
    ${!perms.alterar_pedidos ? bloqueio("Alterar pedidos já enviados está bloqueado pelo administrador. Os que ainda estão aguardando envio podem ser corrigidos.") : ""}
    ${
      ultimoMeu && podeAlterar(ultimoMeu)
        ? `<button type="button" class="botao contorno" data-acao="desfazer">
            Desfazer meu último pedido <small>#${escaparHtml(ultimoMeu.codigo)} · ${formatarDinheiro(ultimoMeu.total)}</small>
          </button>`
        : ""
    }
    ${
      lista.length
        ? `<ul class="listaPedidos">${lista
            .map((p) => {
              const editavel = podeAlterar(p);
              return `
          <li class="cartaoPedido${p.meu ? "" : " deOutro"}">
            <div class="pedidoTopo">
              <span class="pedidoNumero">#${escaparHtml(p.codigo)}</span>
              <span class="pedidoHora">${formatarHora(p.criado_em)}${todos && !p.meu ? ` · ${escaparHtml(p.pessoa)}` : ""}</span>
              ${p.sincronizado ? "" : `<span class="selo pendente" title="Ainda não chegou ao servidor">aguardando envio</span>`}
              <strong class="pedidoTotal">${formatarDinheiro(p.total)}</strong>
              ${
                editavel
                  ? `<button type="button" class="botaoIcone pequeno" data-acao="excluir" data-id="${p.uuid}" aria-label="Excluir pedido ${escaparHtml(p.codigo)}">${ICONE_LIXO}</button>`
                  : ""
              }
            </div>
            <p class="pedidoItens">${escaparHtml(textoItens(p.itens))}</p>
            ${
              p.forma === "pix"
                ? `<p class="pedidoPagamento pagoPix">Pago no Pix</p>`
                : p.recebido
                  ? `<p class="pedidoPagamento${p.troco < 0 ? " faltou" : ""}">${textoPagamento(p)}</p>`
                  : ""
            }
            ${(p.devolucoes || [])
              .map(
                (d) =>
                  `<p class="pedidoDevolucao">↩ Devolvido ${formatarHora(d.criado_em)}: ${escaparHtml(textoItens(d.itens))} · ${formatarDinheiro(d.valor)}</p>`,
              )
              .join("")}
            ${
              editavel
                ? `<button type="button" class="botao contorno pequeno botaoDevolver" data-acao="devolver" data-id="${p.uuid}">↩ Devolver item</button>`
                : ""
            }
          </li>`;
            })
            .join("")}</ul>`
        : `<p class="vazio">Nenhum pedido neste evento ainda.</p>`
    }`;
}

/** Tira o pedido do histórico (ou cancela no servidor, se já foi enviado) */
async function cancelarPedido(pedido) {
  if (!pedido.sincronizado) {
    const ops = await esquecerPedidoNaoEnviado(pedido.uuid);
    return async () => {
      await guardarPedido(pedido);
      await devolverParaFila(ops);
    };
  }
  await guardarPedido({ ...pedido, cancelado: true });
  await registrarOperacao({ tipo: "cancelar_pedido", pedido_uuid: pedido.uuid });
  return async () => {
    await guardarPedido({ ...pedido, cancelado: false });
    await registrarOperacao({ tipo: "restaurar_pedido", pedido_uuid: pedido.uuid });
  };
}

async function desfazerUltimo() {
  const ultimo = pedidosVisiveis("meus").at(-1);
  if (!ultimo || !podeAlterar(ultimo)) return;
  const ok = await confirmar({
    titulo: `Desfazer pedido #${ultimo.codigo}?`,
    texto: `${textoItens(ultimo.itens)} · ${formatarDinheiro(ultimo.total)}. Ele sai do histórico e, se a tela estiver vazia, os itens voltam para ela para você corrigir.`,
    ok: "Desfazer",
    perigo: true,
  });
  if (!ok) return;

  await cancelarPedido(ultimo);
  avisarMudanca("pedidos");
  const voltou = ctx.restaurarNaTela(ultimo.itens);
  if (voltou) {
    fecharTela();
    avisar(`Pedido #${ultimo.codigo} desfeito · itens de volta na tela`);
  } else {
    avisar(`Pedido #${ultimo.codigo} desfeito`);
  }
}

async function excluir(uuid) {
  const pedido = loja.pedidos.find((p) => p.uuid === uuid);
  if (!pedido || !podeAlterar(pedido)) return;
  const ok = await confirmar({
    titulo: `Excluir pedido #${pedido.codigo}?`,
    texto: `${textoItens(pedido.itens)} · ${formatarDinheiro(pedido.total)}`,
    ok: "Excluir",
    perigo: true,
  });
  if (!ok) return;
  const desfazer = await cancelarPedido(pedido);
  avisarMudanca("pedidos");
  avisar(`Pedido #${pedido.codigo} excluído`, {
    acao: "Desfazer",
    aoAgir: async () => {
      await desfazer();
      avisarMudanca("pedidos");
    },
  });
}

// ---------- Devolver itens de um pedido ----------

let edicao = null; // { pedido, devolver: number[] }

function abrirDevolucao(uuid) {
  const pedido = loja.pedidos.find((p) => p.uuid === uuid);
  if (!pedido || !podeAlterar(pedido)) return;
  edicao = { pedido, devolver: pedido.itens.map(() => 0) };
  $("#devolucaoTitulo").textContent = `Devolver itens do pedido #${pedido.codigo}`;
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
    ? `<span>Devolver ao cliente${pedido.forma === "pix" ? " <small>(pago no Pix)</small>" : ""}</span><strong>${formatarDinheiro(valor)}</strong>`
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

  const devolvidos = pedido.itens
    .map((item, i) => ({ item_id: item.item_id, nome: item.nome, preco: item.preco, qtd: devolver[i] }))
    .filter((i) => i.qtd > 0);
  const ficam = pedido.itens.map((item, i) => ({ ...item, qtd: item.qtd - devolver[i] })).filter((i) => i.qtd > 0);
  const anterior = structuredClone(pedido);
  const devolucao = { uuid: novoId(), criado_em: new Date().toISOString(), valor, itens: devolvidos };
  fecharDevolucao();

  await guardarPedido({
    ...pedido,
    itens: ficam,
    total: pedido.total - valor,
    cancelado: ficam.length === 0,
    devolucoes: [...(pedido.devolucoes || []), devolucao],
  });
  await registrarOperacao({
    tipo: "devolver",
    uuid: devolucao.uuid,
    pedido_uuid: pedido.uuid,
    criado_em: devolucao.criado_em,
    itens: devolvidos.map(({ item_id, nome, qtd }) => ({ item_id, nome, qtd })),
  });
  avisarMudanca("pedidos");

  avisar(
    ficam.length ? `Devolva ${formatarDinheiro(valor)} ao cliente` : `Pedido #${pedido.codigo} devolvido inteiro · ${formatarDinheiro(valor)}`,
    {
      acao: "Desfazer",
      aoAgir: async () => {
        await guardarPedido(anterior);
        await registrarOperacao({ tipo: "desfazer_devolucao", devolucao_uuid: devolucao.uuid });
        avisarMudanca("pedidos");
      },
    },
  );
}

function ligarDevolucao() {
  $("#devolucaoLista").addEventListener("click", (e) => {
    const botao = e.target.closest("[data-mudar]");
    if (!botao || !edicao) return;
    const i = Number(botao.dataset.linha);
    const max = edicao.pedido.itens[i].qtd;
    edicao.devolver[i] = Math.min(max, Math.max(0, edicao.devolver[i] - Number(botao.dataset.mudar)));
    renderizarDevolucao();
  });
  $("#devolucaoCancelar").addEventListener("click", fecharDevolucao);
  $("#devolucaoOk").addEventListener("click", confirmarDevolucao);
  $("#devolucao").addEventListener("click", (e) => e.target.id === "devolucao" && fecharDevolucao());
}

// ---------- Aba Itens (esgotados) ----------

function renderizarItens() {
  const lista = itens();
  const pode = permissoes().editar_itens;
  const esgotados = lista.filter((i) => i.esgotado).length;

  $("#painelItens").innerHTML = `
    ${!pode ? bloqueio("Marcar esgotados está bloqueado pelo administrador.") : ""}
    <div class="itensTopo">
      <span>${lista.length - esgotados} de ${lista.length} disponíveis</span>
      ${esgotados && pode ? `<button type="button" class="botao contorno pequeno" data-acao="mostrarTodos">Mostrar todos</button>` : ""}
    </div>
    <p class="dicaMenu">Desligue o que acabou: fica cinza como esgotado em <b>todos os aparelhos</b>.</p>
    <ul class="listaItens${pode ? "" : " travada"}">
      ${lista
        .map(
          (i) => `
        <li class="${i.esgotado ? "esgotado" : ""}">
          <label>
            ${i.imagem ? `<img src="${escaparHtml(i.imagem)}" alt="" width="40" height="40" />` : `<span class="semImagem mini">${escaparHtml(i.nome[0])}</span>`}
            <span class="nomeItem">${escaparHtml(i.nome)}<small>${i.esgotado ? "Esgotado" : formatarDinheiro(i.preco)}</small></span>
            <input type="checkbox" role="switch" data-id="${i.id}" ${i.esgotado ? "" : "checked"} ${pode ? "" : "disabled"} aria-label="${escaparHtml(i.nome)} disponível" />
            <span class="chave" aria-hidden="true"></span>
          </label>
        </li>`,
        )
        .join("")}
    </ul>`;
}

async function mudarEsgotado(id, esgotado, chave) {
  if (!permissoes().editar_itens) {
    if (chave) chave.checked = !esgotado;
    avisar("Bloqueado pelo administrador");
    return;
  }
  await alterarServidorLocal((s) => {
    const item = s.itens.find((i) => i.id === id);
    if (item) item.esgotado = esgotado;
  });
  await substituirOperacao({ tipo: "item_esgotado", item_id: id, esgotado }, (op) => op.item_id === id);
  avisarMudanca("itens");
}

async function mostrarTodosItens() {
  for (const item of itens().filter((i) => i.esgotado)) await mudarEsgotado(item.id, false);
}

// ---------- Aba Pix ----------

let timerSalvarPix;

function lerFormularioPix() {
  return {
    ativo: $("#pixAtivo").checked,
    tipo: $("#pixTipo").value,
    chave: $("#pixChave").value,
    nome: $("#pixNome").value,
    cidade: $("#pixCidade").value,
  };
}

const MODO_TECLADO = { cpf: "numeric", celular: "tel", email: "email", aleatoria: "text" };
const EXEMPLO_CHAVE = {
  cpf: "000.000.000-00",
  celular: "(11) 98765-4321",
  email: "nome@exemplo.com",
  aleatoria: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
};

function renderizarPix() {
  const c = configPix();
  const pode = permissoes().editar_pix;
  const travar = pode ? "" : "disabled";
  const quem = loja.servidor?.config?.atualizado_por;

  $("#painelPix").innerHTML = `
    ${pode ? "" : bloqueio("Mudar o Pix está bloqueado pelo administrador.")}
    <label class="opcaoPix">
      <span class="nomeItem">QR Code Pix no fim do pedido
        <small>Aparece sozinho na tela Finalizar, já com o valor. Vale para todos os aparelhos.</small>
      </span>
      <input type="checkbox" role="switch" id="pixAtivo" ${c.ativo ? "checked" : ""} ${travar} />
      <span class="chave" aria-hidden="true"></span>
    </label>

    <div class="formPix">
      <label class="campo">
        <span>Tipo de chave</span>
        <select id="pixTipo" ${travar}>
          ${Object.entries(TIPOS_CHAVE)
            .map(([valor, nome]) => `<option value="${valor}" ${c.tipo === valor ? "selected" : ""}>${nome}</option>`)
            .join("")}
        </select>
      </label>
      <label class="campo">
        <span>Chave Pix</span>
        <input id="pixChave" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" ${travar}
          inputmode="${MODO_TECLADO[c.tipo]}" placeholder="${EXEMPLO_CHAVE[c.tipo]}" value="${escaparHtml(c.chave)}" />
      </label>
      <label class="campo">
        <span>Nome de quem recebe</span>
        <input id="pixNome" type="text" maxlength="25" autocomplete="off" placeholder="Ex.: Paróquia São José" value="${escaparHtml(c.nome)}" ${travar} />
        <small>Até 25 letras. Aparece no app do banco de quem paga.</small>
      </label>
      <label class="campo">
        <span>Cidade</span>
        <input id="pixCidade" type="text" maxlength="15" autocomplete="off" placeholder="Ex.: Recife" value="${escaparHtml(c.cidade)}" ${travar} />
      </label>
    </div>

    <p id="pixStatus" class="statusPix" aria-live="polite"></p>
    ${quem ? `<p class="rodape">Última alteração: ${escaparHtml(quem)}</p>` : ""}

    <div id="pixTeste" class="testePix" hidden>
      <div id="pixTesteQr" class="qrPix"></div>
      <p><strong>Teste antes do evento</strong>Leia este QR de <b>R$ 1,00</b> com o app do seu banco e confira se o nome e a chave estão certos. Não precisa concluir o pagamento.</p>
    </div>`;
  atualizarStatusPix();
}

function atualizarStatusPix() {
  const c = lerFormularioPix();
  const erro = erroConfiguracao(c);
  const status = $("#pixStatus");
  const { chave } = normalizarChave(c.tipo, c.chave);

  if (erro) {
    status.className = "statusPix erro";
    status.textContent = c.ativo ? `QR desligado até corrigir: ${erro}` : erro;
  } else {
    status.className = "statusPix ok";
    status.textContent = c.ativo ? `✓ Ligado · chave ${chave}` : `✓ Chave ${chave} pronta. Ligue a opção acima para usar.`;
  }
  $("#pixTeste").hidden = !!erro;
  if (!erro) $("#pixTesteQr").innerHTML = qrSvg(gerarPayload({ chave, nome: c.nome, cidade: c.cidade, valor: 100 }));
}

/** Manda a configuração do Pix para todos (só se estiver coerente) */
async function enviarPix() {
  if (!permissoes().editar_pix || !$("#pixChave")) return;
  const form = lerFormularioPix();
  const atual = configPix();
  if (form.ativo && erroConfiguracao(form)) return; // o servidor recusaria
  if (["ativo", "tipo", "chave", "nome", "cidade"].every((k) => form[k] === atual[k])) return;
  await alterarServidorLocal((s) => {
    s.config.pix = { ...form };
  });
  await substituirOperacao({ tipo: "pix", pix: form }, () => true);
}

function ligarPix() {
  const painel = $("#painelPix");

  painel.addEventListener("input", (e) => {
    if (e.target.id === "pixAtivo") return;
    atualizarStatusPix();
    clearTimeout(timerSalvarPix);
    timerSalvarPix = setTimeout(enviarPix, 800);
  });

  painel.addEventListener("change", async (e) => {
    if (e.target.id === "pixTipo") {
      const tipo = e.target.value;
      $("#pixChave").inputMode = MODO_TECLADO[tipo];
      $("#pixChave").placeholder = EXEMPLO_CHAVE[tipo];
      atualizarStatusPix();
      return;
    }
    if (e.target.id === "pixAtivo") {
      const form = lerFormularioPix();
      const erro = erroConfiguracao(form);
      if (form.ativo && erro) {
        e.target.checked = false;
        avisar(`Para ligar: ${erro.charAt(0).toLowerCase() + erro.slice(1)}`);
        atualizarStatusPix();
        return;
      }
      clearTimeout(timerSalvarPix);
      await enviarPix();
      atualizarStatusPix();
      avisar(form.ativo ? "QR Code Pix ligado para todos os aparelhos" : "QR Code Pix desligado para todos os aparelhos");
    }
  });

  painel.addEventListener("focusout", () => {
    clearTimeout(timerSalvarPix);
    enviarPix();
  });
}
