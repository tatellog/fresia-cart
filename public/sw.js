// Service worker del panel de Frésia Office: recibe las notificaciones push de pedidos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Frésia Office', body: 'Tienes un pedido nuevo.', url: '/admin', tag: 'pedido' };
  try {
    data = { ...data, ...event.data.json() };
  } catch (_) {
    /* sin datos: aviso genérico */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      // Android: vibración más larga, en tres pulsos (iOS usa el sonido del sistema).
      vibrate: [400, 200, 400, 200, 800],
      icon: '/brand/icon-192.png',
      badge: '/brand/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/admin', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const panel = wins.find((w) => w.url.startsWith(self.location.origin + '/admin'));
      if (panel) return panel.navigate(url).then((w) => (w || panel).focus());
      return self.clients.openWindow(url);
    }),
  );
});
