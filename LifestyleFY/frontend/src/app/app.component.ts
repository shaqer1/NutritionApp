import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { HamburgerMenuService } from './core/hamburger-menu.service';
import { clearLocalAppData } from './core/local-data';
import { ProfilePanelComponent } from './core/profile-panel.component';
import { PushNotificationsService } from './core/push-notifications.service';
import { SwUpdateService } from './core/sw-update.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ProfilePanelComponent],
  template: `
    @if (foregroundToast) {
      <div style="position:fixed;top:8px;left:8px;right:8px;z-index:300;background:var(--card);
        border:1px solid var(--border);border-radius:10px;padding:10px 14px;box-shadow:0 6px 16px rgba(0,0,0,.4)">
        {{ foregroundToast }}
      </div>
    }
    @if (!useAuth || (auth.user$ | async)) {
      <header class="topbar">
        <button class="icon-btn" (click)="hamburger.toggle()"
          [attr.aria-label]="hamburger.override()?.label ?? 'Menu'">{{ hamburger.override()?.icon ?? '☰' }}</button>
        <div class="topbar-title">Lifestyle4U</div>
        <button class="icon-btn" (click)="showProfilePanel = !showProfilePanel" aria-label="Profile">
          @if (auth.currentUser?.photoURL) {
            <img [src]="auth.currentUser?.photoURL" alt="" />
          } @else {
            <span>👤</span>
          }
        </button>
      </header>
      @if (showProfilePanel) {
        <app-profile-panel (closed)="showProfilePanel = false" />
      }
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
  hamburger = inject(HamburgerMenuService);
  useAuth = environment.useAuth;
  showRecovery = false;
  showProfilePanel = false;
  foregroundToast: string | null = null;

  constructor() {
    inject(SwUpdateService).init();
    const push = inject(PushNotificationsService);
    push.selfHealRegistration();
    push.onForegroundMessage((title, body) => {
      this.foregroundToast = `${title}: ${body}`;
      setTimeout(() => (this.foregroundToast = null), 6000);
    });
    if (this.useAuth) {
      setTimeout(() => {
        if (!this.auth.ready) this.showRecovery = true;
      }, 8000);
    }
  }

  signIn(): void {
    this.auth.signInWithGoogle();
  }

  async hardReset(): Promise<void> {
    try {
      await clearLocalAppData();
    } finally {
      window.location.reload();
    }
  }
}
