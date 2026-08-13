/** Clears service workers, caches, and IndexedDB (Firebase Auth's persisted
 * session lives there) — used both for the "stuck on splash" recovery button
 * and for a clean sign-out, so switching accounts never leaves stale auth
 * state behind. Caller is responsible for reloading afterward. */
export async function clearLocalAppData(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((db) => db.name && indexedDB.deleteDatabase(db.name)));
  }
}
