// =============================================================
//  BANCO LOCAL DO APARELHO (IndexedDB) — versão online
//
//  O app continua funcionando sem internet: tudo é salvo aqui primeiro e
//  vai para o servidor quando der.
//
//   pedidos → pedidos do evento (deste aparelho e dos outros, vindos do
//             servidor) + os deste aparelho ainda não enviados
//   fila    → o que este aparelho fez e ainda não chegou ao servidor
//             (pedido novo, devolução, esgotado, Pix…), na ordem
//   config  → token do aparelho, último estado do servidor, pedido em andamento
// =============================================================

const NOME_BANCO = "vendas-online";
const VERSAO_BANCO = 1;

let conexao = null;
let usandoMemoria = false;
const memoria = { pedidos: new Map(), fila: new Map(), config: new Map(), seq: 1 };

function abrir() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("sem IndexedDB"));
    const req = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("pedidos")) db.createObjectStore("pedidos", { keyPath: "uuid" });
      if (!db.objectStoreNames.contains("fila")) db.createObjectStore("fila", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("config")) db.createObjectStore("config", { keyPath: "chave" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("banco bloqueado"));
  });
}

export async function iniciarBanco() {
  try {
    conexao = await abrir();
    navigator.storage?.persist?.().catch(() => {});
    return true;
  } catch (erro) {
    console.warn("Banco local indisponível, usando memória:", erro);
    usandoMemoria = true;
    return false;
  }
}

export const bancoEmMemoria = () => usandoMemoria;

function transacao(tabelas, modo, acao) {
  return new Promise((resolve, reject) => {
    const tx = conexao.transaction(tabelas, modo);
    let resultado;
    const req = acao(tx);
    if (req) req.onsuccess = () => (resultado = req.result);
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------- pedidos ----------

export async function listarPedidos() {
  const lista = usandoMemoria
    ? [...memoria.pedidos.values()]
    : await transacao("pedidos", "readonly", (tx) => tx.objectStore("pedidos").getAll());
  // datas do servidor vêm com fuso (-03:00) e as locais em UTC (Z): compara como data
  return lista.sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em));
}

export async function salvarPedidos(pedidos) {
  if (!pedidos.length) return;
  if (usandoMemoria) return void pedidos.forEach((p) => memoria.pedidos.set(p.uuid, p));
  return transacao("pedidos", "readwrite", (tx) => {
    const s = tx.objectStore("pedidos");
    pedidos.forEach((p) => s.put(p));
  });
}

export const salvarPedido = (p) => salvarPedidos([p]);

export async function excluirPedidos(uuids) {
  if (!uuids.length) return;
  if (usandoMemoria) return void uuids.forEach((u) => memoria.pedidos.delete(u));
  return transacao("pedidos", "readwrite", (tx) => {
    const s = tx.objectStore("pedidos");
    uuids.forEach((u) => s.delete(u));
  });
}

// ---------- fila de envio ----------

export async function adicionarNaFila(op) {
  if (usandoMemoria) {
    const seq = memoria.seq++;
    memoria.fila.set(seq, { ...op, seq });
    return seq;
  }
  return transacao("fila", "readwrite", (tx) => tx.objectStore("fila").add(op));
}

export async function listarFila() {
  if (usandoMemoria) return [...memoria.fila.values()].sort((a, b) => a.seq - b.seq);
  return transacao("fila", "readonly", (tx) => tx.objectStore("fila").getAll());
}

export async function removerDaFila(seqs) {
  if (!seqs.length) return;
  if (usandoMemoria) return void seqs.forEach((s) => memoria.fila.delete(s));
  return transacao("fila", "readwrite", (tx) => {
    const s = tx.objectStore("fila");
    seqs.forEach((seq) => s.delete(seq));
  });
}

// ---------- config ----------

export async function lerConfig(chave, padrao = null) {
  if (usandoMemoria) return memoria.config.has(chave) ? memoria.config.get(chave) : padrao;
  const linha = await transacao("config", "readonly", (tx) => tx.objectStore("config").get(chave));
  return linha ? linha.valor : padrao;
}

export async function salvarConfig(chave, valor) {
  if (usandoMemoria) return void memoria.config.set(chave, valor);
  return transacao("config", "readwrite", (tx) => tx.objectStore("config").put({ chave, valor }));
}

export async function apagarConfig(chave) {
  if (usandoMemoria) return void memoria.config.delete(chave);
  return transacao("config", "readwrite", (tx) => tx.objectStore("config").delete(chave));
}
