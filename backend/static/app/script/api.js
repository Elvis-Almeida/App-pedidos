// =============================================================
//  COMUNICAÇÃO COM O SERVIDOR + SINCRONIZAÇÃO
//
//  1. manda a fila (o que o aparelho fez) para /api/sincronizar/
//  2. baixa o que mudou em /api/estado/?desde=<última revisão>
//  3. guarda tudo no banco local e avisa a tela
//
//  Roda sozinho: ao abrir, a cada 20 s, quando a internet volta e logo depois
//  de cada venda. Sem internet, nada trava: a fila espera.
// =============================================================

import * as db from "./db.js";

const VERSAO_APP = document.documentElement.dataset.versao || "dev";
const TEMPO_LIMITE = 15000;
const INTERVALO = 20000;

export class Desconectado extends Error {}
export class SemInternet extends Error {}

async function chamar(caminho, { metodo = "GET", corpo, token } = {}) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE);
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        "X-App-Versao": VERSAO_APP,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new SemInternet("Sem conexão com o servidor");
  } finally {
    clearTimeout(timer);
  }
  let dados = {};
  try {
    dados = await resposta.json();
  } catch {
    /* resposta sem JSON (ex.: erro do proxy) */
  }
  if (resposta.status === 401) throw new Desconectado(dados.erro || "Aparelho desconectado");
  if (!resposta.ok) {
    const erro = new Error(dados.erro || `Erro ${resposta.status} no servidor`);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

/** Descrição curta do aparelho, para o admin saber qual é qual */
export function descreverAparelho() {
  const ua = navigator.userAgent;
  const sistema = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? (ua.match(/Android [\d.]+; ([^;)]+)/)?.[1] || "Android").replace(/ Build.*/, "")
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS/.test(ua)
            ? "Mac"
            : "Navegador";
  const navegador = /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
  return [sistema, navegador].filter(Boolean).join(" · ");
}

export function conectarComConvite(codigo) {
  return chamar("/api/auth/convite/", { metodo: "POST", corpo: { codigo, aparelho: descreverAparelho() } });
}

/** Gera um id único (funciona mesmo em navegador antigo) */
export function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// =============================================================
//  Sincronizador
// =============================================================

/**
 * @param {{
 *   aoMudarEstado: (servidor:object) => void,      // chegou cardápio/config/pedidos novos
 *   aoMudarStatus: (status:object) => void,        // {situacao, pendentes, ultima}
 *   aoDesconectar: (mensagem:string) => void,      // token revogado no admin
 *   aoRecusar: (recusas:object[]) => void,         // operações bloqueadas/invalidas
 * }} ganchos
 */
export function criarSincronizador(ganchos) {
  let rodando = false;
  let deNovo = false;
  let timer = null;
  let intervalo = null;
  let ultima = null;
  let situacao = "parado";

  async function avisarStatus(nova) {
    if (nova) situacao = nova;
    const pendentes = (await db.listarFila()).length;
    ganchos.aoMudarStatus({ situacao, pendentes, ultima });
  }

  async function enviarFila(token) {
    const fila = await db.listarFila();
    if (!fila.length) return [];
    const operacoes = fila.map(({ seq, ...op }) => op);
    const { resultados } = await chamar("/api/sincronizar/", { metodo: "POST", corpo: { operacoes }, token });

    const porId = new Map(resultados.map((r) => [r.id, r]));
    const processadas = [];
    const pedidosDoServidor = [];
    const recusas = [];
    for (const op of fila) {
      const r = porId.get(op.id);
      if (!r) continue; // não processada (limite do lote): vai na próxima
      processadas.push(op.seq);
      if (r.pedido) pedidosDoServidor.push({ ...r.pedido, sincronizado: true });
      if (!r.ok) recusas.push({ ...r, tipo: op.tipo });
    }
    await db.removerDaFila(processadas);
    // a versão do servidor vale (inclusive quando a alteração foi bloqueada)
    await db.salvarPedidos(pedidosDoServidor);
    return recusas;
  }

  async function baixarEstado(token) {
    const anterior = await db.lerConfig("servidor", null);
    const desde = anterior?.rev || 0;
    const e = await chamar(`/api/estado/?desde=${desde}`, { token });

    const fila = await db.listarFila();
    const comPendencia = new Set(fila.flatMap((op) => [op.uuid, op.pedido_uuid].filter(Boolean)));
    const locais = await db.listarPedidos();

    if (e.completo) {
      // recomeça a lista do evento: apaga o que veio do servidor antes
      // (nunca o que ainda não foi enviado)
      const noServidor = new Set(e.pedidos.map((p) => p.uuid));
      const remover = locais.filter((p) => p.sincronizado && !noServidor.has(p.uuid)).map((p) => p.uuid);
      await db.excluirPedidos(remover);
    }
    await db.salvarPedidos(
      e.pedidos.filter((p) => !comPendencia.has(p.uuid)).map((p) => ({ ...p, sincronizado: true })),
    );

    const servidor = {
      rev: e.rev,
      config: e.config,
      itens: e.itens,
      evento: e.evento,
      dispositivo: e.dispositivo,
      servidor_agora: e.servidor_agora,
    };
    await db.salvarConfig("servidor", servidor);
    return servidor;
  }

  async function sincronizar() {
    if (rodando) {
      deNovo = true;
      return;
    }
    const token = await db.lerConfig("token");
    if (!token) return;
    if (!navigator.onLine) {
      await avisarStatus("offline");
      return;
    }
    rodando = true;
    await avisarStatus("sincronizando");
    try {
      const recusas = await enviarFila(token);
      const servidor = await baixarEstado(token);
      ultima = new Date();
      await avisarStatus("ok");
      ganchos.aoMudarEstado(servidor);
      if (recusas.length) ganchos.aoRecusar(recusas);
    } catch (erro) {
      if (erro instanceof Desconectado) {
        await db.apagarConfig("token");
        parar();
        ganchos.aoDesconectar(erro.message);
      } else {
        console.warn("Sincronização falhou:", erro);
        await avisarStatus(erro instanceof SemInternet ? "offline" : "erro");
      }
    } finally {
      rodando = false;
      if (deNovo) {
        deNovo = false;
        agendar(300);
      }
    }
  }

  function agendar(ms = 800) {
    clearTimeout(timer);
    timer = setTimeout(sincronizar, ms);
  }

  function iniciar() {
    parar();
    intervalo = setInterval(() => {
      if (document.visibilityState === "visible") sincronizar();
    }, INTERVALO);
    sincronizar();
  }

  function parar() {
    clearInterval(intervalo);
    clearTimeout(timer);
  }

  window.addEventListener("online", () => agendar(200));
  window.addEventListener("offline", () => avisarStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") agendar(200);
  });

  return { sincronizar, agendar, iniciar, parar, avisarStatus };
}
