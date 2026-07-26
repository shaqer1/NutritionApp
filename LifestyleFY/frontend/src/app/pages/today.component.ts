import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../core/api.service';
import { LogEntry, TodaySummary } from '../core/models';
import { mealLabel as sharedMealLabel, todayStr } from '../core/meal-picker';

@Component({
  selector: 'app-today',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="row spread">
      <h1 style="margin:0">Today</h1>
      <button class="ghost" (click)="load()" [disabled]="loading">
        {{ loading ? 'Refreshing…' : '↻ Refresh' }}
      </button>
    </div>
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

      <div class="card">
        <h3>Logged today</h3>
        @if (!logEntries.length) {
          <p class="muted">Nothing logged today yet.</p>
        } @else {
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr class="muted" style="text-align:left">
                <th style="padding:4px 6px 4px 0">Meal</th>
                <th style="padding:4px 6px">Item</th>
                <th style="padding:4px 6px">Servings</th>
                <th style="padding:4px 0;text-align:right">Calories</th>
              </tr>
            </thead>
            <tbody>
              @for (e of logEntries; track e.ts + e.item_name) {
                <tr style="border-top:1px solid var(--border)">
                  <td style="padding:6px 6px 6px 0">{{ mealLabel(e.meal, e.meal_instance) }}</td>
                  <td style="padding:6px">{{ e.item_name }}</td>
                  <td style="padding:6px">{{ e.servings }}</td>
                  <td style="padding:6px 0;text-align:right">{{ e.macros.cal | number:'1.0-0' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
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
  logEntries: LogEntry[] = [];
  error = false;
  loading = false;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = false;
    this.api.today(todayStr()).subscribe({
      next: (s) => { this.summary = s; this.loading = false; },
      error: () => { this.error = true; this.loading = false; },
    });
    this.api.getLog(todayStr()).subscribe((r) => (this.logEntries = r.entries));
  }

  mealLabel(mealType: string, instance: number): string {
    return sharedMealLabel(mealType, instance);
  }

  pct(v: number, goal: number): number {
    if (!goal) return 0;
    return Math.min((v / goal) * 100, 100);
  }
}
