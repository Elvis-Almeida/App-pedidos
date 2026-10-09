// =============================================================
//  SERVICE WORKER — deixa o app funcionando sem internet
//
//  IMPORTANTE: sempre que publicar uma mudança (cardápio, preço,
//  imagem, código), aumente a VERSAO abaixo. Assim os celulares
//  baixam tudo de novo na próxima vez que abrirem o app.
// =============================================================

const VERSAO = "v3-2026-10-09";
const CACHE = `scj-pedidos-${VERSAO}`;

// Caminhos relativos: funciona em qualquer domínio/pasta
const ARQUIVOS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./script/app.js",
  "./script/cardapio.js",
  "./script/db.js",
  "./script/dinheiro.js",
  "./script/menu.js",
  "./script/migracao.js",
  "./script/relatorio.js",
  "./script/ui.js",
  "./fonts/nunito-latin-400-normal.woff2",
  "./fonts/nunito-latin-600-normal.woff2",
  "./fonts/nunito-latin-700-normal.woff2",
  "./fonts/nunito-latin-800-normal.woff2",
  "./images/favicon.png",
  "./images/apple-touch-icon.png",
  "./images/icone-192.png",
  "./images/icone-512.png",
  "./images/alimentos/acai_250ml.webp",
  "./images/alimentos/acai_400ml.webp",
  "./images/alimentos/acai_500ml.webp",
  "./images/alimentos/bolo_no_pote.webp",
  "./images/alimentos/bombom.webp",
  "./images/alimentos/cachorro_quente.webp",
  "./images/alimentos/caldo.webp",
  "./images/alimentos/caldo_p.webp",
  "./images/alimentos/canjica.webp",
  "./images/alimentos/canjica_p.webp",
  "./images/alimentos/coca-cola.webp",
  "./images/alimentos/copo_de_refri.webp",
  "./images/alimentos/copo_de_suco.webp",
  "./images/alimentos/crepe.webp",
  "./images/alimentos/espetinho.webp",
  "./images/alimentos/fanta.webp",
  "./images/alimentos/galinha_caip.webp",
  "./images/alimentos/garrafa_de_agua.webp",
  "./images/alimentos/guarana_antarctica.webp",
  "./images/alimentos/jarra_de_suco.webp",
  "./images/alimentos/misto.webp",
  "./images/alimentos/pedaco_de_bolo.webp",
  "./images/alimentos/pitchula.webp",
  "./images/alimentos/pula_pula.webp",
  "./images/alimentos/river.webp",
  "./images/alimentos/salgados.webp",
  "./images/alimentos/torta_doce.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: "reload" ignora o cache HTTP do navegador e pega a versão nova
      .then((cache) => cache.addAll(ARQUIVOS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            // "test1" era o cache da versão antiga do app
            .filter((n) => (n.startsWith("scj-pedidos-") || n === "test1") && n !== CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Responde na hora com o que está no cache (rápido e offline) e, se
// tiver internet, atualiza o cache em segundo plano.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const emCache = await cache.match(request, { ignoreSearch: true });
      const daRede = fetch(request)
        .then((resposta) => {
          if (resposta.ok) cache.put(request, resposta.clone());
          return resposta;
        })
        .catch(() => null);

      if (emCache) {
        event.waitUntil(daRede);
        return emCache;
      }
      const resposta = await daRede;
      if (resposta) return resposta;
      if (request.mode === "navigate") return cache.match("./index.html");
      return Response.error();
    }),
  );
});
