// =============================================================
//  Peças de interface reutilizáveis: telas, confirmação e avisos
// =============================================================

const $ = (sel) => document.querySelector(sel);

/** Evita que nomes com < > & quebrem o HTML */
export function escaparHtml(texto) {
  return String(texto).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function vibrar(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS não vibra, tudo bem */
  }
}

// ---------- Telas sobrepostas (Finalizar, Menu) ----------
// Cada tela aberta entra no histórico do navegador, então o botão
// "voltar" do Android fecha a tela em vez de sair do app.

const pilhaTelas = [];
let popsParaIgnorar = 0;

function esconder({ el, aoFechar }) {
  el.hidden = true;
  if (!pilhaTelas.length) document.body.classList.remove("travado");
  aoFechar?.();
}

export function abrirTela(el, aoFechar) {
  el.hidden = false;
  el.classList.remove("entrando");
  void el.offsetWidth; // reinicia a animação
  el.classList.add("entrando");
  document.body.classList.add("travado");
  pilhaTelas.push({ el, aoFechar });
  history.pushState({ tela: el.id }, "");
}

export function fecharTela() {
  const tela = pilhaTelas.pop();
  if (!tela) return;
  esconder(tela);
  popsParaIgnorar++;
  history.back();
}

export function telaAberta() {
  return pilhaTelas.at(-1)?.el ?? null;
}

window.addEventListener("popstate", () => {
  if (popsParaIgnorar > 0) {
    popsParaIgnorar--;
    return;
  }
  if (dialogoAberto()) {
    // voltar com uma caixa aberta = cancelar a caixa
    cancelarDialogo();
    history.pushState({ tela: telaAberta()?.id }, "");
    return;
  }
  const tela = pilhaTelas.pop();
  if (tela) esconder(tela);
});

// ---------- Confirmação ----------

/**
 * Mostra uma caixa de confirmação e devolve true/false.
 * @param {{titulo:string, texto?:string, ok?:string, cancelar?:string, perigo?:boolean}} opcoes
 */
export function confirmar({ titulo, texto = "", ok = "Confirmar", cancelar = "Cancelar", perigo = false }) {
  const fundo = $("#dialogo");
  const botaoOk = $("#dialogoOk");
  const botaoCancelar = $("#dialogoCancelar");
  $("#dialogoTitulo").textContent = titulo;
  $("#dialogoTexto").textContent = texto;
  $("#dialogoTexto").hidden = !texto;
  botaoOk.textContent = ok;
  botaoCancelar.textContent = cancelar;
  botaoOk.className = "botao " + (perigo ? "vermelho" : "verde");

  const focoAnterior = document.activeElement;
  fundo.hidden = false;
  botaoCancelar.focus({ preventScroll: true });

  return new Promise((resolve) => {
    const terminar = (resposta) => {
      fundo.hidden = true;
      botaoOk.onclick = botaoCancelar.onclick = fundo.onclick = null;
      focoAnterior?.focus?.({ preventScroll: true });
      resolve(resposta);
    };
    botaoOk.onclick = () => terminar(true);
    botaoCancelar.onclick = () => terminar(false);
    fundo.onclick = (e) => e.target === fundo && terminar(false);
  });
}

/** Há alguma caixa (confirmação, devolução…) aberta? */
export function dialogoAberto() {
  return !!document.querySelector(".fundoDialogo:not([hidden])");
}

/** Cancela a caixa que está por cima (a última aberta no HTML) */
export function cancelarDialogo() {
  const abertas = document.querySelectorAll(".fundoDialogo:not([hidden])");
  abertas[abertas.length - 1]?.querySelector("[data-cancelar]")?.click();
}

// ---------- Avisos rápidos (toast) ----------

let timerAviso;

/**
 * @param {string} texto
 * @param {{acao?:string, aoAgir?:()=>void, duracao?:number}} opcoes
 */
export function avisar(texto, { acao, aoAgir, duracao = 2600 } = {}) {
  const toast = $("#toast");
  const botao = $("#toastAcao");
  $("#toastTexto").textContent = texto;
  botao.hidden = !acao;
  botao.textContent = acao || "";
  botao.onclick = acao
    ? () => {
        esconderAviso();
        aoAgir?.();
      }
    : null;

  toast.hidden = false;
  toast.classList.remove("visivel");
  void toast.offsetWidth;
  toast.classList.add("visivel");

  clearTimeout(timerAviso);
  timerAviso = setTimeout(esconderAviso, acao ? Math.max(duracao, 4500) : duracao);
}

export function esconderAviso() {
  clearTimeout(timerAviso);
  const toast = $("#toast");
  toast.classList.remove("visivel");
  setTimeout(() => {
    if (!toast.classList.contains("visivel")) toast.hidden = true;
  }, 200);
}
