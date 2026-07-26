import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
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
          <span class="ico">📊</span>Today
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
      </nav>
    } @else if (auth.ready) {
      <div class="app login">
        <h1>LifestyleFY</h1>
        <p class="muted">Sign in to track your nutrition.</p>
        <button (click)="signIn()">Sign in with Google</button>
      </div>
    }
  `,
})
export class AppComponent {
  auth = inject(AuthService);
  useAuth = environment.useAuth;

  signIn(): void {
    this.auth.signInWithGoogle();
  }
}
