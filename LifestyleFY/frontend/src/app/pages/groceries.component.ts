import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AiPromptPanelComponent } from '../core/ai-prompt-panel.component';
import { todayStr } from '../core/meal-picker';

@Component({
  selector: 'app-groceries',
  standalone: true,
  imports: [CommonModule, FormsModule, AiPromptPanelComponent],
  template: `
    <h1>Groceries</h1>

    <div class="card blue">
      <h3>Grocery list</h3>
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

    <app-ai-prompt-panel category="grocery" [fetchPreview]="previewGrocery" />

    @if (output) {
      <div class="card">
        <pre class="ai">{{ output }}</pre>
      </div>
    }
  `,
})
export class GroceriesComponent {
  private api = inject(ApiService);
  days = 7;
  status = '';
  output = '';
  message = '';

  previewGrocery = () => this.api.groceryPreview(this.days, todayStr());

  generate(): void {
    this.status = 'Building your grocery list…';
    this.output = '';
    this.api.grocery(this.days, todayStr(), this.message).subscribe({
      next: (r) => { this.output = r.grocery_list; this.status = ''; this.message = ''; },
      error: () => (this.status = 'Could not generate a grocery list — set goals first?'),
    });
  }
}
