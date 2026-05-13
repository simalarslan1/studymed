// Service Worker for StudyMed Push Notifications
self.addEventListener('push', function(event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'StudyMed',
      body: event.data.text(),
      roomId: null
    };
  }

  const title = data.title || 'StudyMed';
  const options = {
    body: data.body || 'Ders çalışmaya davet edildiniz!',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'study-invite-' + (data.roomId || 'default'),
    renotify: true,
    requireInteraction: true,
    data: {
      roomId: data.roomId,
      fromName: data.fromName,
      url: data.roomId ? '/room/' + data.roomId : '/'
    },
    actions: [
      {
        action: 'join',
        title: '✅ Katıl'
      },
      {
        action: 'decline',
        title: '❌ Reddet'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'decline') {
    return;
  }

  // Default click or 'join' action
  const roomUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  const fullUrl = self.location.origin + roomUrl;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Check if there's already a window open with this URL
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }

      // Check if there's any window we can navigate
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(fullUrl).then(c => c && c.focus());
        }
      }

      // Open a new window
      if (clients.openWindow) {
        return clients.openWindow(fullUrl);
      }
    })
  );
});

self.addEventListener('notificationclose', function(event) {
  // Notification was dismissed without action
  console.log('Notification closed:', event.notification.tag);
});
