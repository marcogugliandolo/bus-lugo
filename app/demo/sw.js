// Xa Vén: enseña en el móvil los avisos que llegan del servidor, aunque la web esté cerrada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
