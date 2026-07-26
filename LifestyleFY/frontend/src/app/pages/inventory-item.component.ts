import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { InventoryItem, LogEntry } from '../core/models';
import { APP_CATEGORIES, LOCATIONS, categoryMeta } from '../core/categories';
import {
  MEAL_TYPES, mealLabel as sharedMealLabel, existingInstances as sharedExistingInstances,
  nextInstance as sharedNextInstance, todayStr,
} from '../core/meal-picker';

type EditDraft = Pick<InventoryItem,
  'category' | 'location' | 'qty' | 'initial_qty' | 'image_url' | 'ingredients_text'>;

@Component({
  selector: 'app-inventory-item',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <a routerLink="/inventory" class="muted" style="text-decoration:none">← Back to Inventory</a>

    @if (item && editDraft) {
      <div class="card" style="margin-top:12px">
        <div class="row">
          @if (item.image_url) {
            <img class="thumb" [src]="item.image_url" alt="" style="width:64px;height:64px;font-size:32px" />
          } @else {
            <div class="thumb" style="width:64px;height:64px;font-size:32px">
              {{ categoryMeta(item.category).emoji }}
            </div>
          }
          <div>
            <h1 style="margin:0;font-size:20px">{{ item.name }}</h1>
            @if (item.brand) { <p class="muted" style="margin:2px 0 0">{{ item.brand }}</p> }
          </div>
        </div>

        @if (item.initial_qty) {
          <div class="muted" style="margin-top:14px">{{ item.qty }} of {{ item.initial_qty }} servings left</div>
          <div class="bar"><span [style.width.%]="(item.qty / item.initial_qty) * 100"></span></div>
        }
        @if (item.serving_size_qty) {
          <p class="muted" style="margin:8px 0 0">
            Serving size: {{ item.serving_size_qty }} {{ item.serving_size_unit }}
          </p>
        }
        @if (item.serving_qty) {
          <p class="muted" style="margin:2px 0 0">
            {{ item.serving_qty }} {{ item.serving_unit }} per serving
            · ≈{{ item.qty * item.serving_qty | number:'1.0-1' }} {{ item.serving_unit }} remaining
          </p>
        }

        <div style="margin-top:14px">
          <div class="row spread"><span class="muted">Calories</span><span>{{ item.per_serving.cal | number:'1.0-0' }}</span></div>
          <div class="row spread"><span class="muted">Protein</span><span>{{ item.per_serving.protein | number:'1.0-1' }} g</span></div>
          <div class="row spread"><span class="muted">Carbs</span><span>{{ item.per_serving.carbs | number:'1.0-1' }} g</span></div>
          <div class="row spread"><span class="muted">Fat</span><span>{{ item.per_serving.fat | number:'1.0-1' }} g</span></div>
          <div class="row spread"><span class="muted">Sugar</span><span>{{ item.per_serving.sugar_g | number:'1.0-1' }} g</span></div>
          <div class="row spread"><span class="muted">Fiber</span><span>{{ item.per_serving.fiber_g | number:'1.0-1' }} g</span></div>
          <div class="row spread"><span class="muted">Saturated fat</span><span>{{ item.per_serving.sat_fat_g | number:'1.0-1' }} g</span></div>
          <div class="row spread"><span class="muted">Sodium</span><span>{{ item.per_serving.sodium_mg | number:'1.0-0' }} mg</span></div>
        </div>

        @if (item.barcode && !rawLoaded) {
          <p class="muted" style="margin-top:8px">Loading full details…</p>
        }
        @if (rawProduct) {
          <div style="margin-top:10px">
            <div class="row" style="flex-wrap:wrap;gap:6px">
              @if (rawProduct.nutriscore_grade) {
                <span class="muted">Nutri-Score {{ rawProduct.nutriscore_grade.toUpperCase() }}</span>
              }
              @if (rawProduct.nova_group) { <span class="muted">NOVA {{ rawProduct.nova_group }}</span> }
              @if (rawProduct.ecoscore_grade) {
                <span class="muted">Eco-Score {{ rawProduct.ecoscore_grade.toUpperCase() }}</span>
              }
            </div>
            @if (rawProduct.ingredients_text_en || rawProduct.ingredients_text) {
              <p class="muted" style="margin-top:8px">
                {{ rawProduct.ingredients_text_en || rawProduct.ingredients_text }}
              </p>
            }
            @if (rawProduct.allergens_tags?.length) {
              <p class="muted">Allergens: {{ formatTags(rawProduct.allergens_tags) }}</p>
            }
            @if (rawProduct.packagings?.length) {
              <p class="muted">Packaging: {{ formatPackaging(rawProduct.packagings) }}</p>
            }
          </div>
        }
      </div>

      <div class="card blue">
        <h3>Log this</h3>
        <div class="row">
          <input type="number" [(ngModel)]="logServings" min="0.25" step="0.25" style="max-width:90px" />
          <button (click)="openMealPicker()">Log as eaten</button>
        </div>
        @if (mealPickerOpen) {
          <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
            <p class="muted">Which meal?</p>
            @for (mt of mealTypes; track mt) {
              <div style="margin-bottom:8px">
                <div class="muted" style="text-transform:capitalize">{{ mt }}</div>
                <div class="row" style="flex-wrap:wrap;gap:8px">
                  @for (inst of existingInstances(mt); track inst) {
                    <button class="ghost" (click)="logNow(mt, inst)">{{ mealLabel(mt, inst) }}</button>
                  }
                  <button class="ghost" (click)="logNow(mt, nextInstance(mt))">+ New {{ mt }}</button>
                </div>
              </div>
            }
          </div>
        }
        <p class="muted">{{ logStatus }}</p>
      </div>

      <div class="card">
        <h3>Edit</h3>
        <div class="row">
          <div style="flex:1"><label>Category</label>
            <select [(ngModel)]="editDraft.category">
              @for (c of categories; track c.id) {
                <option [value]="c.id">{{ c.emoji }} {{ c.label }}</option>
              }
            </select>
          </div>
          <div style="flex:1"><label>Location</label>
            <select [(ngModel)]="editDraft.location">
              @for (l of locations; track l.id) {
                <option [value]="l.id">{{ l.label }}</option>
              }
            </select>
          </div>
        </div>
        <div class="row">
          <div style="flex:1"><label>Qty (servings left)</label>
            <input type="number" [(ngModel)]="editDraft.qty" min="0" /></div>
          <div style="flex:1"><label>Servings per container</label>
            <input type="number" [(ngModel)]="editDraft.initial_qty" min="0" /></div>
        </div>
        <label>Image URL</label>
        <input [(ngModel)]="editDraft.image_url" placeholder="https://..." />
        <label>Ingredients</label>
        <textarea [(ngModel)]="editDraft.ingredients_text" rows="3"
          placeholder="e.g. Chicken, rice, onion, garlic, salt"
          style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
                 border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="green" (click)="save()">Save</button>
          <button class="ghost" (click)="removeItem()">Remove</button>
        </div>
      </div>
    } @else if (loaded) {
      <div class="card" style="margin-top:12px"><p class="muted">Ingredient not found.</p></div>
    }
  `,
})
export class InventoryItemComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);

  item?: InventoryItem;
  loaded = false;
  editDraft: EditDraft | null = null;
  rawProduct: any = null;
  rawLoaded = false;

  categories = APP_CATEGORIES;
  locations = LOCATIONS;
  categoryMeta = categoryMeta;

  logServings = 1;
  mealPickerOpen = false;
  mealTypes = MEAL_TYPES;
  logStatus = '';
  private pickerEntries: LogEntry[] = [];

  private itemId: string | null = null;

  ngOnInit(): void {
    this.itemId = this.route.snapshot.paramMap.get('itemId');
    this.load();
  }

  private load(): void {
    this.api.listInventory().subscribe((r) => {
      this.item = r.items.find((i) => i.item_id === this.itemId);
      this.loaded = true;
      if (!this.item) return;

      this.editDraft = {
        category: this.item.category ?? null, location: this.item.location,
        qty: this.item.qty, initial_qty: this.item.initial_qty ?? null,
        image_url: this.item.image_url ?? null,
        ingredients_text: this.item.ingredients_text ?? null,
      };
      if (this.item.barcode && !this.rawLoaded) {
        this.api.getRawProduct(this.item.barcode).subscribe({
          next: (res) => { this.rawProduct = res.product; this.rawLoaded = true; },
          error: () => { this.rawLoaded = true; },
        });
      } else if (!this.item.barcode) {
        this.rawLoaded = true;
      }
    });
  }

  // ---------- Log this ----------
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

  logNow(mealType: string, instance: number): void {
    if (!this.item) return;
    const grams = this.item.serving_qty_g != null
      ? this.logServings * this.item.serving_qty_g : null;
    this.api.log({
      meal: mealType, meal_instance: instance, item_name: this.item.name,
      barcode: this.item.barcode ?? null, source: this.item.source,
      servings: this.logServings, macros: this.item.per_serving, grams,
      inventory_item_id: this.item.item_id, log_date: todayStr(),
    }).subscribe(() => {
      this.mealPickerOpen = false;
      this.logStatus = `Logged ${this.mealLabel(mealType, instance)}.`;
      this.load(); // refresh qty (just decremented server-side)
    });
  }

  formatTags(tags: string[]): string {
    return (tags || []).map((t) => this.cleanTag(t)).join(', ');
  }

  formatPackaging(packagings: any[]): string {
    return (packagings || [])
      .map((p) => this.cleanTag(p.material))
      .filter(Boolean)
      .join(', ');
  }

  private cleanTag(tag?: string): string {
    return (tag || '').replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');
  }

  save(): void {
    if (!this.item || !this.editDraft) return;
    this.api.addInventory({ ...this.item, ...this.editDraft }).subscribe(() => {
      this.router.navigate(['/inventory']);
    });
  }

  removeItem(): void {
    if (!this.item?.item_id) return;
    this.api.deleteInventory(this.item.item_id).subscribe(() => this.router.navigate(['/inventory']));
  }
}
