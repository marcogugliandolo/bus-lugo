// Xa Vén: guarda la web en el móvil para que abra sin cobertura y enseña los avisos
// que llegan del servidor, aunque la web esté cerrada.
//
// Con conexión siempre se pide la versión nueva (y se guarda); sin conexión, o si la red
// tarda demasiado, se sirve la guardada. Así un cambio publicado llega en la siguiente visita.

const CACHE = 'xaven-v2';
const CORE = [
  './', 'index.html', 'style.css', 'app.js', 'sim.js', 'plan.js', 'i18n.js', 'live.js',
  'pantalla.html', 'pantalla.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
  'data/network.json', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'vendor/fonts/atkinson-hyperlegible-next-latin-400-normal.woff2',
  'vendor/fonts/atkinson-hyperlegible-next-latin-700-normal.woff2',
  'vendor/fonts/bricolage-grotesque-latin-700-normal.woff2',
];
// Las calles solo hacen falta sin conexión (con conexión el mapa viene de fuera): se guardan aparte.
const LATER = ['data/streets.json', 'data/map-style.json'];
const NETWORK_WAIT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.allSettled(LATER.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

/** La red primero; si no responde a tiempo o no hay, lo guardado. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS, null));
  try {
    const first = await Promise.race([fromNetwork, timeout]);
    if (first) return first;
  } catch { /* sin red: se mira lo guardado */ }
  const saved = await cache.match(request, { ignoreSearch: true });
  if (saved) return saved;
  if (request.mode === 'navigate') {
    const page = await cache.match(new URL(request.url).pathname.endsWith('pantalla.html') ? 'pantalla.html' : 'index.html');
    if (page) return page;
  }
  return fromNetwork;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Solo lo de la propia web: ni la API (que tiene que ser fresca) ni el mapa o el buscador de fuera.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(networkFirst(request));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* aviso sin datos */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Xa Vén', {
    body: data.body || 'Tu bus está a punto de llegar',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag,
    renotify: Boolean(data.tag),
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/demo/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/demo/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
