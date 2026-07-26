import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AiPromptPanelComponent } from '../core/ai-prompt-panel.component';
import { InventoryItem, LogEntry, Macros, Recipe } from '../core/models';
import {
  MEAL_TYPES, mealLabel as sharedMealLabel, existingInstances as sharedExistingInstances,
  nextInstance as sharedNextInstance, todayStr, currentMealType,
} from '../core/meal-picker';

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [CommonModule, FormsModule, AiPromptPanelComponent],
  template: `
    <h1>Recipes</h1>

    <div class="card blue">
      <h3>Generate a recipe</h3>
      <p class="muted">Suggests something using what's actually in your pantry, sized
        to fit what's left in your macro budget for the meal below.</p>
      <label>Which meal is this for?</label>
      <select [(ngModel)]="mealPeriod" style="max-width:160px">
        @for (mt of mealTypes; track mt) {
          <option [value]="mt">{{ mt }}</option>
        }
      </select>
      <label style="margin-top:10px;display:block">Ask something specific
        <span class="muted">(sent with this request only)</span></label>
      <textarea [(ngModel)]="message" rows="2" placeholder="e.g. I feel like tacos, how do I make them?"
        style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
               border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>
      <div style="margin-top:10px">
        <button (click)="generate()">Generate</button>
      </div>
      <p class="muted">{{ status }}</p>
    </div>

    <app-ai-prompt-panel category="recipe" [fetchPreview]="previewRecipe" />

    @if (draft) {
      <div class="card">
        <h3>{{ draft.recipe_id ? 'Edit recipe' : 'New recipe (unsaved)' }}</h3>
        <label>Name</label>
        <input [(ngModel)]="draft.name" placeholder="e.g. Chicken & rice bowl" />
        <label>Servings</label>
        <input type="number" [(ngModel)]="draft.servings" min="1" style="max-width:90px" />
        <label>Instructions</label>
        <textarea [(ngModel)]="draft.instructions" rows="4"
          style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
                 border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>

        <label>Ingredients</label>
        @for (ing of draft.ingredients; track $index) {
          <div class="row" style="margin-bottom:8px">
            <input [(ngModel)]="ing.name" placeholder="Name" style="flex:2" />
            <input type="number" [(ngModel)]="ing.quantity" placeholder="Qty" style="flex:1;max-width:70px" />
            <input [(ngModel)]="ing.unit" placeholder="unit" style="flex:1;max-width:70px" />
            <button class="ghost" (click)="removeIngredient($index)">✕</button>
          </div>
        }
        <button class="ghost" (click)="addIngredient()">+ Add ingredient</button>

        <div class="row" style="margin-top:12px">
          <button class="green" [disabled]="!draft.name" (click)="save()">Save recipe</button>
          <button class="ghost" (click)="draft = undefined">Discard</button>
        </div>
      </div>
    }

    @if (recipes.length) {
      <div class="card">
        <h3>Saved recipes</h3>
        @for (r of recipes; track r.recipe_id) {
          <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
              <div>{{ r.name }}</div>
              <div class="muted">
                {{ r.servings }} serving{{ r.servings === 1 ? '' : 's' }} ·
                {{ r.ingredients.length }} ingredient{{ r.ingredients.length === 1 ? '' : 's' }}
              </div>
            </div>
            <div class="row">
              <button class="ghost" (click)="openLogPanel(r)">Log</button>
              <button class="ghost" (click)="edit(r)">Edit</button>
              <button class="ghost" (click)="remove(r)">✕</button>
            </div>
          </div>

          @if (logStatusRecipeId === r.recipe_id && logStatus) {
            <p class="muted" style="margin:-4px 0 8px">{{ logStatus }}</p>
          }
          @if (logPanelRecipeId === r.recipe_id) {
            <div style="margin:-4px 0 10px;padding:10px;border:1px solid var(--border);border-radius:10px">
              <label>Servings eaten</label>
              <input type="number" [(ngModel)]="logServingsEaten" min="0.25" step="0.25" style="max-width:90px" />
              <p class="muted" style="margin-top:8px">Which meal?</p>
              @for (mt of mealTypes; track mt) {
                <div style="margin-bottom:8px">
                  <div class="muted" style="text-transform:capitalize">{{ mt }}</div>
                  <div class="row" style="flex-wrap:wrap;gap:8px">
                    @for (inst of existingInstances(mt); track inst) {
                      <button class="ghost" (click)="logRecipe(r, mt, inst)">{{ mealLabel(mt, inst) }}</button>
                    }
                    <button class="ghost" (click)="logRecipe(r, mt, nextInstance(mt))">
                      + New {{ mt }}
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        }
      </div>
    }
  `,
})
export class RecipesComponent implements OnInit {
  private api = inject(ApiService);
  status = '';
  draft?: Recipe;
  recipes: Recipe[] = [];

