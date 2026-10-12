// =============================================================
//  TELA DE CONEXÃO (código de convite)
//
//  Aparece só na primeira vez (ou se o admin desconectar o aparelho).
//  O código vem do admin; pelo link/QR do convite ele já chega preenchido
//  e a conexão é automática.
// =============================================================

import { conectarComConvite } from "./api.js";

const $ = (sel) => document.querySelector(sel);

function formatarCodigo(texto) {
  const limpo = texto.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return limpo.length > 4 ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : limpo;
}

/**
 * Mostra a tela e resolve quando o aparelho for conectado.
 * @param {{mensagem?:string}} opcoes
 * @returns {Promise<{token:string, dispositivo:object}>}
 */
export function pedirConexao({ mensagem, nome, logo } = {}) {
  // nome/logo mais recentes do servidor (a página pode ter vindo do cache)
  if (nome) $("#tituloConectar").textContent = nome;
  if (logo) $(".logoConectar").src = logo;

  const tela = $("#telaConectar");
  const campo = $("#codigoConvite");
  const botao = $("#btnConectar");
  const aviso = $("#avisoConectar");

  tela.hidden = false;
  document.body.classList.add("travado");
  botao.textContent = "Conectar";

  const mostrarAviso = (texto, tipo = "erro") => {
    aviso.textContent = texto || "";
    aviso.className = `avisoConectar ${tipo}`;
    aviso.hidden = !texto;
  };
  mostrarAviso(mensagem);

  const atualizarBotao = () => {
    botao.disabled = campo.value.replace("-", "").length !== 8;
  };

  return new Promise((resolve) => {
    let enviando = false;

    async function enviar() {
      if (enviando || botao.disabled) return;
      if (!navigator.onLine) {
        mostrarAviso("Sem internet. Para conectar este aparelho pela primeira vez, precisa de conexão.");
        return;
      }
      enviando = true;
      botao.disabled = true;
      botao.textContent = "Conectando…";
      mostrarAviso("");
      try {
        const resposta = await conectarComConvite(campo.value);
        tela.hidden = true;
        document.body.classList.remove("travado");
        resolve(resposta);
      } catch (erro) {
        mostrarAviso(erro.message || "Não foi possível conectar.");
        botao.textContent = "Conectar";
        atualizarBotao();
      } finally {
        enviando = false;
      }
    }

    campo.oninput = () => {
      const pos = campo.value.length;
      campo.value = formatarCodigo(campo.value);
      if (pos >= campo.value.length) campo.setSelectionRange(campo.value.length, campo.value.length);
      atualizarBotao();
      if (aviso.classList.contains("erro")) mostrarAviso("");
    };
    campo.onkeydown = (e) => e.key === "Enter" && enviar();
    botao.onclick = enviar;

    // Veio pelo link do convite (?convite=ABCD-2345): conecta sozinho
    const doLink = new URLSearchParams(location.search).get("convite");
    if (doLink) {
      history.replaceState(null, "", location.pathname);
      campo.value = formatarCodigo(doLink);
      atualizarBotao();
      enviar();
    } else {
      campo.value = "";
      atualizarBotao();
      setTimeout(() => campo.focus(), 300);
    }
  });
}
