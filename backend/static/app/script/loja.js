// =============================================================
//  ESTADO COMPARTILHADO DO APP
//  Cardápio, Pix e evento (vindos do servidor), pedidos locais e a fila.
//  A tela principal e o menu leem e mudam tudo por aqui.
// =============================================================

import * as db from "./db.js";
import { novoId } from "./api.js";

export const loja = {
  /** último estado baixado do servidor: {rev, config, itens, evento, dispositivo} */
  servidor: null,
  /** todos os pedidos guardados no aparelho */
  pedidos: [],
  /** {situacao: ok|sincronizando|offline|erro, pendentes, ultima} */
  status: { situacao: "parado", pendentes: 0, ultima: null },
  /** "meus" ou "todos" (filtro do menu) */
  filtro: "meus",
  /** função que agenda uma sincronização (definida no app.js) */
  agendarSincronizacao: () => {},
};

const ouvintes = new Set();
export function aoMudar(funcao) {
  ouvintes.add(funcao);
}
export function avisarMudanca(motivo) {
  ouvintes.forEach((f) => f(motivo));
}

// ---------- leitura ----------

export const itens = () => loja.servidor?.itens || [];
export const itemPorId = (id) => itens().find((i) => i.id === id);
export const eventoAtual = () => loja.servidor?.evento || null;
export const dispositivo = () => loja.servidor?.dispositivo || null;
export const configPix = () => loja.servidor?.config?.pix || { ativo: false, tipo: "cpf", chave: "", nome: "", cidade: "" };

export function permissoes() {
  return dispositivo()?.permissoes || { editar_itens: true, editar_pix: true, alterar_pedidos: true };
}

/** Pedidos do evento atual que valem (não cancelados), já com o filtro do menu */
export function pedidosVisiveis(filtro = loja.filtro) {
  const evento = eventoAtual();
  return loja.pedidos.filter(
    (p) =>
      !p.cancelado &&
      (!evento || p.evento_id === evento.id || (p.evento_id == null && !p.sincronizado)) &&
      (filtro === "todos" || p.meu),
  );
}

/** Pode mexer neste pedido? (só os seus; e, se já foi enviado, se o admin deixar) */
export function podeAlterar(pedido) {
  return pedido.meu && (!pedido.sincronizado || permissoes().alterar_pedidos);
}

export function proximoNumero() {
  const evento = eventoAtual();
  const meus = loja.pedidos.filter((p) => p.meu && (!evento || p.evento_id === evento.id || p.evento_id == null));
  const local = meus.reduce((max, p) => Math.max(max, p.numero || 0), 0);
  return Math.max(local, dispositivo()?.ultimo_numero || 0) + 1;
}

// ---------- escrita ----------

export async function recarregarPedidos() {
  loja.pedidos = await db.listarPedidos();
}

/** Guarda uma operação na fila e pede para sincronizar logo */
export async function registrarOperacao(op) {
  await db.adicionarNaFila({ id: novoId(), criado_em: new Date().toISOString(), ...op });
  loja.status = { ...loja.status, pendentes: loja.status.pendentes + 1 };
  avisarMudanca("fila");
  loja.agendarSincronizacao();
}

/**
 * Como registrarOperacao, mas descarta da fila operações iguais ainda não
 * enviadas (ex.: várias mudanças no Pix viram uma só; ligar e desligar o
 * mesmo item esgotado manda só o estado final).
 */
export async function substituirOperacao(op, mesmaCoisa) {
  const fila = await db.listarFila();
  const velhas = fila.filter((antiga) => antiga.tipo === op.tipo && mesmaCoisa(antiga));
  await db.removerDaFila(velhas.map((v) => v.seq));
  await registrarOperacao(op);
}

/** Salva o pedido no aparelho (e na lista em memória) */
export async function guardarPedido(pedido) {
  await db.salvarPedido(pedido);
  const i = loja.pedidos.findIndex((p) => p.uuid === pedido.uuid);
  if (i >= 0) loja.pedidos[i] = pedido;
  else loja.pedidos.push(pedido);
}

/** Tira da fila tudo o que se refere a um pedido ainda não enviado */
export async function esquecerPedidoNaoEnviado(uuid) {
  const fila = await db.listarFila();
  const ops = fila.filter((op) => op.uuid === uuid || op.pedido_uuid === uuid);
  await db.removerDaFila(ops.map((op) => op.seq));
  await db.excluirPedidos([uuid]);
  loja.pedidos = loja.pedidos.filter((p) => p.uuid !== uuid);
  return ops.map(({ seq, ...op }) => op); // para poder desfazer
}

/** Devolve à fila operações removidas (desfazer) */
export async function devolverParaFila(ops) {
  for (const op of ops) await db.adicionarNaFila(op);
  loja.agendarSincronizacao();
}

/** Muda algo do cardápio/config localmente (antes do servidor confirmar) */
export async function alterarServidorLocal(mudar) {
  if (!loja.servidor) return;
  mudar(loja.servidor);
  await db.salvarConfig("servidor", loja.servidor);
}
