// =============================================================
//  Dashboard do admin — gráficos em SVG (sem biblioteca externa)
//
//  Cores: paleta categórica validada para daltonismo no fundo escuro do
//  app (azul = série 1 / dinheiro, laranja = série 2 / Pix). Uma série só
//  usa sempre o azul. Mapa de calor: rampa de um tom (azul), mais claro =
//  mais vendas.
// =============================================================

(() => {
  const dados = JSON.parse(document.getElementById("dados-painel").textContent);
  const COR = {
    serie1: "#3987e5",
    serie2: "#d95926",
    grade: "rgba(140,150,180,0.12)",
    eixo: "rgba(140,150,180,0.28)",
    texto: "rgba(180,185,210,0.78)",
    superficie: "#191a24",
  };
  const RAMPA = ["#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4"];

  const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
  const num = (n) => n.toLocaleString("pt-BR");
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs = {}, pai) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (pai) pai.appendChild(e);
    return e;
  }

  function escalaBonita(maximo, passos = 4) {
    if (maximo <= 0) return { max: 1, passo: 1 };
    const bruto = maximo / passos;
    const mag = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto);
    return { max: Math.ceil(maximo / passo) * passo, passo };
  }

  /** Retângulo com só o topo arredondado (a base fica reta, presa no eixo) */
  function colunaPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // ---------- Tooltip compartilhada ----------
  const dica = document.createElement("div");
  dica.className = "dicaGrafico";
  dica.hidden = true;
  document.body.appendChild(dica);
  function mostrarDica(html, x, y) {
    dica.innerHTML = html;
    dica.hidden = false;
    const r = dica.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    dica.style.left = `${left + window.scrollX}px`;
    dica.style.top = `${top + window.scrollY}px`;
  }
  const esconderDica = () => (dica.hidden = true);
  document.addEventListener("scroll", esconderDica, { passive: true });

  // ---------- Colunas (empilhadas quando há 2 séries) ----------
  function colunas(alvo, { rotulos, series, formatar = num, detalhe = () => "" }) {
    if (!alvo || !rotulos.length) {
      if (alvo) alvo.innerHTML = '<p class="vazioTexto">Sem dados.</p>';
      return;
    }
    function desenhar() {
      alvo.innerHTML = "";
      if (series.length > 1) {
        const legenda = document.createElement("div");
        legenda.className = "legenda";
        legenda.innerHTML = series.map((s) => `<span><i style="background:${s.cor}"></i>${s.nome}</span>`).join("");
        alvo.appendChild(legenda);
      }
      const largura = alvo.clientWidth;
      const altura = alvo.classList.contains("baixo") ? 190 : 250;
      const m = { t: 10, r: 6, b: 26, l: 40 };
      const w = largura - m.l - m.r;
      const h = altura - m.t - m.b;
      const totais = rotulos.map((_, i) => series.reduce((s, serie) => s + serie.valores[i], 0));
      const { max, passo } = escalaBonita(Math.max(...totais));
      const svg = el("svg", { width: largura, height: altura, viewBox: `0 0 ${largura} ${altura}` }, alvo);

      // grade e eixo Y
      for (let v = 0; v <= max + 1e-9; v += passo) {
        const y = m.t + h - (v / max) * h;
        el("line", { x1: m.l, x2: m.l + w, y1: y, y2: y, stroke: v === 0 ? COR.eixo : COR.grade, "stroke-width": 1 }, svg);
        const t = el("text", { x: m.l - 6, y: y + 4, "text-anchor": "end", class: "rotuloEixo" }, svg);
        t.textContent = formatar(v, true);
      }

      const banda = w / rotulos.length;
      const larguraColuna = Math.max(2, Math.min(36, banda * 0.72));
      const cadaQuantos = Math.max(1, Math.ceil(46 / banda));
      rotulos.forEach((rotulo, i) => {
        const x = m.l + i * banda + (banda - larguraColuna) / 2;
        let base = m.t + h;
        const ativas = series.filter((s) => s.valores[i] > 0);
        series.forEach((serie) => {
          const v = serie.valores[i];
          if (!v) return;
          let hh = (v / max) * h;
          const topo = serie === ativas.at(-1);
          // 2px de respiro entre segmentos empilhados
          const espaco = serie !== ativas[0] ? 2 : 0;
          hh = Math.max(1, hh - espaco);
          base -= espaco;
          el("path", { d: topo ? colunaPath(x, base - hh, larguraColuna, hh, 4) : `M${x},${base}v${-hh}h${larguraColuna}v${hh}Z`, fill: serie.cor }, svg);
          base -= hh;
        });
        if (i % cadaQuantos === 0) {
          const t = el("text", { x: m.l + i * banda + banda / 2, y: m.t + h + 17, "text-anchor": "middle", class: "rotuloEixo" }, svg);
          t.textContent = rotulo;
        }
        // área de toque maior que a coluna
        const alvoHover = el("rect", { x: m.l + i * banda, y: m.t, width: banda, height: h, fill: "transparent", tabindex: 0 }, svg);
        const conteudo = () =>
          `<b>${rotulo}</b>` +
          series.map((s) => `<div><i style="background:${s.cor}"></i>${s.nome}: <b>${formatar(s.valores[i])}</b></div>`).join("") +
          detalhe(i);
        const mostrar = (e) => {
          alvoHover.setAttribute("fill", "rgba(140,150,180,0.08)");
          const r = alvoHover.getBoundingClientRect();
          mostrarDica(conteudo(), e?.clientX ?? r.left + r.width / 2, r.top);
        };
        const sair = () => {
          alvoHover.setAttribute("fill", "transparent");
          esconderDica();
        };
        alvoHover.addEventListener("pointerenter", mostrar);
        alvoHover.addEventListener("pointermove", mostrar);
        alvoHover.addEventListener("pointerleave", sair);
        alvoHover.addEventListener("focus", () => mostrar());
        alvoHover.addEventListener("blur", sair);
      });
    }
    desenhar();
    new ResizeObserver(() => desenhar()).observe(alvo);
  }

  // ---------- Barras horizontais (nomes longos, ex.: eventos) ----------
  function barras(alvo, itens, formatar) {
    if (!alvo) return;
    const maior = Math.max(...itens.map((i) => i.valor), 1);
    alvo.innerHTML = `<ol class="barrasH">${itens
      .map(
        (i) => `<li><span class="rotulo">${i.rotulo}</span><span class="trilho"><span class="barraH" style="width:${((i.valor / maior) * 100).toFixed(1)}%"></span></span><b>${formatar(i.valor)}</b></li>`,
      )
      .join("")}</ol>`;
  }

  // ---------- Mapa de calor (tabela) ----------
  function mapaCalor(alvo, { horas, linhas }) {
    if (!alvo) return;
    if (!linhas.length) {
      alvo.innerHTML = '<p class="vazioTexto">Sem dados.</p>';
      return;
    }
    const maior = Math.max(...linhas.flatMap((l) => l.valores), 1);
    const cor = (v) => RAMPA[Math.min(RAMPA.length - 1, Math.floor((v / maior) * (RAMPA.length - 1)))];
    alvo.innerHTML = `<table class="calor"><thead><tr><th></th>${horas.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${linhas
      .map(
        (l) =>
          `<tr><th>${l.nome}</th>${l.valores
            .map((v, j) => {
              if (!v) return '<td class="zero" title="0"></td>';
              const fundo = cor(v);
              const claro = RAMPA.indexOf(fundo) >= 6;
              return `<td style="background:${fundo};color:${claro ? "#0d1018" : "#e8ebf5"}" title="${l.nome}: ${v} às ${horas[j]}">${v}</td>`;
            })
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>
      <div class="escala"><span>menos</span>${RAMPA.map((c) => `<i style="background:${c}"></i>`).join("")}<span>mais</span></div>`;
  }

  // ---------- Montagem ----------
  const fluxo = dados.fluxo.blocos;
  colunas(document.getElementById("graficoFluxo"), {
    rotulos: fluxo.map((b) => b.rotulo),
    series: [
      { nome: "Dinheiro", cor: COR.serie1, valores: fluxo.map((b) => b.dinheiro) },
      { nome: "Pix", cor: COR.serie2, valores: fluxo.map((b) => b.pix) },
    ],
    formatar: (v) => num(v),
    detalhe: (i) => `<div class="totalDica">Valor: <b>${brl(fluxo[i].valor)}</b></div>`,
  });

  const tamanho = dados.pagamento.tamanho;
  const totalPedidos = tamanho.reduce((s, t) => s + t.pedidos, 0) || 1;
  colunas(document.getElementById("graficoTamanho"), {
    rotulos: tamanho.map((t) => `${t.rotulo} ${t.rotulo === "1" ? "item" : "itens"}`),
    series: [{ nome: "Pedidos", cor: COR.serie1, valores: tamanho.map((t) => t.pedidos) }],
    detalhe: (i) => `<div class="totalDica">${((100 * tamanho[i].pedidos) / totalPedidos).toFixed(0)}% dos pedidos</div>`,
  });

  const notas = dados.pagamento.notas_recebidas;
  colunas(document.getElementById("graficoNotas"), {
    rotulos: notas.map((n) => n.rotulo),
    series: [{ nome: "Pedidos", cor: COR.serie1, valores: notas.map((n) => n.pedidos) }],
  });

  if (dados.eventos.length) {
    barras(
      document.getElementById("graficoEventos"),
      dados.eventos.map((e) => ({ rotulo: e.nome, valor: e.arrecadado })),
      brl,
    );
  }

  mapaCalor(document.getElementById("mapaCalor"), dados.mapa_calor);

  document.querySelectorAll(".barraTabela").forEach((b) => (b.style.width = `${b.dataset.p}%`));

  // filtros: aplicam ao trocar, sem botão
  document.querySelectorAll("#filtros [data-auto]").forEach((s) => s.addEventListener("change", () => s.form.submit()));
})();
