import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app">
      <router-outlet />
    </div>
    <nav class="tabs">
      <a routerLink="/today" routerLinkActive="active">
        <span class="ico">📊</span>Today
      </a>
      <a routerLink="/scan" routerLinkActive="active">
        <span class="ico">📷</span>Scan
      </a>
      <a routerLink="/log" routerLinkActive="active">
        <span class="ico">🍽️</span>Log
      </a>
      <a routerLink="/inventory" routerLinkActive="active">
        <span class="ico">🧺</span>Pantry
      </a>
      <a routerLink="/goals" routerLinkActive="active">
        <span class="ico">🎯</span>Goals
      </a>
      <a routerLink="/coach" routerLinkActive="active">
        <span class="ico">🤖</span>Coach
      </a>
    </nav>
  `,
})
export class AppComponent {}
