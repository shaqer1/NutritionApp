import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { InventoryItem } from '../core/models';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Pantry</h1>

    <div class="card">
      <h3>Add item manually</h3>
      <label>Name</label>
      <input [(ngModel)]="draft.name" placeholder="e.g. Peanut butter" />
      <div class="row">
        <div style="flex:1"><label>Qty</label>
          <input type="number" [(ngModel)]="draft.qty" min="1" /></div>
        <div style="flex:1"><label>Cal/serving</label>
          <input type="number" [(ngModel)]="draft.per_serving.cal" /></div>
        <div style="flex:1"><label>Protein</label>
          <input type="number" [(ngModel)]="draft.per_serving.protein" /></div>
      </div>
      <div style="margin-top:12px">
        <button class="green" [disabled]="!draft.name" (click)="add()">Add</button>
      </div>
    </div>

    <div class="card">
      <div class="row spread"><h3>In stock</h3><span class="muted">{{ items.length }} items</span></div>
      @if (!items.length) { <p class="muted">Empty — scan groceries or add above.</p> }
      @for (it of items; track it.item_id) {
        <div class="row spread" style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div>
            <div>{{ it.name }} <span class="muted">×{{ it.qty }}</span></div>
            <div class="muted">{{ it.per_serving.cal | number:'1.0-0' }} kcal ·
              {{ it.per_serving.protein | number:'1.0-0' }}g protein · {{ it.source }}</div>
          </div>
          <button class="ghost" (click)="remove(it)">✕</button>
        </div>
      }
    </div>
  `,
})
export class InventoryComponent implements OnInit {
  private api = inject(ApiService);
  items: InventoryItem[] = [];
  draft: InventoryItem = this.blank();

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.api.listInventory().subscribe((r) => (this.items = r.items));
  }

  add(): void {
    this.api.addInventory(this.draft).subscribe(() => {
      this.draft = this.blank();
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
      barcode: null, category: null,
      per_serving: { cal: 0, protein: 0, carbs: 0, fat: 0 },
    };
  }
}
