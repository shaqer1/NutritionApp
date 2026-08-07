import { Injectable, NgZone } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  Auth, GoogleAuthProvider, User, getAuth, getIdToken, onAuthStateChanged,
  signInWithPopup, signOut,
} from 'firebase/auth';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Wraps Firebase Auth: Google sign-in and ID token retrieval for the API interceptor. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth;
  private userSubject = new BehaviorSubject<User | null>(null);
  /** Emits the current Firebase user, or null when signed out. Null until first auth check completes. */
  user$: Observable<User | null> = this.userSubject.asObservable();
  ready = false;

  constructor(private zone: NgZone) {
    const app = initializeApp(environment.firebaseConfig);
    this.auth = getAuth(app);
    // Firebase's auth-state resolution goes through IndexedDB callbacks that
    // zone.js does not patch, so this can fire outside Angular's zone and
    // silently fail to trigger a re-render (app stuck on the splash screen).
    onAuthStateChanged(this.auth, (user) => {
      this.zone.run(() => {
        this.ready = true;
        this.userSubject.next(user);
      });
    });
  }

  get currentUser(): User | null {
    return this.userSubject.value;
  }

  signInWithGoogle(): Promise<void> {
    return signInWithPopup(this.auth, new GoogleAuthProvider()).then(() => undefined);
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }

  /** Last successfully retrieved ID token, used as a fallback if a refresh stalls. */
  private lastToken: string | null = null;

  getIdToken(): Promise<string | null> {
    const user = this.currentUser;
    if (!user) return Promise.resolve(null);

    // Refreshing an expired token means a network round-trip to Google's
    // token endpoint. Right after a WiFi/network change that request can
    // hang indefinitely (no built-in fetch timeout) instead of erroring,
    // which would otherwise block every API call forever. Race it against a
    // timeout and fall back to the last known-good token so the app still
    // gets *something* to send rather than hanging.
    const refresh = getIdToken(user)
      .then((token) => {
        this.lastToken = token;
        return token;
      })
      .catch(() => this.lastToken);
    const timeout = new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(this.lastToken), 8000);
    });
    return Promise.race([refresh, timeout]);
  }
}
