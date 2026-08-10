import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AiPromptPanelComponent } from '../core/ai-prompt-panel.component';
import { HamburgerMenuService } from '../core/hamburger-menu.service';
import { GroceryItem, GroceryList } from '../core/models';
import { APP_CATEGORIES } from '../core/categories';
import { todayStr } from '../core/meal-picker';

@Component({
  selector: 'app-groceries',
  standalone: true,
  imports: [CommonModule, FormsModule, AiPromptPanelComponent],
  template: `
    <div class="card blue">
      <h3>Generate a grocery list</h3>
      <label>Days to shop for</label>
      <input type="number" [(ngModel)]="days" min="1" style="max-width:90px" />
      <label style="margin-top:10px;display:block">Ask something specific
        <span class="muted">(sent with this request only)</span></label>
      <textarea [(ngModel)]="message" rows="2" placeholder="e.g. I want more taco ingredients this week"
        style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
               border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>
      <div style="margin-top:12px">
        <button (click)="generate()">Generate grocery list</button>
      </div>
      <p class="muted">{{ status }}</p>
    </div>

    @if (hamburger.open()) {
      <div class="slide-panel-backdrop" (click)="hamburger.close()"></div>
      <div class="slide-panel">
        <button class="slide-panel-close" (click)="hamburger.close()" aria-label="Close">✕</button>
        <app-ai-prompt-panel category="grocery" [fetchPreview]="previewGrocery" />
      </div>
    }

    @if (draft) {
      <div class="card">
        <h3>{{ draft.grocery_list_id ? 'Edit grocery list' : 'New grocery list (unsaved)' }}</h3>
        <label>Name</label>
        <input [(ngModel)]="draft.name" placeholder="e.g. Week of Jul 21" />

        @for (section of sections; track section.id) {
          @if (itemsInSection(section.id).length) {
            <div style="margin-top:12px">
              <div class="muted">{{ section.emoji }} {{ section.label }}</div>
              @for (it of itemsInSection(section.id); track $index) {
                <div class="row" style="margin:6px 0">
                  <input [(ngModel)]="it.name" placeholder="Item" style="flex:2" />
                  <input [(ngModel)]="it.quantity" placeholder="Qty" style="flex:1" />
                  <button class="ghost" (click)="removeItem(it)">✕</button>
                </div>
              }
            </div>
          }
        }

        <div class="row" style="margin-top:10px">
          <select [(ngModel)]="newItemSection" style="flex:1">
            @for (s of sections; track s.id) {
              <option [value]="s.id">{{ s.emoji }} {{ s.label }}</option>
            }
          </select>
          <button class="ghost" (click)="addItem()">+ Add item</button>
        </div>

        <label style="margin-top:14px;display:block">Swaps &amp; substitutions</label>
        @for (sw of draft.swaps; track $index) {
          <div class="row" style="margin-bottom:4px">
            <input [(ngModel)]="sw.title" placeholder="Title" style="flex:1" />
            <button class="ghost" (click)="removeSwap($index)">✕</button>
          </div>
          <textarea [(ngModel)]="sw.explanation" rows="2" placeholder="Why this helps"
            style="width:100%;margin-bottom:8px;background:#14141c;color:var(--text);
                   border:1px solid var(--border);border-radius:10px;padding:10px 12px;
                   font-size:15px;font-family:inherit"></textarea>
        }
        <button class="ghost" (click)="addSwap()">+ Add swap</button>

        <div class="row" style="margin-top:12px">
          <button class="green" [disabled]="!draft.name" (click)="save()">Save grocery list</button>
          <button class="ghost" (click)="draft = undefined">Discard</button>
        </div>
      </div>
    }

    @if (groceryLists.length) {
      <div class="card">
        <h3>Saved grocery lists</h3>
        <div class="seg" style="margin-bottom:10px">
          <button [class.active]="!showArchived" (click)="showArchived = false">Active</button>
          <button [class.active]="showArchived" (click)="showArchived = true">Archived</button>
        </div>
        <input [(ngModel)]="searchQuery" placeholder="Search grocery lists or items…" style="margin-bottom:10px" />
        @if (!filteredLists.length) {
          <p class="muted">
            {{ searchQuery ? 'No grocery lists match your search.' : (showArchived ? 'No archived grocery lists.' : 'No active grocery lists yet.') }}
          </p>
        }
        @for (gl of filteredLists; track gl.grocery_list_id) {
          <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer"
            (click)="toggleExpand(gl)">
            <div>
              <div>{{ gl.name || (gl.days + '-day list') }}</div>
              <div class="muted">
                {{ gl.items.length }} item{{ gl.items.length === 1 ? '' : 's' }} ·
                {{ gl.swaps.length }} swap{{ gl.swaps.length === 1 ? '' : 's' }}
              </div>
            </div>
            <div class="row" (click)="$event.stopPropagation()">
              @if (!showArchived) {
                <button class="ghost" (click)="editList(gl)">Edit</button>
                <button class="ghost" (click)="archiveList(gl)">Archive</button>
              } @else {
                <button class="ghost" (click)="restoreList(gl)">Restore</button>
                <button class="ghost" (click)="deleteListPermanently(gl)">Delete permanently</button>
              }
            </div>
          </div>
          @if (expandedId === gl.grocery_list_id) {
            <div style="padding:8px 0 12px">
              @for (it of gl.items; track $index) {
                <div class="row spread" style="padding:2px 0">
                  <span>{{ it.name }}</span><span class="muted">{{ it.quantity }}</span>
                </div>
              }
              @if (gl.swaps.length) {
                <p class="muted" style="margin-top:8px">Swaps &amp; substitutions:</p>
                @for (sw of gl.swaps; track $index; let i = $index) {
                  <p style="margin:4px 0"><b>{{ i + 1 }}. {{ sw.title }}</b>
                    <span class="muted"> — {{ sw.explanation }}</span></p>
                }
              }
            </div>
          }
        }
      </div>
    }
  `,
})
export class GroceriesComponent implements OnInit {
  private api = inject(ApiService);
  hamburger = inject(HamburgerMenuService);
  days = 7;
  status = '';
  message = '';
  draft?: GroceryList;
  groceryLists: GroceryList[] = [];
  showArchived = false;
  expandedId: string | null = null;
  sections = APP_CATEGORIES;
  newItemSection = APP_CATEGORIES[0].id;
  searchQuery = '';

