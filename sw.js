const CACHE_NAME = 'test1'
const urlsToCache = [
    '/App-pedidos/',
    '/App-pedidos/index.html',
    '/App-pedidos/manifest.json',
    '/App-pedidos/sw.js',
    '/App-pedidos/css/style.css',
    '/App-pedidos/script/script.js',
    '/App-pedidos/images/iconeApp.png',
    '/App-pedidos/images/favicon.png',
    '/App-pedidos/images/alimentos/caldo.png',
    '/App-pedidos/images/alimentos/canjica.png',
    '/App-pedidos/images/alimentos/espetinho.png',
    '/App-pedidos/images/alimentos/galinha_caip.png',
    '/App-pedidos/images/alimentos/crepe.png',
    '/App-pedidos/images/alimentos/misto.png',
    '/App-pedidos/images/alimentos/cachorro_quente.png',
    '/App-pedidos/images/alimentos/coca-cola.png',
    '/App-pedidos/images/alimentos/fanta.png',
    '/App-pedidos/images/alimentos/guarana_antarctica.png',
    '/App-pedidos/images/alimentos/river.png',
    '/App-pedidos/images/alimentos/copo_de_refri.png',
    '/App-pedidos/images/alimentos/copo_de_suco.png',
    '/App-pedidos/images/alimentos/torta_doce.png',
    '/App-pedidos/images/alimentos/salgados.png'
]

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            console.log('cache aberto');
            return cache.addAll(urlsToCache)
        })
    )
})

self.addEventListener('activate', event => {
    console.log('ativate');
    event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch',  event => {
    console.log('fatch');
     event.respondWith(caches.match(event.request).then(response => {
            return response || fetch(event.request)
        })
	    // .catch(() => {
        //     return caches.match('/index.html');
        //   })
    )
})


   