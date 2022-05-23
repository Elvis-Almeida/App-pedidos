const CACHE_NAME = 'test1'
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/sw.js',
    '/css/style.css',
    '/script/script.js',
    '/images/iconeApp.png',
    '/images/favicon.png',
    '/images/alimentos/caldo.png',
    '/images/alimentos/canjica.png',
    '/images/alimentos/espetinho.png',
    '/images/alimentos/galinha_caip.png',
    '/images/alimentos/crepe.png',
    '/images/alimentos/misto.png',
    '/images/alimentos/cachorro_quente.png',
    '/images/alimentos/coca-cola.png',
    '/images/alimentos/fanta.png',
    '/images/alimentos/guarana_antarctica.png',
    '/images/alimentos/river.png',
    '/images/alimentos/copo_de_refri.png',
    '/images/alimentos/copo_de_suco.png',
    '/images/alimentos/torta_doce.png',
    '/images/alimentos/salgados.png'
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


   