// =============================================================
//  BANCO DE DADOS LOCAL (IndexedDB)
//  Fica salvo só neste aparelho/navegador, funciona offline.
//
//  Tabelas:
//   pedidos → { id, numero, data (ISO), itens: [{nome, preco, qtd}],
//               total, recebido, troco }   (valores em centavos)
//   config  → { chave, valor }  (pedido em andamento, itens esgotados…)
// =============================================================

const NOME_BANCO = "scj-pedidos";
const VERSAO_BANCO = 1;

let conexao = null;
let usandoMemoria = false;
const memoria = { pedidos: new Map(), config: new Map(), proximoId: 1 };

function abrir() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("sem IndexedDB"));
    const req = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("pedidos")) {
        db.createObjectStore("pedidos", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "chave" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("banco bloqueado"));
  });
}

/** Abre o banco. Se falhar (ex.: aba anônima antiga), usa memória. */
export async function iniciarBanco() {
  try {
    conexao = await abrir();
    // Pede ao navegador para não apagar os dados quando faltar espaço
    navigator.storage?.persist?.().catch(() => {});
    return true;
  } catch (erro) {
    console.warn("Banco local indisponível, usando memória:", erro);
    usandoMemoria = true;
    return false;
  }
}

function transacao(tabela, modo, acao) {
  return new Promise((resolve, reject) => {
    const tx = conexao.transaction(tabela, modo);
    const store = tx.objectStore(tabela);
    let resultado;
    const req = acao(store);
    if (req) req.onsuccess = () => (resultado = req.result);
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------- pedidos ----------

export async function listarPedidos() {
  if (usandoMemoria) return [...memoria.pedidos.values()];
  const lista = await transacao("pedidos", "readonly", (s) => s.getAll());
  return lista.sort((a, b) => a.id - b.id);
}

export async function adicionarPedido(pedido) {
  if (usandoMemoria) {
    const id = memoria.proximoId++;
    memoria.pedidos.set(id, { ...pedido, id });
    return id;
  }
  return transacao("pedidos", "readwrite", (s) => s.add(pedido));
}

export async function adicionarVariosPedidos(pedidos) {
  if (usandoMemoria) {
    pedidos.forEach((p) => adicionarPedido(p));
    return;
  }
  return transacao("pedidos", "readwrite", (s) => {
    pedidos.forEach((p) => s.add(p));
  });
}

/** Grava o pedido inteiro de novo (usado na devolução de itens) */
export async function atualizarPedido(pedido) {
  if (usandoMemoria) return void memoria.pedidos.set(pedido.id, pedido);
  return transacao("pedidos", "readwrite", (s) => s.put(pedido));
}

export async function excluirPedido(id) {
  if (usandoMemoria) return void memoria.pedidos.delete(id);
  return transacao("pedidos", "readwrite", (s) => s.delete(id));
}

export async function limparPedidos() {
  if (usandoMemoria) return void memoria.pedidos.clear();
  return transacao("pedidos", "readwrite", (s) => s.clear());
}

// ---------- config ----------

export async function lerConfig(chave, padrao = null) {
  if (usandoMemoria) return memoria.config.has(chave) ? memoria.config.get(chave) : padrao;
  const linha = await transacao("config", "readonly", (s) => s.get(chave));
  return linha ? linha.valor : padrao;
}

export async function salvarConfig(chave, valor) {
  if (usandoMemoria) return void memoria.config.set(chave, valor);
  return transacao("config", "readwrite", (s) => s.put({ chave, valor }));
}

export function bancoEmMemoria() {
  return usandoMemoria;
}
