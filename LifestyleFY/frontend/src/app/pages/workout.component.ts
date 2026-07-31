import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { PlanExercise, WorkoutDay, WorkoutProgress } from '../core/models';
import { exerciseCategoryMeta } from '../core/workout-categories';

interface SetDraft {
  set_num: number;
  actual_reps: string;
  weight: string;
  done: boolean;
}

@Component({
  selector: 'app-workout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Workout</h1>

    <div class="seg">
      <button [class.active]="viewMode === 'workout'" (click)="switchView('workout')">Workout</button>
      <button [class.active]="viewMode === 'progress'" (click)="switchView('progress')">Progress</button>
    </div>

    @if (viewMode === 'workout') {
      <div class="card" style="margin-top:16px">
        <div class="row spread">
          <div>
            <h3 style="margin-bottom:2px">{{ getPhaseLabel(currentWeek) }}</h3>
            <div class="muted">Week {{ currentWeek }} of 10 · select a workout day</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="ghost" (click)="changeWeek(-1)">‹</button>
            <div style="font-weight:700;white-space:nowrap">W{{ currentWeek }}</div>
            <button class="ghost" (click)="changeWeek(1)">›</button>
          </div>
        </div>
      </div>

      @if (weekLoading) {
        <p class="muted">Loading week…</p>
      } @else {
        <div class="grid-cards">
          @for (day of days; track day) {
            <div class="item-card"
                 [style.border-color]="currentDay === day ? 'var(--accent)' : (completedDays.includes(day) ? 'var(--green)' : '')"
                 style="cursor:pointer" (click)="selectDay(day)">
              <div style="font-size:22px">{{ dayIcon(day) }}</div>
              <div style="font-size:11px;font-weight:700;margin-top:4px">{{ dayLabel(day) }}</div>
              <div class="muted" style="font-size:10px">
                {{ completedDays.includes(day) ? 'Done ✓' : dayTag(day) }}
              </div>
            </div>
          }
        </div>
      }

      @if (status) {
        <p class="muted">{{ status }}</p>
      }

      @if (dayLoading) {
        <p class="muted">Loading workout…</p>
      }

      <ng-template #exerciseCard let-ex="ex" let-showTracker="showTracker">
        <div class="card">
          <div class="row spread" style="align-items:flex-start">
            <div style="font-weight:700;flex:1">{{ ex.exercise }}</div>
            <div class="muted" style="font-size:11px;white-space:nowrap">
              {{ categoryMeta(ex.category).emoji }} {{ categoryMeta(ex.category).label }}
            </div>
          </div>

          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
            <div class="muted" style="font-size:12px">SETS <b style="color:var(--text)">{{ ex.sets || '-' }}</b></div>
            <div class="muted" style="font-size:12px">REPS <b style="color:var(--text)">{{ ex.reps || '-' }}</b></div>
            @if (ex.weight) {
              <div class="muted" style="font-size:12px">LOAD <b style="color:var(--text)">{{ ex.weight }}</b></div>
            }
            @if (ex.rest) {
              <div class="muted" style="font-size:12px">REST <b style="color:var(--text)">{{ ex.rest }}</b></div>
            }
          </div>

          @if (ex.notes) {
            <p class="muted" style="font-style:italic;margin-top:8px">💡 {{ ex.notes }}</p>
          }

          <div class="row" style="align-items:flex-start;margin-top:10px;cursor:pointer" (click)="toggleDetail(ex.plan_id)">
            @if (ex.image_url) {
              <img class="thumb" [src]="ex.image_url" alt="" style="width:64px;height:52px" />
            } @else {
              <div class="thumb" style="width:64px;height:52px">🏋️</div>
            }
            <div style="flex:1;min-width:0">
              @if (ex.video_url) {
                <a [href]="ex.video_url" target="_blank" class="muted" style="font-size:12px"
                   (click)="$event.stopPropagation()">▶ Watch Video</a>
              }
              <div class="muted" style="font-size:12px;margin-top:4px">
                {{ expandedPlanIds.has(ex.plan_id) ? '▲ Hide details' : '▼ Exercise details' }}
              </div>
            </div>
          </div>

          @if (expandedPlanIds.has(ex.plan_id)) {
            <div style="margin-top:10px;padding:10px;background:#14141c;border-radius:10px">
              @if (ex.overview) {
                <p style="font-size:13px;margin-bottom:8px">{{ ex.overview }}</p>
              }
              @if (ex.instructions.length) {
                <div class="muted" style="margin-bottom:4px">INSTRUCTIONS</div>
                <ol style="padding-left:18px;font-size:13px;line-height:1.5;margin:0">
                  @for (step of ex.instructions; track $index) {
                    <li>{{ step }}</li>
                  }
                </ol>
              }
              @if (ex.target_muscles.length) {
                <div class="muted" style="margin-top:8px">TARGET MUSCLES</div>
                <div style="font-size:13px">{{ ex.target_muscles.join(', ') }}</div>
              }
            </div>
          }

          @if (showTracker) {
            <div style="margin-top:12px">
              <div class="row" style="gap:8px;margin-bottom:4px">
                <div class="muted" style="width:20px;text-align:center;font-size:10px">SET</div>
                <div class="muted" style="flex:1;text-align:center;font-size:10px">TARGET</div>
                <div class="muted" style="flex:1;text-align:center;font-size:10px">ACTUAL REPS</div>
                <div class="muted" style="flex:1;text-align:center;font-size:10px">WEIGHT</div>
                <div style="width:44px"></div>
              </div>
              @for (set of setDraftsByExercise[ex.exercise]; track set.set_num) {
                <div class="row" style="margin-bottom:8px;align-items:center;gap:8px">
                  <div class="muted" style="width:20px;text-align:center">{{ set.set_num }}</div>
                  <input type="text" [value]="ex.reps || '-'" readonly disabled
                         style="flex:1;text-align:center;color:var(--muted)" />
                  <input type="number" placeholder="reps" [(ngModel)]="set.actual_reps"
                         style="flex:1;text-align:center" [disabled]="set.done" />
                  <input type="number" placeholder="lbs" [(ngModel)]="set.weight"
                         style="flex:1;text-align:center" [disabled]="set.done" />
                  <button [class.green]="set.done" [disabled]="set.done"
                          style="width:44px;padding:8px" (click)="completeSet(ex, set.set_num)">✓</button>
                </div>
              }
              <button class="ghost ex-done-btn" [class.green]="completedExercises.has(ex.exercise)"
                      style="width:100%;margin-top:4px" (click)="markExerciseComplete(ex)">
                {{ completedExercises.has(ex.exercise) ? '✓ Done!' : 'Mark Complete' }}
              </button>
            </div>
          }
        </div>
      </ng-template>

      @if (currentDay && dayData && !dayLoading) {
        @if (dayData.warmup.length) {
          <h3 style="margin-top:20px">🛡️ Warm-Up</h3>
          @for (ex of dayData.warmup; track ex.plan_id ?? ex.exercise) {
            <ng-container [ngTemplateOutlet]="exerciseCard"
                          [ngTemplateOutletContext]="{ ex: ex, showTracker: false }"></ng-container>
          }
        }
        @if (dayData.strength.length) {
          <h3 style="margin-top:20px">💪 Strength Work</h3>
          @for (ex of dayData.strength; track ex.plan_id ?? ex.exercise) {
            <ng-container [ngTemplateOutlet]="exerciseCard"
                          [ngTemplateOutletContext]="{ ex: ex, showTracker: true }"></ng-container>
          }
        }
        @if (dayData.cooldown.length) {
          <h3 style="margin-top:20px">🧘 Cool-Down &amp; Stretch</h3>
          @for (ex of dayData.cooldown; track ex.plan_id ?? ex.exercise) {
            <ng-container [ngTemplateOutlet]="exerciseCard"
                          [ngTemplateOutletContext]="{ ex: ex, showTracker: false }"></ng-container>
          }
        }

        <button style="width:100%;margin-top:8px" (click)="finishOpen = !finishOpen">🎉 Finish Workout</button>

        @if (finishOpen) {
          <div class="card" style="margin-top:12px">
            <h3>How was your energy today?</h3>
            <div class="seg" style="margin:12px 0">
              <button [class.active]="energyLevel === 'high'" (click)="energyLevel = 'high'">🔥 Crushed It</button>
              <button [class.active]="energyLevel === 'medium'" (click)="energyLevel = 'medium'">💪 Good</button>
              <button [class.active]="energyLevel === 'low'" (click)="energyLevel = 'low'">😔 Tough Day</button>
            </div>
            <label>Notes</label>
            <textarea [(ngModel)]="workoutNotes" rows="3"
                      placeholder="Any notes? (weights used, how you felt...)"
                      style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
                             border-radius:10px;padding:10px 12px;font-size:15px;resize:none"></textarea>
            <div class="row" style="margin-top:12px">
              <button (click)="saveWorkout()">Save &amp; Log Workout ✓</button>
              <button class="ghost" (click)="finishOpen = false">Cancel</button>
            </div>
          </div>
        }
      }
    }

    @if (viewMode === 'progress') {
      @if (progressLoading) {
        <p class="muted" style="margin-top:16px">Loading progress…</p>
      } @else if (progress) {
        <div class="row" style="gap:8px;margin-top:16px">
          <div class="card" style="flex:1;text-align:center;padding:16px 8px;margin-bottom:0">
            <div style="font-size:26px;font-weight:800;color:var(--accent)">{{ progress.total_sessions }}</div>
            <div class="muted">Sessions</div>
          </div>
          <div class="card" style="flex:1;text-align:center;padding:16px 8px;margin-bottom:0">
            <div style="font-size:26px;font-weight:800;color:var(--accent)">{{ currentWeek }}</div>
            <div class="muted">Current Week</div>
          </div>
          <div class="card" style="flex:1;text-align:center;padding:16px 8px;margin-bottom:0">
            <div style="font-size:26px;font-weight:800;color:var(--accent)">{{ progress.total_sets }}</div>
            <div class="muted">Sets Logged</div>
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <h3>🏋️ 10-Week Progress</h3>
          <div class="bar"><span [style.width.%]="progressPct()"></span></div>
          <p class="muted" style="text-align:center;margin-top:6px">
            {{ progress.distinct_days_completed }} of {{ progress.total_planned_days }} days complete ({{ progressPct() }}%)
          </p>
        </div>

        <h3 style="margin-top:20px">📅 Recent Workouts</h3>
        @if (progress.recent.length) {
          @for (r of progress.recent; track r.date + r.week + r.day) {
            <div class="card row spread">
              <div>
                <div style="font-weight:700">{{ r.day || 'Workout' }}</div>
                <div class="muted">{{ r.date }} · Week {{ r.week }}</div>
                @if (r.notes) {
                  <div class="muted" style="margin-top:4px">{{ r.notes }}</div>
                }
              </div>
              <div style="font-size:24px">{{ energyIcon(r.energy_level) }}</div>
            </div>
          }
        } @else {
          <p class="muted">No workouts logged yet. Let's go!</p>
        }
      }
    }
  `,
})
export class WorkoutComponent implements OnInit {
  private api = inject(ApiService);

  viewMode: 'workout' | 'progress' = 'workout';
  categoryMeta = exerciseCategoryMeta;

  currentWeek = 1;
  days: string[] = [];
  completedDays: string[] = [];
  weekLoading = false;

  currentDay: string | null = null;
  dayData: WorkoutDay | null = null;
  dayLoading = false;
  setDraftsByExercise: Record<string, SetDraft[]> = {};
  completedExercises = new Set<string>();
  expandedPlanIds = new Set<string>();

  finishOpen = false;
  energyLevel = 'medium';
  workoutNotes = '';

  progress: WorkoutProgress | null = null;
  progressLoading = false;

  status = '';

  ngOnInit(): void {
    this.api.getWorkoutConfig().subscribe({
      next: (res) => {
        this.currentWeek = res.config?.current_week || 1;
        this.loadWeek(this.currentWeek);
      },
      error: () => this.loadWeek(this.currentWeek),
    });
  }

  switchView(mode: 'workout' | 'progress'): void {
    this.viewMode = mode;
    if (mode === 'progress') this.loadProgress();
  }

  loadWeek(week: number): void {
    this.weekLoading = true;
    this.api.getWorkoutWeekOverview(week).subscribe({
      next: (ov) => {
        this.days = ov.days;
        this.completedDays = ov.completed_days;
        this.weekLoading = false;
      },
      error: () => {
        this.weekLoading = false;
        this.status = 'Could not load this week. Try Initialize / migrate first.';
      },
    });
  }

  changeWeek(delta: number): void {
    const newWeek = this.currentWeek + delta;
    if (newWeek < 1) return;
    this.currentWeek = newWeek;
    this.currentDay = null;
    this.dayData = null;
    this.api.setWorkoutConfig(newWeek).subscribe();
    this.loadWeek(newWeek);
  }

  selectDay(day: string): void {
    this.currentDay = day;
    this.dayData = null;
    this.setDraftsByExercise = {};
    this.completedExercises = new Set<string>();
    this.expandedPlanIds = new Set<string>();
    this.finishOpen = false;
    this.dayLoading = true;

    this.api.getWorkoutDay(this.currentWeek, day).subscribe({
      next: (data) => {
        this.dayData = data;
        data.strength.forEach((ex) => {
          const count = Math.max(1, parseInt(ex.sets, 10) || 1);
          this.setDraftsByExercise[ex.exercise] = Array.from({ length: count }, (_, i) => ({
            set_num: i + 1, actual_reps: '', weight: '', done: false,
          }));
        });
        this.dayLoading = false;
        this.hydrateLoggedSets(day);
      },
      error: () => {
        this.dayLoading = false;
        this.status = 'Could not load this workout.';
      },
    });
  }

  private hydrateLoggedSets(day: string): void {
    this.api.getWorkoutSets(this.currentWeek, day).subscribe((res) => {
      for (const entry of res.sets) {
        const draft = this.setDraftsByExercise[entry.exercise]?.find(
          (d) => d.set_num === entry.set_num);
        if (draft) {
          draft.actual_reps = entry.actual_reps;
          draft.weight = entry.weight;
          draft.done = true;
        }
      }
      Object.entries(this.setDraftsByExercise).forEach(([exerciseName, drafts]) => {
        if (drafts.length && drafts.every((d) => d.done)) {
          this.completedExercises.add(exerciseName);
        }
      });
    });
  }

  toggleDetail(planId: string | null | undefined): void {
    if (!planId) return;
    if (this.expandedPlanIds.has(planId)) this.expandedPlanIds.delete(planId);
    else this.expandedPlanIds.add(planId);
  }

  completeSet(ex: PlanExercise, setNum: number): void {
    const draft = this.setDraftsByExercise[ex.exercise]?.find((d) => d.set_num === setNum);
    if (!draft || !this.currentDay) return;
    draft.done = true;
    this.api.logWorkoutSet({
      week: this.currentWeek, day: this.currentDay, exercise: ex.exercise, set_num: setNum,
      planned_reps: ex.reps, actual_reps: draft.actual_reps, weight: draft.weight,
    }).subscribe();
  }

  markExerciseComplete(ex: PlanExercise): void {
    this.completedExercises.add(ex.exercise);
  }

  saveWorkout(): void {
    if (!this.currentDay || !this.dayData) return;
    const total = this.dayData.warmup.length + this.dayData.strength.length
      + this.dayData.cooldown.length;
    this.api.logWorkoutSession({
      week: this.currentWeek, day: this.currentDay, energy_level: this.energyLevel,
      notes: this.workoutNotes, total_exercises: total,
    }).subscribe(() => {
      this.finishOpen = false;
      this.workoutNotes = '';
      this.energyLevel = 'medium';
      this.status = '🎉 Workout logged! Great work!';
      this.loadWeek(this.currentWeek);
    });
  }

  loadProgress(): void {
    this.progressLoading = true;
    this.api.getWorkoutProgress().subscribe({
      next: (p) => {
        this.progress = p;
        this.progressLoading = false;
      },
      error: () => {
        this.progressLoading = false;
      },
    });
  }

  progressPct(): number {
    if (!this.progress || !this.progress.total_planned_days) return 0;
    return Math.min(100, Math.round(
      (this.progress.distinct_days_completed / this.progress.total_planned_days) * 100));
  }

  energyIcon(level: string): string {
    if (level === 'high') return '🔥';
    if (level === 'low') return '😔';
    return '💪';
  }

  getPhaseLabel(week: number): string {
    if (week <= 2) return 'Phase 1: Reintroduction 🌱';
    if (week <= 5) return 'Phase 2: Building 📈';
    if (week <= 8) return 'Phase 3: Strength 💪';
    return 'Phase 4: Peak 🔥';
  }

  dayIcon(day: string): string {
    const t = day.toLowerCase();
    if (t.includes('upper')) return '💪';
    if (t.includes('lower')) return '🦵';
    if (t.includes('full')) return '⚡';
    return '🏋️';
  }

  dayLabel(day: string): string {
    const parts = day.split(' - ');
    return parts[1] || parts[0] || day;
  }

  dayTag(day: string): string {
    return day.split(' - ')[0] || day;
  }
}
