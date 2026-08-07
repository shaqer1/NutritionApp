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
    }
  `,
})
export class AppComponent {
  auth = inject(AuthService);
  useAuth = environment.useAuth;

  constructor() {
    inject(SwUpdateService).init();
  }

  signIn(): void {
    this.auth.signInWithGoogle();
  }
}
