// Combined service worker: FCM background push handling + the Angular PWA
// worker, registered as a single file (a page can only be controlled by one
// SW registration at a time, so this imports ngsw-worker.js at the end
// rather than registering two separate service workers).
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

// Public web config (safe to inline — not a secret), must match environment.ts.
firebase.initializeApp({
  apiKey: 'AIzaSyCHBQ6vkjr7Tox-k7mwY8DZ87fIr46Y2-I',
  authDomain: 'gen-lang-client-0347523959.firebaseapp.com',
  projectId: 'gen-lang-client-0347523959',
  storageBucket: 'gen-lang-client-0347523959.firebasestorage.app',
  messagingSenderId: '311101817139',
  appId: '1:311101817139:web:737cf1ba2b493655cebe46',
});

const messaging = firebase.messaging();

// Fires when a push arrives while no app tab has focus (or is closed).
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Lifestyle4U';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, { body, icon: 'assets/logo/logo.svg', data: payload.data });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});

// Angular CLI generates this file at build time next to this one — load it
// last so its own install/activate/fetch handlers still run in this worker.
importScripts('./ngsw-worker.js');
