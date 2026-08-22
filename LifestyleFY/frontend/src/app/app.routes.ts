import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'today' },
  {
    path: 'today',
    loadComponent: () => import('./pages/today.component').then((m) => m.TodayComponent),
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('./pages/inventory.component').then((m) => m.InventoryComponent),
  },
  {
    path: 'inventory/item/:itemId',
    loadComponent: () =>
      import('./pages/inventory-item.component').then((m) => m.InventoryItemComponent),
  },
  {
    path: 'groceries',
    loadComponent: () =>
      import('./pages/groceries.component').then((m) => m.GroceriesComponent),
  },
  {
    path: 'recipes',
    loadComponent: () =>
      import('./pages/recipes.component').then((m) => m.RecipesComponent),
  },
  {
    path: 'coach',
    loadComponent: () => import('./pages/coach.component').then((m) => m.CoachComponent),
  },
  {
    path: 'workout',
    loadComponent: () => import('./pages/workout.component').then((m) => m.WorkoutComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: 'today' },
];