  mealTypes = MEAL_TYPES;
  mealPeriod = currentMealType();
  message = '';
  previewRecipe = () => this.api.suggestRecipePreview(this.mealPeriod);

  logPanelRecipeId: string | null = null;
  logServingsEaten = 1;
  logStatus = '';
  logStatusRecipeId: string | null = null;
  private pickerEntries: LogEntry[] = [];
  private pantryItems: InventoryItem[] = [];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.listRecipes().subscribe((r) => (this.recipes = r.recipes));
  }

  generate(): void {
    this.status = 'Thinking up a recipe using your pantry…';
    this.api.suggestRecipe(this.mealPeriod, this.message).subscribe({
      next: (r) => { this.draft = r.recipe; this.status = ''; this.message = ''; },
      error: () => (this.status = 'Could not generate a recipe.'),
    });
  }

  addIngredient(): void {
    if (!this.draft) return;
    this.draft.ingredients.push({
      name: '', quantity: 1, unit: 'unit',
      macros: {
        cal: 0, protein: 0, carbs: 0, fat: 0,
        sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0,
      },
    });
  }

  removeIngredient(i: number): void {
    this.draft?.ingredients.splice(i, 1);
  }

  save(): void {
    if (!this.draft) return;
    this.api.saveRecipe(this.draft).subscribe(() => {
      this.draft = undefined;
      this.status = 'Recipe saved.';
      this.reload();
    });
  }

  edit(r: Recipe): void {
    this.draft = { ...r, ingredients: r.ingredients.map((i) => ({ ...i })) };
  }

  remove(r: Recipe): void {
    if (!r.recipe_id) return;
    this.api.deleteRecipe(r.recipe_id).subscribe(() => this.reload());
  }

  // ---------- Log this recipe as a meal ----------
  openLogPanel(r: Recipe): void {
    const isOpen = this.logPanelRecipeId === r.recipe_id;
    this.logPanelRecipeId = isOpen ? null : (r.recipe_id ?? null);
    if (isOpen) return;
    this.logServingsEaten = r.servings;
    this.logStatus = '';
    this.api.getLog(todayStr()).subscribe((res) => (this.pickerEntries = res.entries));
    this.api.listInventory().subscribe((res) => (this.pantryItems = res.items));
  }

  existingInstances(mealType: string): number[] {
    return sharedExistingInstances(this.pickerEntries, mealType);
  }

  nextInstance(mealType: string): number {
    return sharedNextInstance(this.pickerEntries, mealType);
  }

  mealLabel(mealType: string, instance: number): string {
    return sharedMealLabel(mealType, instance);
  }

  logRecipe(r: Recipe, mealType: string, instance: number): void {
    // Known simplification (stated in the plan): a recipe ingredient's
    // quantity is assumed to already be in the same unit as the matched
    // pantry ingredient's own serving count — no general unit conversion.
    const scaleFactor = this.logServingsEaten / (r.servings || 1);
    const calls = r.ingredients
      .filter((ing) => ing.quantity > 0)
      .map((ing) => {
        const servings = ing.quantity * scaleFactor;
        const perUnit: Macros = {
          cal: ing.macros.cal / ing.quantity,
          protein: ing.macros.protein / ing.quantity,
          carbs: ing.macros.carbs / ing.quantity,
          fat: ing.macros.fat / ing.quantity,
          sugar_g: ing.macros.sugar_g / ing.quantity,
          fiber_g: ing.macros.fiber_g / ing.quantity,
          sat_fat_g: ing.macros.sat_fat_g / ing.quantity,
          sodium_mg: ing.macros.sodium_mg / ing.quantity,
        };
        const pantryItem = ing.item_id
          ? this.pantryItems.find((p) => p.item_id === ing.item_id) : undefined;
        const grams = pantryItem?.serving_qty_g != null
          ? servings * pantryItem.serving_qty_g : null;
        return this.api.log({
          meal: mealType, meal_instance: instance, item_name: ing.name,
          source: 'manual', servings, macros: perUnit, grams,
          inventory_item_id: ing.item_id ?? null, log_date: todayStr(),
        });
      });

    this.logStatusRecipeId = r.recipe_id ?? null;
    if (!calls.length) {
      this.logStatus = 'Nothing to log — this recipe has no ingredients.';
      return;
    }
    forkJoin(calls).subscribe({
      next: () => {
        this.logStatus = `Logged ${this.mealLabel(mealType, instance)}.`;
        this.logPanelRecipeId = null;
      },
      error: () => (this.logStatus = 'Some ingredients failed to log.'),
    });
  }
}
