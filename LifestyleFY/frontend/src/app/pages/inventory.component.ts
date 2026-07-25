import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { InventoryItem } from '../core/models';
import {
  APP_CATEGORIES, LOCATIONS, Location, CategoryMeta, defaultLocation,
} from '../core/categories';

interface Shelf {
  meta: CategoryMeta;
  items: InventoryItem[];
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Pantry</h1>

    <div class="seg">
      @for (loc of locations; track loc.id) {
        <button [class.active]="activeLocation === loc.id" (click)="activeLocation = loc.id">
          {{ loc.label }}
        </button>
      }
    </div>

    <div class="card">
      <h3>Add item manually</h3>
      <label>Name</label>
      <input [(ngModel)]="draft.name" placeholder="e.g. Peanut butter" />
      <div class="row">
        <div style="flex:1"><label>Category</label>
          <select [(ngModel)]="draft.category" (ngModelChange)="onDraftCategoryChange()">
            @for (c of categories; track c.id) {
              <option [value]="c.id">{{ c.emoji }} {{ c.label }}</option>
            }
          </select>
        </div>
        <div style="flex:1"><label>Location</label>
          <select [(ngModel)]="draft.location" (ngModelChange)="locationTouched = true">
            @for (l of locations; track l.id) {
              <option [value]="l.id">{{ l.label }}</option>
            }
          </select>
        </div>
      </div>
      <div class="row">
        <div style="flex:1"><label>Qty</label>
          <input type="number" [(ngModel)]="draft.qty" min="1" /></div>
        <div style="flex:1"><label>Cal/serving</label>
          <input type="number" [(ngModel)]="draft.per_serving.cal" /></div>
        <div style="flex:1"><label>Protein</label>
          <input type="number" [(ngModel)]="draft.per_serving.protein" /></div>
      </div>
      <label>Image URL (optional)</label>
      <input [(ngModel)]="draft.image_url" placeholder="https://..." />
      <div style="margin-top:12px">
        <button class="green" [disabled]="!draft.name" (click)="add()">Add</button>
      </div>
    </div>

    @if (!shelves.length) {
      <div class="card"><p class="muted">Nothing here yet — scan groceries or add above.</p></div>
    }

