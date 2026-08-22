// Production environment.
export const environment = {
  production: true,
  apiBase: 'https://nutrition-api-311101817139.us-central1.run.app',
  useAuth: true,
  firebaseConfig: {
    apiKey: 'AIzaSyCHBQ6vkjr7Tox-k7mwY8DZ87fIr46Y2-I',
    authDomain: 'gen-lang-client-0347523959.firebaseapp.com',
    projectId: 'gen-lang-client-0347523959',
    storageBucket: 'gen-lang-client-0347523959.firebasestorage.app',
    messagingSenderId: '311101817139',
    appId: '1:311101817139:web:737cf1ba2b493655cebe46',
  },
  // Cloud Messaging > Web configuration > "Web Push certificates" in the Firebase console.
  vapidKey: 'BE0B8vcqrVkqIggYWWpV1gUtsEGVAsxEQQmfZkcX1diSrXvnPGjHsLjFKQ3msNwmhWlEaWQU5h_42N_elPt4QdQ',
};
