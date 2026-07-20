// Development environment. Points at the local FastAPI backend running in
// stub mode (DEV_NO_AUTH=true). No auth token is sent in dev.
export const environment = {
  production: false,
  apiBase: 'http://localhost:8080',
  // When you wire Firebase Auth, set this true and provide getIdToken().
  useAuth: false,
};
