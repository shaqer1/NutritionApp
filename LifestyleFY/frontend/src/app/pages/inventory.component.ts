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
