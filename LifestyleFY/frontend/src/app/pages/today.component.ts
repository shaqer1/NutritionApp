import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { LogEntry, LogRequest, TodaySummary, WorkoutDaySummary, WorkoutSetSummary } from '../core/models';
import { MEAL_TYPES, mealLabel as sharedMealLabel } from '../core/meal-picker';
import { energyIcon as sharedEnergyIcon } from '../core/workout-categories';

@Component({
  selector: 'app-today',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="row spread">
      <button class="ghost" (click)="changeDay(-1)">←</button>
      <h1 style="margin:0">{{ dateLabel() }}</h1>
      <button class="ghost" (click)="changeDay(1)">→</button>
    </div>
    <div class="row spread" style="margin-top:4px">
      @if (!isToday()) {
        <button class="ghost" (click)="goToday()">Today</button>
      } @else {
        <span></span>
      }
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (e of logEntries; track e.log_id ?? (e.ts + e.item_name)) {
                @if (editingLogId && editingLogId === e.log_id) {
                  <tr style="border-top:1px solid var(--border)">
                    <td colspan="5" style="padding:8px 0">
                      <div style="padding:10px;border:1px solid var(--border);border-radius:10px">
                        <label>Name</label>
                        <input [(ngModel)]="editDraft.item_name" />
                        <div class="row">
                          <div style="flex:1"><label>Meal</label>
                            <select [(ngModel)]="editDraft.meal">
                              @for (mt of mealTypes; track mt) { <option [value]="mt">{{ mt }}</option> }
                            </select></div>
                          <div style="flex:1"><label>Instance</label>
                            <input type="number" [(ngModel)]="editDraft.meal_instance" min="1" /></div>
                          <div style="flex:1"><label>Servings</label>
                            <input type="number" [(ngModel)]="editDraft.servings" min="0.25" step="0.25" /></div>
                        </div>
                        <p class="muted" style="margin:8px 0 4px">Totals for this entry (not per-serving)</p>
                        <div class="row">
                          <div style="flex:1"><label>Calories</label>
                            <input type="number" [(ngModel)]="editDraft.cal" /></div>
                          <div style="flex:1"><label>Protein</label>
                            <input type="number" [(ngModel)]="editDraft.protein" /></div>
                        </div>
                        <div class="row">
                          <div style="flex:1"><label>Carbs</label>
                            <input type="number" [(ngModel)]="editDraft.carbs" /></div>
                          <div style="flex:1"><label>Fat</label>
                            <input type="number" [(ngModel)]="editDraft.fat" /></div>
                        </div>
                        <div class="row">
                          <div style="flex:1"><label>Sugar (g)</label>
                            <input type="number" [(ngModel)]="editDraft.sugar_g" /></div>
                          <div style="flex:1"><label>Fiber (g)</label>
                            <input type="number" [(ngModel)]="editDraft.fiber_g" /></div>
                        </div>
                        <div class="row">
                          <div style="flex:1"><label>Saturated fat (g)</label>
                            <input type="number" [(ngModel)]="editDraft.sat_fat_g" /></div>
                          <div style="flex:1"><label>Sodium (mg)</label>
                            <input type="number" [(ngModel)]="editDraft.sodium_mg" /></div>
                        </div>
                        <label>Grams <span class="muted">(optional)</span></label>
                        <input type="number" [(ngModel)]="editDraft.grams" style="max-width:120px" />
                        <div class="row" style="margin-top:10px">
                          <button class="green" (click)="saveEdit()">Save</button>
                          <button class="ghost" (click)="cancelEdit()">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                } @else {
                  <tr style="border-top:1px solid var(--border)">
                    <td style="padding:6px 6px 6px 0">{{ mealLabel(e.meal, e.meal_instance) }}</td>
                    <td style="padding:6px">{{ e.item_name }}</td>
                    <td style="padding:6px">{{ e.servings }}</td>
                    <td style="padding:6px 0;text-align:right">{{ e.macros.cal | number:'1.0-0' }}</td>
                    <td style="padding:6px 0 6px 6px;text-align:right;white-space:nowrap">
                      @if (e.log_id) {
                        <button class="ghost" style="padding:2px 8px" (click)="startEdit(e)">✎</button>
                        <button class="ghost" style="padding:2px 8px" (click)="deleteEntry(e)">🗑</button>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        }
      </div>

      <div class="card">
        <h3>Workouts logged today</h3>
        @if (!workoutDays.length) {
          <p class="muted">No workouts logged today.</p>
        } @else {
          @for (w of workoutDays; track w.date + w.week + w.day) {
            <div style="padding:8px 0;border-top:1px solid var(--border)">
              <div class="row spread">
                <div style="font-weight:700">{{ w.day || 'Workout' }} <span class="muted">· Week {{ w.week }}</span></div>
                <div style="font-size:20px">{{ energyIcon(w.energy_level) }}</div>
              </div>
              @if (w.notes) {
                <div class="muted" style="margin-top:2px">{{ w.notes }}</div>
              }
              @if (w.sets.length) {
                <table style="width:100%;border-collapse:collapse;margin-top:6px">
                  <tbody>
                    @for (m of maxSetsByExercise(w.sets); track m.exercise) {
                      <tr>
                        <td class="muted" style="padding:2px 6px 2px 0">{{ m.exercise }}</td>
                        <td style="padding:2px 0;text-align:right">{{ m.reps }} reps &#64; {{ m.weight }} (max)</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          }
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
  workoutDays: WorkoutDaySummary[] = [];
  error = false;
  loading = false;
  mealTypes = MEAL_TYPES;
  selectedDate = new Date();

  editingLogId: string | null = null;
  editDraft = this.blankEditDraft();

  private blankEditDraft() {
    return {
      meal: 'snack', meal_instance: 1, item_name: '', servings: 1,
      grams: null as number | null,
      cal: 0, protein: 0, carbs: 0, fat: 0,
      sugar_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0,
    };
  }

  ngOnInit(): void {
    this.load();
  }

  private dateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  changeDay(delta: number): void {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() + delta);
    this.selectedDate = d;
    this.load();
  }

  goToday(): void {
    this.selectedDate = new Date();
    this.load();
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

  load(): void {
    this.loading = true;
    this.error = false;
    const date = this.dateStr(this.selectedDate);
    this.api.today(date).subscribe({
      next: (s) => { this.summary = s; this.loading = false; },
      error: () => { this.error = true; this.loading = false; },
    });
    this.api.getLog(date).subscribe((r) => (this.logEntries = r.entries));
    this.api.getWorkoutDaySummaries(date).subscribe((r) => (this.workoutDays = r.days));
  }

  mealLabel(mealType: string, instance: number): string {
    return sharedMealLabel(mealType, instance);
  }

  energyIcon(level: string): string {
    return sharedEnergyIcon(level);
  }

  /** Collapses a workout's individual sets down to one row per exercise,
   * showing the max reps and max weight logged (independently — not
   * necessarily from the same set). */
  maxSetsByExercise(sets: WorkoutSetSummary[]): { exercise: string; reps: string; weight: string }[] {
    const byExercise = new Map<string, WorkoutSetSummary[]>();
    for (const s of sets) {
      if (!byExercise.has(s.exercise)) byExercise.set(s.exercise, []);
      byExercise.get(s.exercise)!.push(s);
    }
    const maxOf = (values: string[]): string => {
      let best = values[0] ?? '';
      let bestNum = this.parseLeadingNumber(best);
      for (const v of values.slice(1)) {
        const n = this.parseLeadingNumber(v);
        if (n != null && (bestNum == null || n > bestNum)) {
          best = v;
          bestNum = n;
        }
      }
      return best;
    };
    return [...byExercise.entries()].map(([exercise, list]) => ({
      exercise,
      reps: maxOf(list.map((s) => s.reps)),
      weight: maxOf(list.map((s) => s.weight)),
    }));
  }

  private parseLeadingNumber(s: string): number | null {
    const m = /-?\d+(?:\.\d+)?/.exec(s || '');
    return m ? parseFloat(m[0]) : null;
  }

  pct(v: number, goal: number): number {
    if (!goal) return 0;
    return Math.min((v / goal) * 100, 100);
  }

  startEdit(e: LogEntry): void {
    if (!e.log_id) return;
    this.editingLogId = e.log_id;
    this.editDraft = {
      meal: e.meal, meal_instance: e.meal_instance, item_name: e.item_name,
      servings: e.servings, grams: e.grams ?? null,
      cal: e.macros.cal, protein: e.macros.protein, carbs: e.macros.carbs, fat: e.macros.fat,
      sugar_g: e.macros.sugar_g, fiber_g: e.macros.fiber_g,
      sat_fat_g: e.macros.sat_fat_g, sodium_mg: e.macros.sodium_mg,
    };
  }

  cancelEdit(): void {
    this.editingLogId = null;
  }

  /** Edits the log row's own data only — never adjusts any linked inventory
   * item's qty, so this can't be used to "give back" pantry stock. */
  saveEdit(): void {
    if (!this.editingLogId) return;
    const d = this.editDraft;
    const servings = d.servings || 1;
    const req: LogRequest = {
      meal: d.meal, meal_instance: d.meal_instance, item_name: d.item_name,
      servings, grams: d.grams,
      macros: {
        cal: d.cal / servings, protein: d.protein / servings,
        carbs: d.carbs / servings, fat: d.fat / servings,
        sugar_g: d.sugar_g / servings, fiber_g: d.fiber_g / servings,
        sat_fat_g: d.sat_fat_g / servings, sodium_mg: d.sodium_mg / servings,
      },
      log_date: this.dateStr(this.selectedDate),
    };
    this.api.updateLog(this.editingLogId, req).subscribe(() => {
      this.editingLogId = null;
      this.load();
    });
  }

  deleteEntry(e: LogEntry): void {
    if (!e.log_id) return;
    this.api.deleteLog(e.log_id, this.dateStr(this.selectedDate)).subscribe(() => this.load());
  }
}
