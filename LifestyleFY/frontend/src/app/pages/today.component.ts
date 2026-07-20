import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../core/api.service';
import { TodaySummary } from '../core/models';

@Component({
  selector: 'app-today',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>Today</h1>
    @if (summary) {
      <div class="card">
        <div class="row spread">
          <h3>Macros vs Goal</h3>
          <span class="muted">{{ summary.meals_logged }} meals</span>
        </div>

        @if (summary.goals) {
          <ng-container>
            <div>Calories
              <span class="muted"> — {{ summary.consumed.cal | number:'1.0-0' }}
                / {{ summary.goals.calories | number:'1.0-0' }} kcal</span>
            </div>
            <div class="bar"><span [style.width.%]="pct(summary.consumed.cal, summary.goals.calories)"></span></div>

            <div style="margin-top:10px">Protein
              <span class="muted"> — {{ summary.consumed.protein | number:'1.0-0' }}
                / {{ summary.goals.protein_g | number:'1.0-0' }} g</span>
            </div>
            <div class="bar protein"><span [style.width.%]="pct(summary.consumed.protein, summary.goals.protein_g)"></span></div>

            <div style="margin-top:10px">Carbs
              <span class="muted"> — {{ summary.consumed.carbs | number:'1.0-0' }}
                / {{ summary.goals.carbs_g | number:'1.0-0' }} g</span>
            </div>
            <div class="bar carbs"><span [style.width.%]="pct(summary.consumed.carbs, summary.goals.carbs_g)"></span></div>

            <div style="margin-top:10px">Fat
              <span class="muted"> — {{ summary.consumed.fat | number:'1.0-0' }}
                / {{ summary.goals.fat_g | number:'1.0-0' }} g</span>
            </div>
            <div class="bar fat"><span [style.width.%]="pct(summary.consumed.fat, summary.goals.fat_g)"></span></div>
          </ng-container>
        } @else {
          <p class="muted">No goals set yet — head to the Goals tab.</p>
        }
      </div>

      @if (summary.goals) {
        <div class="card green">
          <h3>Still to go today</h3>
          <div class="row spread"><span>Calories</span>
            <b>{{ summary.remaining.cal | number:'1.0-0' }} kcal</b></div>
          <div class="row spread"><span>Protein</span>
            <b>{{ summary.remaining.protein | number:'1.0-0' }} g</b></div>
        </div>
      }

      @if (summary.coach_tip) {
        <div class="card blue">
          <h3>🤖 Coach</h3>
          <p style="margin:0">{{ summary.coach_tip }}</p>
        </div>
      }
    } @else if (error) {
      <div class="card"><p class="muted">Couldn't reach the API. Is the backend running?</p></div>
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
})
export class TodayComponent implements OnInit {
  private api = inject(ApiService);
  summary?: TodaySummary;
  error = false;

  ngOnInit(): void {
    this.api.today().subscribe({
      next: (s) => (this.summary = s),
      error: () => (this.error = true),
    });
  }

  pct(v: number, goal: number): number {
    if (!goal) return 0;
    return Math.min((v / goal) * 100, 100);
  }
}
