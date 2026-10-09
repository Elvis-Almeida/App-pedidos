// Todos os valores dentro do app são guardados em CENTAVOS (inteiros)
// para não ter erro de arredondamento (ex.: 0,1 + 0,2).

const formatador = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** 7550 → "R$ 75,50" */
export function formatarDinheiro(centavos) {
  // troca o espaço "não separável" por espaço normal (fica igual no .txt)
  return formatador.format((centavos || 0) / 100).replace(/ /g, " ");
}

/** reais (número do cardápio) → centavos */
export function reaisParaCentavos(reais) {
  return Math.round(Number(reais) * 100);
}

/**
 * Texto digitado → centavos.
 * "50" → 5000 · "12,5" → 1250 · "12.50" → 1250 · "" → 0
 */
export function lerValorDigitado(texto) {
  const limpo = String(texto).replace(/[^\d,.]/g, "").replace(",", ".");
  if (!limpo) return 0;
  const numero = parseFloat(limpo);
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

/** "R$ 1.234,56" → 123456 (usado só na migração do histórico antigo) */
export function lerValorFormatado(texto) {
  const limpo = String(texto).replace(/[^\d,]/g, "").replace(",", ".");
  const numero = parseFloat(limpo);
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}
