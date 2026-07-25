import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { InventoryItem, Macros } from '../core/models';

@Component({
  selector: 'app-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Log a meal</h1>

    <div class="card">
      <label>Meal</label>
      <select [(ngModel)]="meal">
        <option value="breakfast">Breakfast</option>
        <option value="lunch">Lunch</option>
        <option value="dinner">Dinner</option>
        <option value="snack">Snack</option>
      </select>

      <label>Food name</label>
      <input [(ngModel)]="name" placeholder="e.g. Chicken & rice" />

      <div class="row">
        <div style="flex:1"><label>Calories</label>
          <input type="number" [(ngModel)]="macros.cal" /></div>
        <div style="flex:1"><label>Protein (g)</label>
          <input type="number" [(ngModel)]="macros.protein" /></div>
      </div>
      <div class="row">
        <div style="flex:1"><label>Carbs (g)</label>
          <input type="number" [(ngModel)]="macros.carbs" /></div>
        <div style="flex:1"><label>Fat (g)</label>
          <input type="number" [(ngModel)]="macros.fat" /></div>
      </div>
      <label>Servings</label>
      <input type="number" [(ngModel)]="servings" min="0.25" step="0.25" />

      <div style="margin-top:14px">
        <button class="green" [disabled]="!name" (click)="submit()">Log it</button>
      </div>
    </div>

    @if (pantry.length) {
      <div class="card">
        <h3>From pantry</h3>
        <p class="muted">Tap to prefill from an item you scanned in.</p>
        @for (p of pantry; track p.item_id) {
          <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <span>{{ p.name }} <span class="muted">— {{ p.qty }} left</span></span>
            <button class="ghost" (click)="fromPantry(p)">Use</button>
          </div>
        }
      </div>
    }
  `,
})
export class LogComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);

  meal = 'lunch';
  name = '';
  servings = 1;
  macros: Macros = {
    cal: 0, protein: 0, carbs: 0, fat: 0,
    sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0,
  };
  fromInventory = false;
  selectedItemId: string | null = null;
  pantry: InventoryItem[] = [];

  ngOnInit(): void {
    this.api.listInventory().subscribe((r) => (this.pantry = r.items));
  }

  fromPantry(p: InventoryItem): void {
    this.name = p.name;
    this.macros = { ...p.per_serving };
    this.fromInventory = true;
    this.selectedItemId = p.item_id ?? null;
  }

  submit(): void {
    this.api.log({
      meal: this.meal, item_name: this.name, servings: this.servings,
      macros: this.macros, source: 'manual', from_inventory: this.fromInventory,
      inventory_item_id: this.selectedItemId,
    }).subscribe(() => this.router.navigate(['/today']));
  }
}
