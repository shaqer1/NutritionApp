import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AiPromptPanelComponent } from '../core/ai-prompt-panel.component';
import { HamburgerMenuService } from '../core/hamburger-menu.service';
import { ImageUrlFieldComponent } from '../core/image-url-field.component';
import { InventoryItem, LogEntry, Macros, Recipe, RecipeIngredient } from '../core/models';
import {
  MEAL_TYPES, mealLabel as sharedMealLabel, existingInstances as sharedExistingInstances,
  nextInstance as sharedNextInstance, todayStr, currentMealType,
} from '../core/meal-picker';

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [CommonModule, FormsModule, AiPromptPanelComponent, ImageUrlFieldComponent],
  template: `
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

    @if (hamburger.open()) {
      <div class="slide-panel-backdrop" (click)="hamburger.close()"></div>
      <div class="slide-panel">
        <button class="slide-panel-close" (click)="hamburger.close()" aria-label="Close">✕</button>
        <app-ai-prompt-panel category="recipe" [fetchPreview]="previewRecipe" />
      </div>
    }

    <div class="row" style="margin-top:10px">
      <button class="ghost" (click)="newRecipe()">+ New recipe (manual)</button>
    </div>

    @if (draft) {
      <div class="card">
        <h3>{{ draft.recipe_id ? 'Edit recipe' : 'New recipe (unsaved)' }}</h3>
        <label>Name</label>
        <input [(ngModel)]="draft.name" placeholder="e.g. Chicken & rice bowl" />
        <div class="row">
          <div style="flex:1"><label>Servings</label>
            <input type="number" [(ngModel)]="draft.servings" min="1" /></div>
          <div style="flex:1"><label>Meal</label>
            <select [(ngModel)]="draft.meal">
              <option value="">Unset</option>
              @for (mt of mealTypes; track mt) {
                <option [value]="mt">{{ mt }}</option>
              }
            </select></div>
        </div>
        <label>Image URL</label>
        <app-image-url-field [(value)]="draft.image_url" />
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

        <p class="muted" style="margin-bottom:4px">Add an ingredient from your pantry
          <span class="muted">(quantity = servings of that item)</span></p>
        <div class="row" style="margin-bottom:8px;align-items:flex-start">
          <div class="searchable-dropdown" style="flex:2">
            <input [(ngModel)]="pantrySearchQuery" (ngModelChange)="onPantryQueryChange()"
              (focus)="pantryDropdownOpen = true" (blur)="closePantryDropdownSoon()"
              placeholder="Search pantry…" />
            @if (pantryDropdownOpen && filteredPantryItems.length) {
              <div class="searchable-dropdown-list">
                @for (p of filteredPantryItems; track p.item_id) {
                  <div (mousedown)="$event.preventDefault(); selectPantryItem(p)">
                    {{ p.name }} <span class="muted">({{ p.qty }} {{ p.unit }} left)</span>
                  </div>
                }
              </div>
            }
          </div>
          <input type="number" [(ngModel)]="pickerQty" min="0.25" step="0.25"
            placeholder="Servings" style="flex:1;max-width:90px" />
          <button class="ghost" [disabled]="!pickerItemId" (click)="addIngredientFromPantry()">+ Add</button>
        </div>
        @if (!pantryItems.length) {
          <p class="muted">Your pantry is empty — add ingredients in Inventory first.</p>
        }

        <label class="row" style="align-items:center;gap:6px;margin-top:10px">
          <input type="checkbox" [(ngModel)]="isCookedRecipe" style="width:auto" />
          <span class="muted">I just cooked this — use up the pantry ingredients above and
            add the result as a fridge item</span>
        </label>

        <div class="row" style="margin-top:12px">
          <button class="green" [disabled]="!draft.name" (click)="save()">Save recipe</button>
          <button class="ghost" (click)="draft = undefined">Discard</button>
        </div>
      </div>
    }

    @if (recipes.length) {
      <div class="card">
        <h3>Saved recipes</h3>
        <div class="seg" style="margin-bottom:10px">
          <button [class.active]="!showArchived" (click)="showArchived = false">Active</button>
          <button [class.active]="showArchived" (click)="showArchived = true">Archived</button>
        </div>
        <div class="row" style="margin-bottom:10px">
          <input [(ngModel)]="searchQuery" placeholder="Search recipes…" style="flex:2" />
          <select [(ngModel)]="mealFilter" style="flex:1">
            <option value="all">All meals</option>
            @for (mt of mealTypes; track mt) {
              <option [value]="mt">{{ mt }}</option>
            }
            <option value="unset">Unset</option>
          </select>
        </div>
        @if (!filteredRecipes.length) {
          <p class="muted">
            {{ searchQuery || mealFilter !== 'all' ? 'No recipes match your search.' : (showArchived ? 'No archived recipes.' : 'No active recipes yet.') }}
          </p>
        }
        @for (r of filteredRecipes; track r.recipe_id) {
          <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div class="row">
              @if (r.image_url) {
                <img [src]="r.image_url" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover" />
              }
              <div>
                <div style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--border)"
                  (click)="openView(r)">{{ r.name }}</div>
                <div class="muted">
                  {{ r.servings }} serving{{ r.servings === 1 ? '' : 's' }} ·
                  {{ r.ingredients.length }} ingredient{{ r.ingredients.length === 1 ? '' : 's' }}
                  @if (r.meal) { · {{ r.meal }} }
                </div>
              </div>
            </div>
            <div class="row">
              @if (!showArchived) {
                <button class="ghost" (click)="openLogPanel(r)">Log</button>
                <button class="ghost" (click)="edit(r)">Edit</button>
                <button class="ghost" (click)="archive(r)">Archive</button>
              } @else {
                <button class="ghost" (click)="restore(r)">Restore</button>
                <button class="ghost" (click)="removePermanently(r)">Delete permanently</button>
              }
            </div>
          </div>

          @if (!showArchived && logStatusRecipeId === r.recipe_id && logStatus) {
            <p class="muted" style="margin:-4px 0 8px">{{ logStatus }}</p>
          }
          @if (!showArchived && logPanelRecipeId === r.recipe_id) {
            <div style="margin:-4px 0 10px;padding:10px;border:1px solid var(--border);border-radius:10px">
              <label>Servings eaten</label>
              <input type="number" [(ngModel)]="logServingsEaten" min="0.25" step="0.25" style="max-width:90px" />
              <label style="margin-top:8px;display:block">Date</label>
              <input type="date" [(ngModel)]="logDate" (ngModelChange)="onLogDateChange()" style="max-width:150px" />
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

    @if (viewingRecipe) {
      <div class="modal-backdrop" (click)="closeView()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <button class="slide-panel-close" (click)="closeView()" aria-label="Close">✕</button>
          <h2>{{ viewingRecipe.name }}</h2>
          @if (viewingRecipe.image_url) {
            <img [src]="viewingRecipe.image_url" alt=""
              style="width:100%;border-radius:10px;margin-bottom:10px;max-height:200px;object-fit:cover" />
          }
          <p class="muted">
            {{ viewingRecipe.servings }} serving{{ viewingRecipe.servings === 1 ? '' : 's' }}
            @if (viewingRecipe.meal) { · {{ viewingRecipe.meal }} }
          </p>
          @if (viewingRecipe.instructions) {
            <h3 style="margin-top:14px">Instructions</h3>
            <p style="white-space:pre-wrap;margin:0">{{ viewingRecipe.instructions }}</p>
          }
          @if (viewingRecipe.ingredients.length) {
            <h3 style="margin-top:14px">Ingredients</h3>
            @for (ing of viewingRecipe.ingredients; track $index) {
              <div class="row spread" style="padding:4px 0">
                <span>{{ ing.name }}</span>
                <span class="muted">{{ ing.quantity }} {{ ing.unit }}</span>
              </div>
            }
          }
        </div>
      </div>
    }
  `,
})
export class RecipesComponent implements OnInit {
  private api = inject(ApiService);
  hamburger = inject(HamburgerMenuService);
  status = '';
  draft?: Recipe;
  isCookedRecipe = false;
  recipes: Recipe[] = [];

