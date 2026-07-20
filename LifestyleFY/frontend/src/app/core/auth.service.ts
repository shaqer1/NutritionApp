import { Injectable } from '@angular/core';
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

  constructor() {
    const app = initializeApp(environment.firebaseConfig);
    this.auth = getAuth(app);
    onAuthStateChanged(this.auth, (user) => {
      this.ready = true;
      this.userSubject.next(user);
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

  getIdToken(): Promise<string | null> {
    const user = this.currentUser;
    return user ? getIdToken(user) : Promise.resolve(null);
  }
}