    @for (shelf of shelves; track shelf.meta.id) {
      <div class="card">
        <div class="row spread">
          <h3>{{ shelf.meta.emoji }} {{ shelf.meta.label }}</h3>
          <span class="muted">{{ shelf.items.length }} item{{ shelf.items.length === 1 ? '' : 's' }}</span>
        </div>
        @for (it of shelf.items; track it.item_id) {
          <div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div class="row spread" style="cursor:pointer" (click)="toggleEdit(it)">
              <div class="row">
                @if (it.image_url) {
                  <img class="thumb" [src]="it.image_url" alt="" />
                } @else {
                  <div class="thumb">{{ shelf.meta.emoji }}</div>
                }
                <div>
                  <div>{{ it.name }} <span class="muted">×{{ it.qty }}</span></div>
                  <div class="muted">
                    {{ it.brand ? it.brand + ' · ' : '' }}{{ it.per_serving.cal | number:'1.0-0' }} kcal ·
                    {{ it.per_serving.protein | number:'1.0-0' }}g protein · {{ it.source }}
                  </div>
                </div>
              </div>
              <span class="muted">{{ editingId === it.item_id ? '▲' : '▼' }}</span>
            </div>
            @if (editingId === it.item_id && editDraft) {
              <div style="margin-top:10px">
                @if (it.initial_qty) {
                  <div class="muted">{{ it.qty }} of {{ it.initial_qty }} servings left</div>
                  <div class="bar"><span [style.width.%]="(it.qty / it.initial_qty) * 100"></span></div>
                }
                @if (it.serving_size || it.serving_qty_g) {
                  <p class="muted" style="margin:8px 0 0">
                    {{ it.serving_size || (it.serving_qty_g + 'g') }} per serving
                    @if (it.serving_qty_g) {
                      · ≈{{ it.qty * it.serving_qty_g | number:'1.0-0' }}g remaining
                    }
                  </p>
                }

                <div style="margin-top:10px">
                  <div class="row spread"><span class="muted">Calories</span><span>{{ it.per_serving.cal | number:'1.0-0' }}</span></div>
                  <div class="row spread"><span class="muted">Protein</span><span>{{ it.per_serving.protein | number:'1.0-1' }} g</span></div>
                  <div class="row spread"><span class="muted">Carbs</span><span>{{ it.per_serving.carbs | number:'1.0-1' }} g</span></div>
                  <div class="row spread"><span class="muted">Fat</span><span>{{ it.per_serving.fat | number:'1.0-1' }} g</span></div>
                  <div class="row spread"><span class="muted">Sugar</span><span>{{ it.per_serving.sugar_g | number:'1.0-1' }} g</span></div>
                  <div class="row spread"><span class="muted">Fiber</span><span>{{ it.per_serving.fiber_g | number:'1.0-1' }} g</span></div>
                  <div class="row spread"><span class="muted">Saturated fat</span><span>{{ it.per_serving.sat_fat_g | number:'1.0-1' }} g</span></div>
                  <div class="row spread"><span class="muted">Sodium</span><span>{{ it.per_serving.sodium_mg | number:'1.0-0' }} mg</span></div>
                </div>

                @if (it.barcode && !detailCache.has(it.item_id!)) {
                  <p class="muted" style="margin-top:8px">Loading full details…</p>
                }
                @if (detailCache.get(it.item_id!); as raw) {
                  <div style="margin-top:10px">
                    <div class="row" style="flex-wrap:wrap;gap:6px">
                      @if (raw.nutriscore_grade) {
                        <span class="muted">Nutri-Score {{ raw.nutriscore_grade.toUpperCase() }}</span>
                      }
                      @if (raw.nova_group) { <span class="muted">NOVA {{ raw.nova_group }}</span> }
                      @if (raw.ecoscore_grade) {
                        <span class="muted">Eco-Score {{ raw.ecoscore_grade.toUpperCase() }}</span>
                      }
                    </div>
                    @if (raw.ingredients_text_en || raw.ingredients_text) {
                      <p class="muted" style="margin-top:8px">
                        {{ raw.ingredients_text_en || raw.ingredients_text }}
                      </p>
                    }
                    @if (raw.allergens_tags?.length) {
                      <p class="muted">Allergens: {{ formatTags(raw.allergens_tags) }}</p>
                    }
                    @if (raw.packagings?.length) {
                      <p class="muted">Packaging: {{ formatPackaging(raw.packagings) }}</p>
                    }
                  </div>
                }

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
                  <div style="flex:1"><label>Qty</label>
                    <input type="number" [(ngModel)]="editDraft.qty" min="0" /></div>
                  <div style="flex:2"><label>Image URL</label>
                    <input [(ngModel)]="editDraft.image_url" placeholder="https://..." /></div>
                </div>
                <div class="row" style="margin-top:10px">
                  <button class="green" (click)="saveEdit(it)">Save</button>
                  <button class="ghost" (click)="remove(it)">Remove</button>
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class InventoryComponent implements OnInit {
  private api = inject(ApiService);
  items: InventoryItem[] = [];
  draft: InventoryItem = this.blank();
  locationTouched = false;
  editingId: string | null = null;
  editDraft: Pick<InventoryItem, 'category' | 'location' | 'qty' | 'image_url'> | null = null;
  detailCache = new Map<string, any>();

  categories = APP_CATEGORIES;
  locations = LOCATIONS;
  activeLocation: Location = 'pantry';

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.api.listInventory().subscribe((r) => (this.items = r.items));
  }

  get shelves(): Shelf[] {
    const inLocation = this.items.filter(
      (it) => (it.location || 'pantry') === this.activeLocation);
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

  onDraftCategoryChange(): void {
    if (!this.locationTouched) this.draft.location = defaultLocation(this.draft.category);
  }

  add(): void {
    this.api.addInventory(this.draft).subscribe(() => {
      this.draft = this.blank();
      this.locationTouched = false;
      this.reload();
    });
  }

  toggleEdit(it: InventoryItem): void {
    if (this.editingId === it.item_id) {
      this.editingId = null;
      this.editDraft = null;
      return;
    }
    this.editingId = it.item_id ?? null;
    this.editDraft = {
      category: it.category, location: it.location,
      qty: it.qty, image_url: it.image_url,
    };
    if (it.barcode && it.item_id && !this.detailCache.has(it.item_id)) {
      this.api.getRawProduct(it.barcode).subscribe({
        next: (r) => this.detailCache.set(it.item_id!, r.product),
        error: () => this.detailCache.set(it.item_id!, null),
      });
    }
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

  saveEdit(it: InventoryItem): void {
    if (!this.editDraft) return;
    this.api.addInventory({ ...it, ...this.editDraft }).subscribe(() => {
      this.editingId = null;
      this.editDraft = null;
      this.reload();
    });
  }

  remove(it: InventoryItem): void {
    if (!it.item_id) return;
    this.api.deleteInventory(it.item_id).subscribe(() => this.reload());
  }

  private blank(): InventoryItem {
    return {
      name: '', qty: 1, unit: 'unit', source: 'manual', item_id: null,
      barcode: null, category: 'other', location: 'pantry', image_url: null,
      per_serving: {
        cal: 0, protein: 0, carbs: 0, fat: 0,
        sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0,
      },
    };
  }
}
