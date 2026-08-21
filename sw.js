// Service worker mínimo — existe principalmente para satisfazer o
// requisito do Chrome/Android de ter um SW registrado para permitir
// "Adicionar à tela inicial" em modo standalone (sem barra de endereço).
//
// De propósito NÃO fazemos cache agressivo de conteúdo aqui, porque
// esse projeto depende de dados sempre atualizados (Google Sheets) e
// cache de página poderia servir uma versão desatualizada da roleta
// durante o evento — o que é pior do que não ter modo offline.

const VERSAO_CACHE = 'roleta-cf-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) => {
      return Promise.all(
        chaves
          .filter((chave) => chave !== VERSAO_CACHE)
          .map((chave) => caches.delete(chave))
      );
    })
  );
  self.clients.claim();
});

// Passa direto pra rede (network-first), sem interceptar/cachear nada.
// Isso garante que o tablet sempre pegue a versão mais nova do HTML/JS.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
