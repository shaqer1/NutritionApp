import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'today' },
  {
    path: 'today',
    loadComponent: () => import('./pages/today.component').then((m) => m.TodayComponent),
  },
  {
    path: 'scan',
    loadComponent: () => import('./pages/scan.component').then((m) => m.ScanComponent),
  },
  {
    path: 'log',
    loadComponent: () => import('./pages/log.component').then((m) => m.LogComponent),
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('./pages/inventory.component').then((m) => m.InventoryComponent),
  },
  {
    path: 'goals',
    loadComponent: () => import('./pages/goals.component').then((m) => m.GoalsComponent),
  },
  {
    path: 'coach',
    loadComponent: () => import('./pages/coach.component').then((m) => m.CoachComponent),
  },
  { path: '**', redirectTo: 'today' },
];
