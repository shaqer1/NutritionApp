import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-groceries',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Groceries</h1>

    <div class="card blue">
      <h3>Grocery list</h3>
      <label>Days to shop for</label>
      <input type="number" [(ngModel)]="days" min="1" style="max-width:90px" />
      <div style="margin-top:12px">
        <button (click)="generate()">Generate grocery list</button>
      </div>
      <p class="muted">{{ status }}</p>
    </div>

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

  generate(): void {
    this.status = 'Building your grocery list…';
    this.output = '';
    this.api.grocery(this.days).subscribe({
      next: (r) => { this.output = r.grocery_list; this.status = ''; },
      error: () => (this.status = 'Could not generate a grocery list — set goals first?'),
    });
  }
}
