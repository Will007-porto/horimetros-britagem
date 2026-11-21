/* Service worker do painel (PWA).
   - Telas do painel: rede primeiro (sempre a versão mais nova quando há internet); sem internet, abre a última guardada.
   - Bibliotecas e fontes (CDN): usa a guardada e atualiza por trás.
   - Supabase (dados e login) e a pasta /app/ (app de teste) passam direto: nunca são guardados aqui.
   - Versão nova NÃO assume sozinha: espera o usuário tocar em "Atualizar" no aviso do painel. */
const VERSAO = 'hb-2026-11-21f';
const CASCA = ['/', '/index.html', '/producao.js', '/producao.css', '/producao-rel.js', '/efi.js', '/manifest.webmanifest',
  '/assets/logo-azul.png', '/assets/logo-branco.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))));
});

/* Só troca de versão quando o painel pede (botão "Atualizar" do aviso) */
self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'ATUALIZAR') self.skipWaiting();
});

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/app/') || url.pathname === '/sw.js') return; // app de teste e o próprio SW: direto
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(req.mode === 'navigate' ? '/' : req, cp)); }
          return r;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? '/' : req, { ignoreSearch: req.mode === 'navigate' })
          .then((r) => r || caches.match('/')))
    );
    return;
  }

  if (CDN.test(req.url)) {
    e.respondWith(
      caches.open(VERSAO).then((c) => c.match(req).then((guardada) => {
        const rede = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => guardada);
        return guardada || rede;
      }))
    );
  }
  // qualquer outra coisa (Supabase etc.) passa direto, sem cache
});