  mealTypes = MEAL_TYPES;
  mealPeriod = currentMealType();
  message = '';
  previewRecipe = () => this.api.suggestRecipePreview(this.mealPeriod);

  logPanelRecipeId: string | null = null;
  logServingsEaten = 1;
  logDate = todayStr();
  logStatus = '';
  logStatusRecipeId: string | null = null;
  private pickerEntries: LogEntry[] = [];
  pantryItems: InventoryItem[] = [];

  showArchived = false;
  pickerItemId: string | null = null;
  pickerQty = 1;
  searchQuery = '';
  mealFilter = 'all';

  // Searchable pantry-item dropdown (draft ingredient picker)
  pantrySearchQuery = '';
  pantryDropdownOpen = false;

  viewingRecipe?: Recipe;

  ngOnInit(): void {
    this.reload();
    this.api.listInventory().subscribe((res) => (this.pantryItems = res.items));
  }

  get filteredRecipes(): Recipe[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.recipes
      .filter((r) => (r.is_active ?? true) === !this.showArchived)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => this.mealFilter === 'all'
        || (this.mealFilter === 'unset' ? !r.meal : r.meal === this.mealFilter));
  }

  get filteredPantryItems(): InventoryItem[] {
    const q = this.pantrySearchQuery.trim().toLowerCase();
    return this.pantryItems.filter((p) => !q || p.name.toLowerCase().includes(q));
  }

  reload(): void {
    this.api.listRecipes().subscribe((r) => (this.recipes = r.recipes));
  }

  generate(): void {
    this.status = 'Thinking up a recipe using your pantry…';
    this.api.suggestRecipe(this.mealPeriod, this.message).subscribe({
      next: (r) => { this.draft = { ...r.recipe, meal: this.mealPeriod }; this.status = ''; this.message = ''; },
      error: () => (this.status = 'Could not generate a recipe.'),
    });
  }

  onPantryQueryChange(): void {
    // Typing over a previously-selected item's name invalidates that
    // selection until a fresh pick is made from the (now re-filtered) list.
    const selected = this.pantryItems.find((p) => p.item_id === this.pickerItemId);
    if (selected && selected.name !== this.pantrySearchQuery) this.pickerItemId = null;
  }

  selectPantryItem(p: InventoryItem): void {
    this.pickerItemId = p.item_id ?? null;
    this.pantrySearchQuery = p.name;
    this.pantryDropdownOpen = false;
  }

  closePantryDropdownSoon(): void {
    setTimeout(() => (this.pantryDropdownOpen = false), 150);
  }

  openView(r: Recipe): void {
    this.viewingRecipe = r;
  }

  closeView(): void {
    this.viewingRecipe = undefined;
  }

  newRecipe(): void {
    this.draft = {
      name: '', servings: 1, instructions: '', ingredients: [], meal: this.mealPeriod,
      source: 'manual', image_url: null,
    };
    this.isCookedRecipe = false;
  }

  addIngredientFromPantry(): void {
    if (!this.draft || !this.pickerItemId) return;
    const item = this.pantryItems.find((p) => p.item_id === this.pickerItemId);
    if (!item) return;
    const qty = this.pickerQty || 1;
    this.draft.ingredients.push({
      item_id: item.item_id, name: item.name, quantity: qty, unit: item.unit,
      macros: {
        cal: item.per_serving.cal * qty, protein: item.per_serving.protein * qty,
        carbs: item.per_serving.carbs * qty, fat: item.per_serving.fat * qty,
        sugar_g: item.per_serving.sugar_g * qty, fiber_g: item.per_serving.fiber_g * qty,
        sat_fat_g: item.per_serving.sat_fat_g * qty, sodium_mg: item.per_serving.sodium_mg * qty,
      },
    });
    this.pickerItemId = null;
    this.pickerQty = 1;
    this.pantrySearchQuery = '';
  }

  removeIngredient(i: number): void {
    this.draft?.ingredients.splice(i, 1);
  }

  save(): void {
    if (!this.draft) return;
    const cookNow = this.isCookedRecipe;
    const name = this.draft.name;
    const servings = this.draft.servings || 1;
    const ingredients = this.draft.ingredients.map((i) => ({ ...i }));
    this.api.saveRecipe(this.draft).subscribe(() => {
      this.draft = undefined;
      this.isCookedRecipe = false;
      this.status = cookNow ? 'Recipe saved. Updating pantry…' : 'Recipe saved.';
      this.reload();
      if (cookNow) this.cookRecipe(name, servings, ingredients);
    });
  }

  /** Marks a recipe as cooked: uses up the linked pantry ingredients (by the
   * servings picked for each) and adds the result as a new fridge item, with
   * per-serving macros/grams computed by summing the ingredients used. */
  private cookRecipe(name: string, servings: number, ingredients: RecipeIngredient[]): void {
    const usedQty = new Map<string, number>();
    for (const ing of ingredients) {
      if (!ing.item_id) continue;
      usedQty.set(ing.item_id, (usedQty.get(ing.item_id) ?? 0) + ing.quantity);
    }
    const decrementCalls: Observable<{ item: InventoryItem }>[] = [];
    for (const [itemId, qty] of usedQty) {
      const pantryItem = this.pantryItems.find((p) => p.item_id === itemId);
      if (!pantryItem) continue;
      decrementCalls.push(this.api.addInventory({ ...pantryItem, qty: Math.max(0, pantryItem.qty - qty) }));
    }

    const totalGrams = ingredients.reduce((sum, ing) => {
      const pantryItem = ing.item_id ? this.pantryItems.find((p) => p.item_id === ing.item_id) : undefined;
      return sum + (pantryItem?.serving_qty_g != null ? pantryItem.serving_qty_g * ing.quantity : 0);
    }, 0);
    const totalMacros: Macros = ingredients.reduce((sum, ing) => ({
      cal: sum.cal + ing.macros.cal, protein: sum.protein + ing.macros.protein,
      carbs: sum.carbs + ing.macros.carbs, fat: sum.fat + ing.macros.fat,
      sugar_g: sum.sugar_g + ing.macros.sugar_g, fiber_g: sum.fiber_g + ing.macros.fiber_g,
      sat_fat_g: sum.sat_fat_g + ing.macros.sat_fat_g, sodium_mg: sum.sodium_mg + ing.macros.sodium_mg,
    }), { cal: 0, protein: 0, carbs: 0, fat: 0, sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0 });

    // Ingredient totals cover the whole batch (all `servings` of it) — divide
    // down to get the per-serving macros/grams that `per_serving` represents.
    const perServingMacros: Macros = {
      cal: totalMacros.cal / servings, protein: totalMacros.protein / servings,
      carbs: totalMacros.carbs / servings, fat: totalMacros.fat / servings,
      sugar_g: totalMacros.sugar_g / servings, fiber_g: totalMacros.fiber_g / servings,
      sat_fat_g: totalMacros.sat_fat_g / servings, sodium_mg: totalMacros.sodium_mg / servings,
    };
    const perServingGrams = totalGrams / servings;

    const cookedItem: InventoryItem = {
      name, source: 'manual', category: 'prepared', location: 'fridge',
      item_id: null, qty: servings, unit: 'serving', initial_qty: servings,
      per_serving: perServingMacros,
      serving_size: '1 serving', serving_size_qty: 1, serving_size_unit: 'serving',
      serving_qty: perServingGrams || null, serving_unit: perServingGrams ? 'g' : null,
      serving_qty_g: perServingGrams || null,
      ingredients_text: ingredients.map((i) => i.name).join(', ') || null,
      image_url: null,
    };

    forkJoin([...decrementCalls, this.api.addInventory(cookedItem)]).subscribe({
      next: () => {
        this.status = `Recipe saved. Added "${name}" to the fridge and updated pantry.`;
        this.api.listInventory().subscribe((res) => (this.pantryItems = res.items));
      },
      error: () => (this.status = 'Recipe saved, but updating the pantry failed.'),
    });
  }

  edit(r: Recipe): void {
    this.draft = { ...r, ingredients: r.ingredients.map((i) => ({ ...i })) };
    this.isCookedRecipe = false;
  }

  archive(r: Recipe): void {
    this.api.saveRecipe({ ...r, is_active: false }).subscribe(() => this.reload());
  }

  restore(r: Recipe): void {
    this.api.saveRecipe({ ...r, is_active: true }).subscribe(() => this.reload());
  }

  removePermanently(r: Recipe): void {
    if (!r.recipe_id) return;
    this.api.deleteRecipe(r.recipe_id).subscribe(() => this.reload());
  }

  // ---------- Log this recipe as a meal ----------
  openLogPanel(r: Recipe): void {
    const isOpen = this.logPanelRecipeId === r.recipe_id;
    this.logPanelRecipeId = isOpen ? null : (r.recipe_id ?? null);
    if (isOpen) return;
    this.logServingsEaten = r.servings;
    this.logDate = todayStr();
    this.logStatus = '';
    this.api.getLog(this.logDate).subscribe((res) => (this.pickerEntries = res.entries));
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

  onLogDateChange(): void {
    this.api.getLog(this.logDate).subscribe((res) => (this.pickerEntries = res.entries));
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
          inventory_item_id: ing.item_id ?? null, log_date: this.logDate,
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
