// =============================================================
//  SERVICE WORKER — deixa o app funcionando sem internet
//  Gerado pelo Django: a VERSAO muda a cada deploy, então os aparelhos
//  baixam o app novo sozinhos na próxima vez que abrirem.
// =============================================================

const VERSAO = "{{ versao|escapejs }}";
const CACHE_APP = `vendas-app-${VERSAO}`;
const CACHE_MIDIA = "vendas-midia"; // fotos e logo: nomes com hash, valem para sempre

const ARQUIVOS = [
{% for arquivo in arquivos %}  "{{ arquivo|escapejs }}",
{% endfor %}];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_APP)
      .then((cache) => cache.addAll(ARQUIVOS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => n.startsWith("vendas-app-") && n !== CACHE_APP).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

function deveCuidar(url) {
  if (url.origin !== self.location.origin) return false;
  // API e admin sempre vão direto ao servidor
  return !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/admin") && url.pathname !== "/sw.js";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || !deveCuidar(url)) return;

  // Fotos/logo: do cache primeiro (o nome muda quando a imagem muda)
  if (url.pathname.startsWith("/media/")) {
    event.respondWith(
      caches.open(CACHE_MIDIA).then(async (cache) => {
        const guardada = await cache.match(request);
        if (guardada) return guardada;
        const resposta = await fetch(request);
        if (resposta.ok) cache.put(request, resposta.clone());
        return resposta;
      }),
    );
    return;
  }

  // App: responde na hora com o que está guardado e atualiza por trás
  event.respondWith(
    caches.open(CACHE_APP).then(async (cache) => {
      const chave = request.mode === "navigate" ? "/" : request;
      const guardada = await cache.match(chave, { ignoreSearch: true });
      const daRede = fetch(request)
        .then((resposta) => {
          if (resposta.ok) cache.put(chave, resposta.clone());
          return resposta;
        })
        .catch(() => null);
      if (guardada) {
        event.waitUntil(daRede);
        return guardada;
      }
      return (await daRede) || Response.error();
    }),
  );
});
