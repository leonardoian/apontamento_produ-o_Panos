// Versão do cache: PRECISA ser alterada a cada deploy que muda index.html,
// senão o activate abaixo não tem o que limpar e o shell antigo sobrevive.
const CACHE = 'superpro-v2';
const SHELL = ['/style.css', '/favicon.svg', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  // API: só rede. Um erro de rede precisa CHEGAR como erro — devolver
  // 200 com {"error":"offline"} fazia o r.ok do helper api() ser true, e
  // uma importação interrompida parecia ter gravado.
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sem conexão com o servidor.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Navegação e index.html: rede primeiro, cache só como reserva offline.
  // Com cache-first, um deploy que mexesse no HTML ou nas rotas da API
  // deixava o app antigo rodando contra a API nova.
  const ehNavegacao = e.request.mode === 'navigate' ||
                      new URL(e.request.url).pathname === '/index.html';
  if (ehNavegacao) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copia));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/')))
    );
    return;
  }

  // Demais estáticos (css, ícones): cache primeiro, atualizando ao fundo.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const rede = fetch(e.request).then(res => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return res;
      });
      return cached || rede;
    })
  );
});
