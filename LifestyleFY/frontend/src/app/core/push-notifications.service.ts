import { Injectable, inject } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, onMessage } from 'firebase/messaging';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiService } from './api.service';

const TOKEN_STORAGE_KEY = 'push_device_token';

/** Wraps Firebase Cloud Messaging: permission + token registration/cleanup,
 * plus a self-heal re-registration so an out-of-band token revoke (e.g. an
 * admin "revoke notifications" action) silently fixes itself on next load
 * instead of requiring the user to sign in again. */
@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private api = inject(ApiService);
  private app = initializeApp(environment.firebaseConfig);

  private get messaging() {
    return getMessaging(this.app);
  }

  /** Requests browser permission (if not already granted/denied) and
   * registers the resulting token with the backend. Resolves true if the
   * user now has an active registration. */
  async ensurePermissionAndToken(): Promise<boolean> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
    return this.registerCurrentToken();
  }

  /** Silently re-registers the current token if permission was already
   * granted in a previous session — call once on app bootstrap. No-op (and
   * no prompt) if permission was never granted or was denied. */
  async selfHealRegistration(): Promise<void> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission !== 'granted') return;
    await this.registerCurrentToken();
  }

  private async registerCurrentToken(): Promise<boolean> {
    try {
      const registration = await navigator.serviceWorker.ready;
      const token = await getToken(this.messaging, {
        vapidKey: environment.vapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) return false;
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      await firstValueFrom(this.api.registerDeviceToken(token));
      return true;
    } catch {
      return false;
    }
  }

  /** Wraps foreground pushes — these don't auto-show an OS notification, so
   * the caller is expected to surface something in-app (e.g. a toast). */
  onForegroundMessage(callback: (title: string, body: string) => void): void {
    onMessage(this.messaging, (payload) => {
      callback(payload.notification?.title ?? 'Lifestyle4U', payload.notification?.body ?? '');
    });
  }

  /** Unsubscribes this browser from FCM entirely and removes the backend
   * record — called on sign-out. */
  async unregister(): Promise<void> {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) return;
    try {
      await deleteToken(this.messaging);
      await firstValueFrom(this.api.unregisterDeviceToken(token));
    } catch {
      // best-effort — a leftover token just gets pruned server-side the
      // next time a send to it fails.
    } finally {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }
}
