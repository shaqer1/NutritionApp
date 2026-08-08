import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { SwUpdateService } from './core/sw-update.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (!useAuth || (auth.user$ | async)) {
      <div class="app">
        <router-outlet />
      </div>
      <nav class="tabs">
        <a routerLink="/today" routerLinkActive="active">
          <span class="ico">📊</span>Overview
        </a>
        <a routerLink="/inventory" routerLinkActive="active">
          <span class="ico">🧺</span>Inventory
        </a>
        <a routerLink="/groceries" routerLinkActive="active">
          <span class="ico">🛒</span>Groceries
        </a>
        <a routerLink="/recipes" routerLinkActive="active">
          <span class="ico">🍳</span>Recipes
        </a>
        <a routerLink="/coach" routerLinkActive="active">
          <span class="ico">🤖</span>Coach
        </a>
        <a routerLink="/workout" routerLinkActive="active">
          <span class="ico">🏋️</span>Workout
        </a>
      </nav>
    } @else if (auth.ready) {
      <div class="app login">
        <img src="assets/logo/logo.svg" alt="Lifestyle4U" style="width:96px;height:96px;margin-bottom:8px" />
        <h1>Lifestyle4U</h1>
        <p class="muted">Sign in to track your nutrition.</p>
        <button (click)="signIn()">Sign in with Google</button>
      </div>
    } @else if (showRecovery) {
      <div class="app login">
        <img src="assets/logo/logo.svg" alt="Lifestyle4U" style="width:96px;height:96px;margin-bottom:8px" />
        <h1>Having trouble loading</h1>
        <p class="muted">This can happen after switching networks. Resetting clears
          local app data and signs you out.</p>
        <button (click)="hardReset()">Reset &amp; reload</button>
      </div>
    }
  `,
})
export class AppComponent {
  auth = inject(AuthService);
  useAuth = environment.useAuth;
  showRecovery = false;

  constructor() {
    inject(SwUpdateService).init();
    if (this.useAuth) {
      setTimeout(() => {
        if (!this.auth.ready) this.showRecovery = true;
      }, 8000);
    }
  }

  signIn(): void {
    this.auth.signInWithGoogle();
  }

  /** Clears service workers, caches, and IndexedDB (Firebase Auth's persisted
   * session lives there) for cases where that local state gets stuck and
   * silently hangs every future auth check — the same fix as manually
   * clearing site data, without leaving the app. */
  async hardReset(): Promise<void> {
    try {
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
        await Promise.all(
          dbs.map((db) => db.name && indexedDB.deleteDatabase(db.name)),
        );
      }
    } finally {
      window.location.reload();
    }
  }
}