  previewGrocery = () => this.api.groceryPreview(this.days, todayStr());

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.listGroceryLists().subscribe((r) => (this.groceryLists = r.grocery_lists));
  }

  get filteredLists(): GroceryList[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.groceryLists
      .filter((g) => (g.is_active ?? true) === !this.showArchived)
      .filter((g) => !q
        || (g.name ?? '').toLowerCase().includes(q)
        || g.items.some((i) => i.name.toLowerCase().includes(q)));
  }

  generate(): void {
    this.status = 'Building your grocery list…';
    this.draft = undefined;
    this.api.grocery(this.days, todayStr(), this.message).subscribe({
      next: (r) => { this.draft = r.grocery_list; this.status = ''; this.message = ''; },
      error: () => (this.status = 'Could not generate a grocery list — set goals first?'),
    });
  }

  itemsInSection(sectionId: string): GroceryItem[] {
    return this.draft?.items.filter((i) => i.section === sectionId) ?? [];
  }

  addItem(): void {
    if (!this.draft) return;
    this.draft.items.push({ name: '', quantity: '', section: this.newItemSection, checked: false });
  }

  removeItem(item: GroceryItem): void {
    if (!this.draft) return;
    const idx = this.draft.items.indexOf(item);
    if (idx >= 0) this.draft.items.splice(idx, 1);
  }

  addSwap(): void {
    this.draft?.swaps.push({ title: '', explanation: '' });
  }

  removeSwap(i: number): void {
    this.draft?.swaps.splice(i, 1);
  }

  save(): void {
    if (!this.draft) return;
    this.api.saveGroceryList(this.draft).subscribe(() => {
      this.draft = undefined;
      this.status = 'Grocery list saved.';
      this.reload();
    });
  }

  editList(gl: GroceryList): void {
    this.draft = {
      ...gl, items: gl.items.map((i) => ({ ...i })), swaps: gl.swaps.map((s) => ({ ...s })),
    };
  }

  archiveList(gl: GroceryList): void {
    this.api.saveGroceryList({ ...gl, is_active: false }).subscribe(() => this.reload());
  }

  restoreList(gl: GroceryList): void {
    this.api.saveGroceryList({ ...gl, is_active: true }).subscribe(() => this.reload());
  }

  deleteListPermanently(gl: GroceryList): void {
    if (!gl.grocery_list_id) return;
    this.api.deleteGroceryList(gl.grocery_list_id).subscribe(() => this.reload());
  }

  toggleExpand(gl: GroceryList): void {
    this.expandedId = this.expandedId === gl.grocery_list_id ? null : (gl.grocery_list_id ?? null);
  }
}
