import {
  Component, ElementRef, OnDestroy, OnInit, ViewChild, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { ApiService } from '../core/api.service';
import { FoodItem, InventoryItem, LogEntry } from '../core/models';
import {
  APP_CATEGORIES, LOCATIONS, Location, CategoryMeta, defaultLocation,
} from '../core/categories';
import {
  MEAL_TYPES, mealLabel as sharedMealLabel, existingInstances as sharedExistingInstances,
  nextInstance as sharedNextInstance, todayStr,
} from '../core/meal-picker';

interface Shelf {
  meta: CategoryMeta;
  items: InventoryItem[];
}

interface MealGroup {
  label: string;
  meal: string;
  instance: number;
  items: LogEntry[];
  totalCal: number;
}

type MacroKey = 'protein' | 'carbs' | 'fat';

interface MacroSlice {
  group: MealGroup;
  macro: MacroKey | 'none';
  key: string;
  color: string;
  path: string;
}

interface IngredientSlice {
  item: LogEntry;
  index: number;
  path: string;
}

const MEAL_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
const MEAL_COLORS: Record<string, string> = {
  breakfast: 'var(--green)', lunch: 'var(--blue)', dinner: 'var(--accent)', snack: '#e0a44d',
};
const MACRO_ORDER: MacroKey[] = ['protein', 'carbs', 'fat'];
const MACRO_COLORS: Record<MacroKey, string> = {
  protein: '#9b6bcb', carbs: '#f0c94b', fat: '#39c0ba',
};
const LOCATION_EMOJI: Record<Location, string> = {
  pantry: '🧺', fridge: '🧊', freezer: '🥶',
};

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="card">
      <div class="row spread" style="cursor:pointer" (click)="addOpen = !addOpen">
        <h3>Add / Scan</h3>
        <span class="muted">{{ addOpen ? '▲' : '▼' }}</span>
      </div>
      @if (addOpen) {
        <div style="margin-top:10px">
          <div class="seg">
            <button [class.active]="addMode === 'camera'" (click)="addMode = 'camera'">Camera</button>
            <button [class.active]="addMode === 'search'" (click)="addMode = 'search'">Search</button>
            <button [class.active]="addMode === 'manual'" (click)="addMode = 'manual'">Manual entry</button>
          </div>

          @if (addMode === 'camera') {
            <div style="margin-top:10px">
              <video #video playsinline></video>
              <div class="row" style="margin-top:10px">
                @if (!scanning) {
                  <button (click)="startCamera()">Start camera</button>
                } @else {
                  <button class="ghost" (click)="stopCamera()">Stop</button>
                }
              </div>
              <p class="muted">{{ scanStatus }}</p>
            </div>
          } @else if (addMode === 'search') {
            <div style="margin-top:10px">
              <label>Barcode or product name</label>
              <div class="row">
                <input [(ngModel)]="manualQuery" placeholder="e.g. 3017620422003 or 'greek yogurt'" />
                <button class="ghost" (click)="lookupManual()">Find</button>
              </div>
              <p class="muted">{{ scanStatus }}</p>
            </div>
          } @else {
            <div style="margin-top:10px">
              <label>Name</label>
              <input [(ngModel)]="manualEntry.name" placeholder="e.g. Homemade chili" />
              <div class="row">
                <div style="flex:1"><label>Category</label>
                  <select [(ngModel)]="manualEntry.category">
                    @for (c of categories; track c.id) {
                      <option [value]="c.id">{{ c.emoji }} {{ c.label }}</option>
                    }
                  </select>
                </div>
                <div style="flex:1"><label>Location</label>
                  <select [(ngModel)]="manualEntry.location">
                    @for (l of locations; track l.id) {
                      <option [value]="l.id">{{ l.label }}</option>
                    }
                  </select>
                </div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Servings in container</label>
                  <input type="number" [(ngModel)]="manualEntry.qty" min="0" /></div>
                <div style="flex:1"><label>Unit</label>
                  <input [(ngModel)]="manualEntry.unit" placeholder="unit" /></div>
              </div>
              <label>Serving size <span class="muted">(informational, e.g. "1 bar")</span></label>
              <div class="row">
                <div style="flex:1"><input type="number" [(ngModel)]="manualEntry.servingSizeQty" placeholder="1" /></div>
                <div style="flex:1"><input [(ngModel)]="manualEntry.servingSizeUnit" placeholder="bar" /></div>
              </div>
              <label>Quantity per serving <span class="muted">(used for grams tracking)</span></label>
              <div class="row">
                <div style="flex:1"><label>Amount</label>
                  <input type="number" [(ngModel)]="manualEntry.servingQty" /></div>
                <div style="flex:1"><label>Unit</label>
                  <input [(ngModel)]="manualEntry.servingUnit" placeholder="g" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Calories</label>
                  <input type="number" [(ngModel)]="manualEntry.cal" /></div>
                <div style="flex:1"><label>Protein</label>
                  <input type="number" [(ngModel)]="manualEntry.protein" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Carbs</label>
                  <input type="number" [(ngModel)]="manualEntry.carbs" /></div>
                <div style="flex:1"><label>Fat</label>
                  <input type="number" [(ngModel)]="manualEntry.fat" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Sugar (g)</label>
                  <input type="number" [(ngModel)]="manualEntry.sugar_g" /></div>
                <div style="flex:1"><label>Fiber (g)</label>
                  <input type="number" [(ngModel)]="manualEntry.fiber_g" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Saturated fat (g)</label>
                  <input type="number" [(ngModel)]="manualEntry.sat_fat_g" /></div>
                <div style="flex:1"><label>Sodium (mg)</label>
                  <input type="number" [(ngModel)]="manualEntry.sodium_mg" /></div>
              </div>
              <label>Image URL</label>
              <input [(ngModel)]="manualEntry.image_url" placeholder="https://..." />
              <label>Ingredients</label>
              <textarea [(ngModel)]="manualEntry.ingredients_text" rows="3"
                placeholder="e.g. Chicken, rice, onion, garlic, salt"
                style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
                       border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>
              <div style="margin-top:10px">
                <button class="green" [disabled]="!manualEntry.name" (click)="submitManualEntry()">
                  Add to pantry
                </button>
              </div>
              <p class="muted">{{ scanStatus }}</p>
            </div>
          }

          @if (showManualMacros) {
            <div class="card" style="margin-top:10px">
              <h3>No match — enter macros manually</h3>
              <label>Name</label>
              <input [(ngModel)]="manualMacros.name" placeholder="e.g. Homemade chili" />
              <div class="row">
                <div style="flex:1"><label>Calories</label>
                  <input type="number" [(ngModel)]="manualMacros.cal" /></div>
                <div style="flex:1"><label>Protein</label>
                  <input type="number" [(ngModel)]="manualMacros.protein" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Carbs</label>
                  <input type="number" [(ngModel)]="manualMacros.carbs" /></div>
                <div style="flex:1"><label>Fat</label>
                  <input type="number" [(ngModel)]="manualMacros.fat" /></div>
              </div>
              <label>Serving size <span class="muted">(informational, e.g. "1 bar")</span></label>
              <div class="row">
                <div style="flex:1"><input type="number" [(ngModel)]="manualMacros.servingSizeQty" placeholder="1" /></div>
                <div style="flex:1"><input [(ngModel)]="manualMacros.servingSizeUnit" placeholder="bar" /></div>
              </div>
              <label>Quantity per serving <span class="muted">(used for grams tracking)</span></label>
              <div class="row">
                <div style="flex:1"><label>Amount</label>
                  <input type="number" [(ngModel)]="manualMacros.servingQty" /></div>
                <div style="flex:1"><label>Unit</label>
                  <input [(ngModel)]="manualMacros.servingUnit" placeholder="g" /></div>
              </div>
              <div style="margin-top:10px">
                <button class="green" [disabled]="!manualMacros.name" (click)="useManualMacros()">
                  Use these macros
                </button>
              </div>
            </div>
          }

          @if (results.length) {
            <div style="margin-top:10px">
              <h3>Search results</h3>
              @for (r of results; track r.name) {
                <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--border)">
                  <div>
                    <div>{{ r.name }}</div>
                    <div class="muted">{{ r.per_serving.cal | number:'1.0-0' }} kcal ·
                      {{ r.per_serving.protein | number:'1.0-0' }}g protein</div>
                  </div>
                  <button class="ghost" (click)="pick(r)">Pick</button>
                </div>
              }
            </div>
          }

          @if (found) {
            <div class="card green" style="margin-top:10px">
              <h3>{{ found.name }}</h3>
              <p class="muted">
                {{ found.per_serving.cal | number:'1.0-0' }} kcal ·
                {{ found.per_serving.protein | number:'1.0-0' }}p ·
                {{ found.per_serving.carbs | number:'1.0-0' }}c ·
                {{ found.per_serving.fat | number:'1.0-0' }}f
                · via {{ found.source }}
              </p>
              @if (found.macros_basis === '100g') {
                <p style="color:var(--accent);font-size:13px;margin:-4px 0 8px">
                  ⚠ source only gave per-100g data — these numbers may not match the
                  actual serving size below. Double-check before logging.
                </p>
              }

              <label>Serving size <span class="muted">(informational, e.g. "1 bar")</span></label>
              <div class="row">
                <div style="flex:1"><input type="number" [(ngModel)]="found.serving_size_qty" placeholder="1" /></div>
                <div style="flex:1"><input [(ngModel)]="found.serving_size_unit" placeholder="bar" /></div>
              </div>
              <label>Quantity per serving <span class="muted">(used for grams tracking)</span></label>
              <div class="row">
                <div style="flex:1"><label>Amount</label>
                  <input type="number" [(ngModel)]="found.serving_qty" (ngModelChange)="onFoundServingChange()" /></div>
                <div style="flex:1"><label>Unit</label>
                  <input [(ngModel)]="found.serving_unit" placeholder="g" (ngModelChange)="onFoundServingChange()" /></div>
              </div>

              <label>Servings in container</label>
              <div class="row">
                <input type="number" [(ngModel)]="foundQty" min="1" style="max-width:90px" />
                <button class="green" (click)="addFoundToPantry()">Add to pantry</button>
                <button class="ghost" (click)="openMealPicker()">Log as eaten</button>
              </div>
              @if (found.serving_qty) {
                <p class="muted" style="margin-top:6px">
                  Total in container: ≈{{ foundQty * found.serving_qty | number:'1.0-1' }} {{ found.serving_unit }}
                </p>
              }

              @if (mealPickerOpen) {
                <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
                  <p class="muted">Which meal?</p>
                  @for (mt of mealTypes; track mt) {
                    <div style="margin-bottom:8px">
                      <div class="muted" style="text-transform:capitalize">{{ mt }}</div>
                      <div class="row" style="flex-wrap:wrap;gap:8px">
                        @for (inst of existingInstances(mt); track inst) {
                          <button class="ghost" (click)="logFound(mt, inst)">{{ mealLabel(mt, inst) }}</button>
                        }
                        <button class="ghost" (click)="logFound(mt, nextInstance(mt))">
                          + New {{ mt }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    <div class="seg">
      <button [class.active]="viewMode === 'log'" (click)="setViewMode('log')">Log</button>
      <button [class.active]="viewMode === 'pantry'" (click)="setViewMode('pantry')">Pantry</button>
    </div>

    @if (viewMode === 'log') {
      <div class="card">
        <div class="row spread">
          <button class="ghost" (click)="changeDay(-1)">←</button>
          <h3>{{ dateLabel() }}</h3>
          <button class="ghost" (click)="changeDay(1)">→</button>
        </div>
        @if (!isToday()) {
          <div class="row" style="justify-content:center;margin-top:8px">
            <button class="ghost" (click)="goToday()">Today</button>
          </div>
        }
      </div>

      @if (!mealGroups.length) {
        <div class="card"><p class="muted">Nothing logged {{ isToday() ? 'today' : 'that day' }} yet.</p></div>
      } @else {
        <div class="card">
          <svg viewBox="0 0 100 100" style="width:200px;height:200px;display:block;margin:0 auto">
            @for (s of macroSlices; track s.key) {
              <path [attr.d]="s.path" [attr.fill]="s.color" style="cursor:pointer"
                [style.opacity]="isSelected(s.group) ? 1 : 0.85"
                (click)="selectSlice(s.group)" />
            }
            @if (selectedGroup) {
              @for (s of ingredientSlices; track s.index) {
                <path [attr.d]="s.path" [attr.fill]="mealColor(selectedGroup.meal)" style="cursor:pointer"
                  [style.opacity]="selectedIngredientIndex === null || selectedIngredientIndex === s.index ? 1 : 0.45"
                  stroke="var(--card)" stroke-width="1"
                  (click)="selectIngredient(s.index)" />
              }
            }
          </svg>
          <div class="row" style="flex-wrap:wrap;gap:14px;justify-content:center;margin-top:12px">
            @for (g of mealGroups; track g.label) {
              <div style="cursor:pointer;text-align:center" (click)="selectSlice(g)">
                <div class="row" style="gap:5px;justify-content:center">
                  <span style="width:10px;height:10px;border-radius:3px;display:inline-block"
                    [style.background]="mealColor(g.meal)"></span>
                  <span class="muted">{{ g.label }} · {{ g.totalCal | number:'1.0-0' }} kcal</span>
                </div>
                <div class="row" style="gap:3px;justify-content:center;margin-top:3px">
                  @for (m of macroOrder; track m) {
                    <span style="width:8px;height:8px;border-radius:2px;display:inline-block"
                      [style.background]="macroColor(m)"></span>
                  }
                  <span class="muted" style="font-size:11px">
                    P{{ groupMacros(g).protein | number:'1.0-0' }} ·
                    C{{ groupMacros(g).carbs | number:'1.0-0' }} ·
                    F{{ groupMacros(g).fat | number:'1.0-0' }}
                  </span>
                </div>
              </div>
            }
          </div>
        </div>

        @for (g of mealGroups; track g.label) {
          @if (isSelected(g)) {
            <div class="card">
              <div class="row spread">
                <h3>{{ g.label }}</h3>
                <span class="muted">{{ g.totalCal | number:'1.0-0' }} kcal</span>
              </div>
              @if (isActiveMeal(g)) {
                <p class="muted" style="margin:-4px 0 8px">Tap an ingredient for its macro breakdown.</p>
                @for (item of g.items; track item.ts + item.item_name; let idx = $index) {
                  <div class="row spread" style="padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer"
                    [style.opacity]="selectedIngredientIndex === null || selectedIngredientIndex === idx ? 1 : 0.6"
                    (click)="selectIngredient(idx)">
                    <span>{{ item.item_name }} <span class="muted">×{{ item.servings }}</span>
                      @if (item.grams) { <span class="muted">· {{ item.grams | number:'1.0-0' }}g</span> }
                    </span>
                    <span class="muted">{{ item.macros.cal | number:'1.0-0' }} kcal</span>
                  </div>
                }
                <div class="row" style="margin-top:10px;gap:16px">
                  <span class="muted">P {{ groupMacros(g).protein | number:'1.0-0' }}g</span>
                  <span class="muted">C {{ groupMacros(g).carbs | number:'1.0-0' }}g</span>
                  <span class="muted">F {{ groupMacros(g).fat | number:'1.0-0' }}g</span>
                </div>

                @if (selectedIngredient; as ing) {
                  <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
                    <div class="row spread"><h3 style="margin:0">{{ ing.item_name }}</h3>
                      <span class="muted">{{ ing.macros.cal | number:'1.0-0' }} kcal</span></div>
                    <div class="row" style="margin-top:6px;gap:16px">
                      <span class="muted">P {{ ing.macros.protein | number:'1.0-0' }}g</span>
                      <span class="muted">C {{ ing.macros.carbs | number:'1.0-0' }}g</span>
                      <span class="muted">F {{ ing.macros.fat | number:'1.0-0' }}g</span>
                      @if (ing.grams) { <span class="muted">{{ ing.grams | number:'1.0-0' }}g</span> }
                    </div>
                    @if (ing.log_id) {
                      <div class="row" style="margin-top:8px">
                        <button class="ghost" (click)="deleteLogEntry(ing)">Delete this entry</button>
                      </div>
                    }
                  </div>
                }
              } @else {
                @for (item of g.items; track item.ts + item.item_name) {
                  <div class="row spread" style="padding:6px 0;border-bottom:1px solid var(--border)">
                    <span>{{ item.item_name }} <span class="muted">×{{ item.servings }}</span></span>
                    <span class="muted">{{ item.macros.cal | number:'1.0-0' }} kcal</span>
                  </div>
                }
                <div class="row" style="margin-top:10px;gap:16px">
                  <span class="muted">P {{ groupMacros(g).protein | number:'1.0-0' }}g</span>
                  <span class="muted">C {{ groupMacros(g).carbs | number:'1.0-0' }}g</span>
                  <span class="muted">F {{ groupMacros(g).fat | number:'1.0-0' }}g</span>
                </div>
              }
            </div>
          }
        }
      }
    } @else {
      <div class="seg">
        @for (loc of pantryTabs; track loc.id) {
          <button [class.active]="activeLocation === loc.id" (click)="activeLocation = loc.id">
            {{ locationEmoji(loc.id) }} {{ loc.label }}
          </button>
        }
      </div>

      <div class="seg" style="margin-top:8px">
        <button [class.active]="stockFilter === 'inStock'" (click)="stockFilter = 'inStock'">In Stock</button>
        <button [class.active]="stockFilter === 'all'" (click)="stockFilter = 'all'">All</button>
        <button [class.active]="stockFilter === 'outOfStock'" (click)="stockFilter = 'outOfStock'">Out of Stock</button>
      </div>

      @if (!shelves.length) {
        <div class="card"><p class="muted">Nothing here yet — scan groceries or add above.</p></div>
      }
      @for (shelf of shelves; track shelf.meta.id) {
        <div class="card">
          <div class="row spread" style="align-items:center;cursor:pointer" (click)="toggleCategory(shelf.meta.id)">
            <h3 style="margin:0">
              {{ shelf.meta.emoji }} {{ shelf.meta.label }}
              <span class="muted" style="font-weight:normal">({{ shelf.items.length }})</span>
            </h3>
            <span class="muted">{{ expandedCategoryIds.has(shelf.meta.id) ? '▲' : '▼' }}</span>
          </div>

          @if (!expandedCategoryIds.has(shelf.meta.id)) {
            <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
              @for (it of shelf.items; track it.item_id) {
                @if (it.image_url) {
                  <img class="thumb" [src]="it.image_url" alt="" style="width:32px;height:32px" />
                } @else {
                  <div class="thumb" style="width:32px;height:32px;font-size:16px">{{ shelf.meta.emoji }}</div>
                }
              }
            </div>
          } @else {
            <div class="grid-cards">
              @for (it of shelf.items; track it.item_id) {
                <div class="item-card">
                  <a [routerLink]="['/inventory/item', it.item_id]" style="text-decoration:none;color:inherit">
                    @if (it.image_url) {
                      <img class="thumb" [src]="it.image_url" alt="" style="width:100%;height:60px;font-size:22px" />
                    } @else {
                      <div class="thumb" style="width:100%;height:60px;font-size:22px">{{ shelf.meta.emoji }}</div>
                    }
                    <div class="muted" style="font-size:11px;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      {{ it.name }}
                    </div>
                  </a>
                  <div class="row spread" style="margin-top:5px;gap:2px;flex-wrap:nowrap">
                    <button class="ghost" style="padding:2px 6px" (click)="adjustQty(it, -1)">－</button>
                    <span style="font-size:13px;white-space:nowrap">{{ it.qty }}</span>
                    <button class="ghost" style="padding:2px 6px" (click)="adjustQty(it, 1)">＋</button>
                  </div>
                  <button class="ghost" style="width:100%;margin-top:5px;padding:3px" (click)="removeItem(it)">🗑</button>
                </div>
              }
            </div>
          }
        </div>
      }
    }
  `,
})
export class InventoryComponent implements OnInit, OnDestroy {
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  private api = inject(ApiService);
  private reader = new BrowserMultiFormatReader();
  private controls?: IScannerControls;

  // ---------- Add / Scan section ----------
  addOpen = false;
  addMode: 'camera' | 'search' | 'manual' = 'search';
  scanning = false;
  scanStatus = 'Point the camera at a barcode, or type one below.';
  manualQuery = '';
  results: FoodItem[] = [];
  showManualMacros = false;
  manualMacros = {
    name: '', cal: 0, protein: 0, carbs: 0, fat: 0,
    servingSizeQty: null as number | null, servingSizeUnit: '',
    servingQty: null as number | null, servingUnit: '',
  };

  // ---------- Manual entry (3rd Add/Scan tab): full ingredient form ----------
  manualEntry = this.blankManualEntry();

  private blankManualEntry() {
    return {
      name: '', category: 'other', location: 'pantry' as Location,
      qty: 1, unit: 'unit',
      servingSizeQty: null as number | null, servingSizeUnit: '',
      servingQty: null as number | null, servingUnit: '',
      cal: 0, protein: 0, carbs: 0, fat: 0,
      sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0,
      image_url: '', ingredients_text: '',
    };
  }

  submitManualEntry(): void {
    const m = this.manualEntry;
    const unit = m.servingUnit.toLowerCase() || null;
    const item: InventoryItem = {
      name: m.name, source: 'manual',
      per_serving: {
        cal: m.cal, protein: m.protein, carbs: m.carbs, fat: m.fat,
        sugar_g: m.sugar_g, fiber_g: m.fiber_g, sat_fat_g: m.sat_fat_g, sodium_mg: m.sodium_mg,
      },
      serving_size: m.servingSizeQty && m.servingSizeUnit ? `${m.servingSizeQty} ${m.servingSizeUnit}` : null,
      serving_size_qty: m.servingSizeQty,
      serving_size_unit: m.servingSizeUnit || null,
      serving_qty: m.servingQty,
      serving_unit: unit,
      serving_qty_g: unit === 'g' ? m.servingQty : null,
      image_url: m.image_url || null,
      ingredients_text: m.ingredients_text || null,
      category: m.category,
      item_id: null, qty: m.qty, unit: m.unit, location: m.location,
    };
    this.api.addInventory(item).subscribe(() => {
      this.scanStatus = `Added ${m.name} to pantry.`;
      this.manualEntry = this.blankManualEntry();
      this.reloadInventory();
    });
  }
  found?: FoodItem;
  foundQty = 1;
  mealPickerOpen = false;
  mealTypes = MEAL_TYPES;
  private pickerEntries: LogEntry[] = [];

  // ---------- Mode toggle ----------
  viewMode: 'log' | 'pantry' = 'pantry';

  // ---------- Log mode ----------
  selectedDate = new Date();
  logEntries: LogEntry[] = [];
  selectedMealKey: string | null = null;
  selectedIngredientIndex: number | null = null;
  readonly r1 = 30;
  readonly r2Inner = 34;
  readonly r2Outer = 48;

  // ---------- Pantry mode ----------
  items: InventoryItem[] = [];
  categories = APP_CATEGORIES;
  locations = LOCATIONS;
  pantryTabs: { id: Location | 'all'; label: string }[] = [
    { id: 'all', label: 'All' }, ...LOCATIONS,
  ];
  activeLocation: Location | 'all' = 'all';
  stockFilter: 'inStock' | 'all' | 'outOfStock' = 'inStock';
  expandedCategoryIds = new Set<string>();

  toggleCategory(id: string): void {
    if (this.expandedCategoryIds.has(id)) this.expandedCategoryIds.delete(id);
    else this.expandedCategoryIds.add(id);
  }

  ngOnInit(): void {
    this.reloadInventory();
    this.reloadLog();
  }

  ngOnDestroy(): void {
    this.controls?.stop();
  }

  setViewMode(mode: 'log' | 'pantry'): void {
    this.viewMode = mode;
    if (mode === 'log') this.reloadLog();
    else this.reloadInventory();
  }

  // ---------- Camera scanning ----------
  async startCamera(): Promise<void> {
    this.scanning = true;
    this.scanStatus = 'Starting camera…';
    try {
      this.controls = await this.reader.decodeFromVideoDevice(
        undefined, this.videoRef!.nativeElement, (result, _err, controls) => {
          if (result) {
            controls.stop();
            this.scanning = false;
            this.onBarcode(result.getText());
          }
        });
    } catch {
      this.scanning = false;
      this.scanStatus = 'Camera unavailable — use manual entry. (Camera needs HTTPS or localhost.)';
    }
  }

  stopCamera(): void {
    this.controls?.stop();
    this.scanning = false;
    this.scanStatus = 'Stopped.';
  }

  private onBarcode(code: string): void {
    this.scanStatus = `Looking up ${code}…`;
    this.showManualMacros = false;
    this.api.scan(code).subscribe({
      next: (r) => { this.found = r.item; this.scanStatus = `Found via ${r.source}.`; },
      error: () => {
        this.scanStatus = `No match for ${code}. Enter macros below.`;
        this.showManualMacros = true;
        this.manualMacros = {
          name: '', cal: 0, protein: 0, carbs: 0, fat: 0,
          servingSizeQty: null, servingSizeUnit: '',
          servingQty: null, servingUnit: '',
        };
      },
    });
  }

  lookupManual(): void {
    const v = this.manualQuery.trim();
    if (!v) return;
    this.showManualMacros = false;
    if (/^\d{6,}$/.test(v)) { this.onBarcode(v); return; }
    this.api.search(v).subscribe({
      next: (r) => {
        this.results = r.results;
        this.scanStatus = r.results.length ? '' : 'No results — enter macros below.';
        this.showManualMacros = !r.results.length;
        if (this.showManualMacros) this.manualMacros.name = v;
      },
      error: () => (this.scanStatus = 'Search failed.'),
    });
  }

  pick(item: FoodItem): void { this.found = item; this.results = []; }

  useManualMacros(): void {
    const unit = this.manualMacros.servingUnit.toLowerCase() || null;
    const { servingSizeQty, servingSizeUnit } = this.manualMacros;
    this.found = {
      name: this.manualMacros.name, source: 'manual',
      per_serving: {
        cal: this.manualMacros.cal, protein: this.manualMacros.protein,
        carbs: this.manualMacros.carbs, fat: this.manualMacros.fat,
        sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0,
      },
      serving_size: servingSizeQty && servingSizeUnit ? `${servingSizeQty} ${servingSizeUnit}` : null,
      serving_size_qty: servingSizeQty,
      serving_size_unit: servingSizeUnit || null,
      serving_qty: this.manualMacros.servingQty,
      serving_unit: unit,
      serving_qty_g: unit === 'g' ? this.manualMacros.servingQty : null,
    };
    this.showManualMacros = false;
    this.results = [];
  }

  onFoundServingChange(): void {
    if (!this.found) return;
    const unit = this.found.serving_unit?.toLowerCase() || null;
    this.found.serving_unit = unit;
    this.found.serving_qty_g = unit === 'g' ? (this.found.serving_qty ?? null) : null;
  }

  addFoundToPantry(): void {
    if (!this.found) return;
    const item: InventoryItem = {
      // Use the product's own serving-size label ("bar", "cup", "can" — the
      // editable field above) as this item's unit, instead of the generic
      // "unit" placeholder — that's what recipe ingredients/AI prompts show,
      // so a real label here makes those far more readable.
      ...this.found, qty: this.foundQty, unit: this.found.serving_size_unit || 'unit',
      item_id: null, location: defaultLocation(this.found.category),
    };
    this.api.addInventory(item).subscribe(() => {
      this.scanStatus = `Added ${this.found!.name} to pantry.`;
      this.found = undefined;
      this.reloadInventory();
    });
  }

  // ---------- Meal-instance picker ----------
  openMealPicker(): void {
    this.mealPickerOpen = true;
    this.api.getLog(todayStr()).subscribe((r) => (this.pickerEntries = r.entries));
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

  logFound(mealType: string, instance: number): void {
    if (!this.found) return;
    const grams = this.found.serving_qty_g != null
      ? this.foundQty * this.found.serving_qty_g : null;
    this.api.log({
      meal: mealType, meal_instance: instance, item_name: this.found.name,
      barcode: this.found.barcode ?? null, source: this.found.source,
      servings: this.foundQty, macros: this.found.per_serving, grams,
      log_date: todayStr(),
    }).subscribe(() => {
      this.mealPickerOpen = false;
      this.found = undefined;
      this.scanStatus = `Logged ${this.mealLabel(mealType, instance)}.`;
      if (this.viewMode === 'log') this.reloadLog();
    });
  }

  // ---------- Log mode: date navigation + grouping + chart ----------
  private dateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  reloadLog(): void {
    this.selectedMealKey = null;
    this.selectedIngredientIndex = null;
    this.api.getLog(this.dateStr(this.selectedDate)).subscribe((r) => (this.logEntries = r.entries));
  }

  /** Removes this log row's data only — never adjusts any linked inventory
   * item's qty back up. */
  deleteLogEntry(entry: LogEntry): void {
    if (!entry.log_id) return;
    this.api.deleteLog(entry.log_id, this.dateStr(this.selectedDate)).subscribe(() => this.reloadLog());
  }

  changeDay(delta: number): void {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() + delta);
    this.selectedDate = d;
    this.reloadLog();
  }

  goToday(): void {
    this.selectedDate = new Date();
    this.reloadLog();
  }

  isToday(): boolean {
    return this.selectedDate.toDateString() === new Date().toDateString();
  }

  dateLabel(): string {
    return this.isToday() ? 'Today'
      : this.selectedDate.toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
        });
  }

  get mealGroups(): MealGroup[] {
    const groups = new Map<string, LogEntry[]>();
    for (const e of this.logEntries) {
      const key = `${e.meal}__${e.meal_instance}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return [...groups.entries()]
      .map(([key, items]) => {
        const [meal, instanceStr] = key.split('__');
        const instance = Number(instanceStr);
        return {
          label: this.mealLabel(meal, instance), meal, instance, items,
          totalCal: items.reduce((sum, i) => sum + i.macros.cal, 0),
        };
      })
      .sort((a, b) => (MEAL_ORDER[a.meal] ?? 99) - (MEAL_ORDER[b.meal] ?? 99) || a.instance - b.instance);
  }

  mealColor(meal: string): string {
    return MEAL_COLORS[meal] || '#9a9ab0';
  }

  get macroSlices(): MacroSlice[] {
    // Smallest meal first, largest last — going around the pie in increasing
    // chunk size. Ties (including a totalCal of 0) keep mealGroups' existing
    // order (same one the legend/table below uses), since Array#sort is stable.
    const groups = [...this.mealGroups].sort((a, b) => a.totalCal - b.totalCal);
    const total = groups.reduce((sum, g) => sum + g.totalCal, 0);
    if (!total) return [];
    let angle = 0;
    const slices: MacroSlice[] = [];
    for (const g of groups) {
      const mealStart = angle;
      const mealSweep = (g.totalCal / total) * 360;
      angle = mealStart + mealSweep;

      const macroCal: Record<MacroKey, number> = {
        protein: g.items.reduce((s, i) => s + i.macros.protein * 4, 0),
        carbs: g.items.reduce((s, i) => s + i.macros.carbs * 4, 0),
        fat: g.items.reduce((s, i) => s + i.macros.fat * 9, 0),
      };
      const macroTotal = macroCal.protein + macroCal.carbs + macroCal.fat;

      if (!macroTotal) {
        slices.push({
          group: g, macro: 'none', color: '#5a5a6e',
          key: `${g.meal}__${g.instance}__none`,
          path: this.describeArc(50, 50, this.r1, mealStart, angle),
        });
        continue;
      }
      let subAngle = mealStart;
      for (const m of MACRO_ORDER) {
        const share = macroCal[m] / macroTotal;
        if (!share) continue;
        const subStart = subAngle;
        subAngle += share * mealSweep;
        slices.push({
          group: g, macro: m, color: MACRO_COLORS[m],
          key: `${g.meal}__${g.instance}__${m}`,
          path: this.describeArc(50, 50, this.r1, subStart, subAngle),
        });
      }
    }
    return slices;
  }

  macroColor(m: MacroKey): string {
    return MACRO_COLORS[m];
  }

  readonly macroOrder = MACRO_ORDER;

  groupMacros(g: MealGroup) {
    return {
      protein: g.items.reduce((s, i) => s + i.macros.protein, 0),
      carbs: g.items.reduce((s, i) => s + i.macros.carbs, 0),
      fat: g.items.reduce((s, i) => s + i.macros.fat, 0),
    };
  }

  get ingredientSlices(): IngredientSlice[] {
    const items = this.selectedGroup?.items ?? [];
    const total = items.reduce((sum, i) => sum + i.macros.cal, 0);
    if (!total) return [];
    let angle = 0;
    return items.map((item, index) => {
      const startAngle = angle;
      const endAngle = angle + (item.macros.cal / total) * 360;
      angle = endAngle;
      return {
        item, index,
        path: this.describeAnnulusSector(50, 50, this.r2Inner, this.r2Outer, startAngle, endAngle),
      };
    });
  }

  // A 360° sweep makes polarToCartesian return the same point at both ends,
  // which collapses the SVG arc command to nothing — clamp just under a full
  // circle so a single-slice meal/ingredient still renders visibly.
  private clampSweep(startAngle: number, endAngle: number): number {
    return endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;
  }

  private describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const clampedEnd = this.clampSweep(startAngle, endAngle);
    const start = this.polarToCartesian(cx, cy, r, startAngle);
    const end = this.polarToCartesian(cx, cy, r, clampedEnd);
    return `M ${cx},${cy} L ${start.x},${start.y} A ${r},${r} 0 ${largeArc},1 ${end.x},${end.y} Z`;
  }

  private describeAnnulusSector(
    cx: number, cy: number, rInner: number, rOuter: number, startAngle: number, endAngle: number,
  ): string {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const clampedEnd = this.clampSweep(startAngle, endAngle);
    const outerStart = this.polarToCartesian(cx, cy, rOuter, startAngle);
    const outerEnd = this.polarToCartesian(cx, cy, rOuter, clampedEnd);
    const innerStart = this.polarToCartesian(cx, cy, rInner, startAngle);
    const innerEnd = this.polarToCartesian(cx, cy, rInner, clampedEnd);
    return [
      `M ${outerStart.x},${outerStart.y}`,
      `A ${rOuter},${rOuter} 0 ${largeArc},1 ${outerEnd.x},${outerEnd.y}`,
      `L ${innerEnd.x},${innerEnd.y}`,
      `A ${rInner},${rInner} 0 ${largeArc},0 ${innerStart.x},${innerStart.y}`,
      'Z',
    ].join(' ');
  }

  private polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  selectSlice(g: MealGroup): void {
    const key = `${g.meal}__${g.instance}`;
    this.selectedMealKey = this.selectedMealKey === key ? null : key;
    this.selectedIngredientIndex = null;
  }

  selectIngredient(index: number): void {
    this.selectedIngredientIndex = this.selectedIngredientIndex === index ? null : index;
  }

  get selectedIngredient(): LogEntry | undefined {
    if (this.selectedIngredientIndex === null) return undefined;
    return this.selectedGroup?.items[this.selectedIngredientIndex];
  }

  isSelected(g: MealGroup): boolean {
    return this.selectedMealKey === null || this.selectedMealKey === `${g.meal}__${g.instance}`;
  }

  isActiveMeal(g: MealGroup): boolean {
    return this.selectedMealKey === `${g.meal}__${g.instance}`;
  }

  get selectedGroup(): MealGroup | undefined {
    return this.mealGroups.find((g) => `${g.meal}__${g.instance}` === this.selectedMealKey);
  }

  // ---------- Pantry mode: location grid -> shelves ----------
  reloadInventory(): void {
    this.api.listInventory().subscribe((r) => (this.items = r.items));
  }

  locationEmoji(loc: Location | 'all'): string {
    if (loc === 'all') return '🗂️';
    return LOCATION_EMOJI[loc] ?? '📦';
  }

  get shelves(): Shelf[] {
    let inLocation = this.activeLocation === 'all'
      ? this.items
      : this.items.filter((it) => (it.location || 'pantry') === this.activeLocation);
    if (this.stockFilter === 'inStock') {
      inLocation = inLocation.filter((it) => it.qty > 0);
    } else if (this.stockFilter === 'outOfStock') {
      inLocation = inLocation.filter((it) => it.qty <= 0);
    }
    const groups = new Map<string, InventoryItem[]>();
    for (const it of inLocation) {
      const key = it.category || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    return this.categories
      .filter((c) => groups.has(c.id))
      .map((c) => ({ meta: c, items: groups.get(c.id)! }));
  }

  adjustQty(it: InventoryItem, delta: number): void {
    if (!it.item_id) return;
    const qty = Math.max(0, it.qty + delta);
    this.api.addInventory({ ...it, qty }).subscribe(() => this.reloadInventory());
  }

  removeItem(it: InventoryItem): void {
    if (!it.item_id) return;
    this.api.deleteInventory(it.item_id).subscribe(() => this.reloadInventory());
  }
}
