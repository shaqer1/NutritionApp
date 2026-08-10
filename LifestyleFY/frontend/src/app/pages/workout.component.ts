import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import {
  CustomExerciseRequest, ExerciseCacheOptions, ExerciseCacheSearchResult, ExerciseDetails,
  ExerciseSearchResultItem, OverviewDay, PlanExercise, WorkoutDay, WorkoutOverview,
  WorkoutPlanUpdateRequest, WorkoutProgress,
} from '../core/models';
import { energyIcon as sharedEnergyIcon, EXERCISE_CATEGORIES, exerciseCategoryMeta } from '../core/workout-categories';

interface SetDraft {
  set_num: number;
  actual_reps: string;
  weight: string;
  done: boolean;
}

type CacheFilterKey =
  'equipments' | 'body_parts' | 'exercise_type' | 'target_muscles' | 'secondary_muscles' | 'keywords';

const CACHE_FILTER_DEFS: { key: CacheFilterKey; label: string }[] = [
  { key: 'equipments', label: 'Equipment' },
  { key: 'body_parts', label: 'Body Part' },
  { key: 'exercise_type', label: 'Type' },
  { key: 'target_muscles', label: 'Target Muscle' },
  { key: 'secondary_muscles', label: '2nd Muscle' },
  { key: 'keywords', label: 'Keyword' },
];

const EMPTY_CACHE_FILTERS = () => ({
  equipments: [] as string[], body_parts: [] as string[], exercise_type: [] as string[],
  target_muscles: [] as string[], secondary_muscles: [] as string[], keywords: [] as string[],
  search_text: '', page: 1,
});

interface PhaseGroup {
  key: string;
  label: string;
  weekStart: number;
  weekEnd: number;
}

// Higher-level grouping above the per-week "Phase 1/2/3/4" labels (getPhaseLabel below).
// Weeks past the last group's end still fall into that group, so future weeks never go unlabeled.
const PHASE_GROUPS: PhaseGroup[] = [
  { key: 'reintroduction', label: 'Reintroduction', weekStart: 1, weekEnd: 10 },
  { key: 'maintenance-building', label: 'Maintenance Building', weekStart: 11, weekEnd: 16 },
];

@Component({
  selector: 'app-workout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (viewMode === 'workout') {
      <button class="coach-fab" [class.dragging]="dragging"
        [style.top.px]="coachTop"
        [style.left.px]="dragLeftPx !== null ? dragLeftPx : (coachSide === 'left' ? 16 : null)"
        [style.right.px]="dragLeftPx === null && coachSide === 'right' ? 16 : null"
        (pointerdown)="onFabPointerDown($event)"
        (pointermove)="onFabPointerMove($event)"
        (pointerup)="onFabPointerUp($event)"
        (pointercancel)="onFabPointerUp($event)"
        aria-label="Workout Coach">💪</button>
      @if (showCoachBubble) {
        <div class="coach-bubble" [class.anchor-left]="coachSide === 'left'"
          [style.top.px]="coachTop + 60"
          [style.left.px]="coachSide === 'left' ? 16 : null"
          [style.right.px]="coachSide === 'right' ? 16 : null">
          <button class="coach-bubble-close" (click)="dismissCoach()" aria-label="Dismiss">✕</button>
          <p style="margin:0">{{ coachLoading ? 'Thinking…' : coachMessage }}</p>
        </div>
      }
    }

    <div class="seg">
      <button [class.active]="viewMode === 'overview'" (click)="switchView('overview')">Overview</button>
      <button [class.active]="viewMode === 'workout'" (click)="switchView('workout')">Workout</button>
      <button [class.active]="viewMode === 'progress'" (click)="switchView('progress')">Progress</button>
    </div>

    @if (viewMode === 'overview') {
      <div class="card" style="margin-top:16px">
        <div class="row spread">
          <div>
            <div class="muted" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:700">
              {{ getPhaseGroup(overviewWeek).label }}
            </div>
            <h3 style="margin-bottom:2px">{{ getPhaseLabel(overviewWeek) }}</h3>
            <div class="muted">Load so far · swipe or tap to switch days</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="ghost" (click)="changeOverviewWeek(-1)">‹</button>
            <div style="font-weight:700;white-space:nowrap">W{{ overviewWeek }}</div>
            <button class="ghost" (click)="changeOverviewWeek(1)">›</button>
          </div>
        </div>
      </div>

      @if (overviewLoading) {
        <p class="muted">Loading overview…</p>
      } @else if (overview && overview.days.length) {
        <div class="row" style="gap:6px;justify-content:center;margin:4px 0 12px">
          @for (d of overview.days; track d.day; let i = $index) {
            <button class="ghost" style="padding:4px 10px;font-size:12px"
                    [style.background]="i === overviewCardIndex ? 'var(--accent)' : ''"
                    [style.color]="i === overviewCardIndex ? 'white' : ''"
                    (click)="goToCard(i)">{{ i + 1 }}</button>
          }
        </div>

        <div class="row spread" style="align-items:center">
          <button class="ghost" (click)="goToCard(overviewCardIndex - 1)"
                  [disabled]="overviewCardIndex === 0">‹</button>

          <div class="card" style="flex:1;margin-bottom:0"
               (touchstart)="onTouchStart($event)" (touchend)="onTouchEnd($event)">
            @let card = overview.days[overviewCardIndex];
            <h3>{{ dayLabel(card.day) }}</h3>
            <div class="muted" style="margin-top:-8px;margin-bottom:10px">{{ dayTag(card.day) }}</div>

            @for (section of ['Warm-Up', 'Strength', 'Cool-Down']; track section) {
              @if (sectionExercises(card, section).length) {
                <div class="muted" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:700;margin-top:12px">
                  {{ section }}
                </div>
                @for (ex of sectionExercises(card, section); track ex.order) {
                  <div class="row spread" style="margin-top:8px;align-items:flex-start">
                    <div style="flex:1">
                      <div style="font-weight:600">{{ ex.exercise }}</div>
                      <div class="muted">{{ ex.sets || '-' }}×{{ ex.reps || '-' }}</div>
                    </div>
                    <div style="text-align:right">
                      @if (ex.best_weight != null) {
                        <div style="font-weight:700;color:var(--accent)">
                          {{ ex.recent_weight ?? ex.best_weight }} lbs
                        </div>
                        <div class="muted" style="font-size:11px">
                          {{ ex.sets_logged }} {{ ex.sets_logged === 1 ? 'set' : 'sets' }} · wks {{ ex.week_min }}–{{ ex.week_max }}
                        </div>
                      } @else {
                        <div class="muted">BW</div>
                      }
                    </div>
                  </div>
                }
              }
            }
          </div>

          <button class="ghost" (click)="goToCard(overviewCardIndex + 1)"
                  [disabled]="overviewCardIndex === overview.days.length - 1">›</button>
        </div>
      } @else if (overview) {
        <p class="muted">No planned days found for week {{ overviewWeek }}.</p>
      }
    }

    @if (viewMode === 'workout') {
      <div class="card" style="margin-top:16px">
        <div class="row spread">
          <div>
            <div class="muted" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:700">
              {{ getPhaseGroup(currentWeek).label }}
            </div>
            <h3 style="margin-bottom:2px">{{ getPhaseLabel(currentWeek) }}</h3>
            <div class="muted">{{ weekInGroupLabel(currentWeek) }} · select a workout day</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="ghost" (click)="changeWeek(-1)">‹</button>
            <div style="font-weight:700;white-space:nowrap">W{{ currentWeek }}</div>
            <button class="ghost" (click)="changeWeek(1)">›</button>
          </div>
        </div>
        <button class="ghost" style="width:100%;margin-top:10px"
                (click)="cloneWeekOpen = !cloneWeekOpen">📋 Clone a week onto the end</button>
        @if (cloneWeekOpen) {
          <div class="row" style="margin-top:10px;gap:8px">
            <select [(ngModel)]="cloneWeekSource" style="flex:1">
              @for (w of weekOptions; track w) {
                <option [value]="w">Week {{ w }}</option>
              }
            </select>
            <button (click)="performCloneWeek()">Clone</button>
          </div>
        }
      </div>

      @if (weekLoading) {
        <p class="muted">Loading week…</p>
      } @else if (!days.length) {
        <div class="card">
          <p class="muted">You don't have a workout plan yet.</p>
          <button (click)="initializePlan()" [disabled]="initializing">
            {{ initializing ? 'Setting up…' : 'Set up my workout plan' }}
          </button>
          @if (initStatus) {
            <p class="muted" style="margin-top:8px">{{ initStatus }}</p>
          }
        </div>
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
              <button class="ghost" style="width:100%;margin-top:6px;padding:3px;font-size:11px"
                      (click)="$event.stopPropagation(); cloneDay(day)">+ Clone</button>
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

      <ng-template #exercisePreview>
        <div style="background:#0c0c12;border-radius:10px;padding:10px;margin-top:10px">
          <div class="row spread">
            <div style="font-weight:700">{{ previewLoading ? 'Loading…' : (previewDetails?.name || 'Exercise') }}</div>
            <button class="ghost" style="font-size:11px;padding:3px 8px" (click)="closePreview()">✕</button>
          </div>
          @if (previewDetails) {
            @if (previewDetails.image_url) {
              <img [src]="previewDetails.image_url" alt=""
                   style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-top:8px" />
            }
            @if (previewDetails.video_url) {
              <a [href]="previewDetails.video_url" target="_blank" class="muted"
                 style="display:inline-block;font-size:12px;margin-top:8px">▶ Watch Video</a>
            }
            @if (previewDetails.overview) {
              <p style="font-size:13px;margin-top:8px">{{ previewDetails.overview }}</p>
            }
            @if (previewDetails.equipments.length) {
              <div class="muted" style="margin-top:8px">EQUIPMENT</div>
              <div style="font-size:13px">{{ previewDetails.equipments.join(', ') }}</div>
            }
            @if (previewDetails.target_muscles.length) {
              <div class="muted" style="margin-top:8px">TARGET MUSCLES</div>
              <div style="font-size:13px">{{ previewDetails.target_muscles.join(', ') }}</div>
            }
            @if (previewDetails.instructions.length) {
              <div class="muted" style="margin-top:8px">INSTRUCTIONS</div>
              <ol style="padding-left:18px;font-size:13px;line-height:1.5;margin:4px 0 0">
                @for (s of previewDetails.instructions; track $index) { <li>{{ s }}</li> }
              </ol>
            }
            <button style="width:100%;margin-top:10px"
                    (click)="useExercise(previewPlanId, previewDetails.exercise_id)">
              Use this exercise
            </button>
          }
        </div>
      </ng-template>

      <ng-template #exerciseCard let-ex="ex" let-showTracker="showTracker">
        <div class="card">
          <div class="row spread" style="align-items:flex-start">
            <div style="font-weight:700;flex:1">{{ ex.exercise }}</div>
            <div class="row" style="gap:6px;flex-shrink:0">
              <div class="muted" style="font-size:11px;white-space:nowrap">
                {{ categoryMeta(ex.category).emoji }} {{ categoryMeta(ex.category).label }}
              </div>
              <button class="ghost" style="padding:2px 7px;font-size:12px" (click)="openEditPlan(ex)">✏️</button>
            </div>
          </div>

          @if (editingPlanId === ex.plan_id) {
            <div style="background:#14141c;border-radius:10px;padding:10px;margin-top:8px">
              <label>Exercise name</label>
              <input [(ngModel)]="editDraft.exercise" />
              <div class="row">
                <div style="flex:1"><label>Sets</label><input [(ngModel)]="editDraft.sets" /></div>
                <div style="flex:1"><label>Reps</label><input [(ngModel)]="editDraft.reps" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Weight/Load</label><input [(ngModel)]="editDraft.weight" /></div>
                <div style="flex:1"><label>Rest</label><input [(ngModel)]="editDraft.rest" /></div>
              </div>
              <div class="row">
                <div style="flex:1"><label>Tempo</label><input [(ngModel)]="editDraft.tempo" /></div>
                <div style="flex:1"><label>Category</label>
                  <select [(ngModel)]="editDraft.category">
                    @for (c of exerciseCategories; track c.id) {
                      <option [value]="c.id">{{ c.emoji }} {{ c.label }}</option>
                    }
                  </select>
                </div>
              </div>
              <label>Notes</label>
              <input [(ngModel)]="editDraft.notes" />
              <div class="row" style="margin-top:10px">
                <button (click)="saveEditPlan()">Save</button>
                <button class="ghost" (click)="editingPlanId = null">Cancel</button>
              </div>
            </div>
          } @else {

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
              @if (ex.equipments.length) {
                <div class="muted" style="margin-top:8px">EQUIPMENT</div>
                <div style="font-size:13px">{{ ex.equipments.join(', ') }}</div>
              }

              @if (ex.exercise_tips.length) {
                <div class="row spread" style="cursor:pointer;margin-top:10px"
                     (click)="toggleAccordion(tipsOpenPlanIds, ex.plan_id)">
                  <div class="muted">💡 EXERCISE TIPS ({{ ex.exercise_tips.length }})</div>
                  <span class="muted">{{ tipsOpenPlanIds.has(ex.plan_id) ? '▲' : '▼' }}</span>
                </div>
                @if (tipsOpenPlanIds.has(ex.plan_id)) {
                  <ul style="padding-left:18px;font-size:13px;line-height:1.5;margin-top:6px">
                    @for (t of ex.exercise_tips; track $index) { <li>{{ t }}</li> }
                  </ul>
                }
              }

              @if (ex.variations.length) {
                <div class="row spread" style="cursor:pointer;margin-top:10px"
                     (click)="toggleAccordion(variationsOpenPlanIds, ex.plan_id)">
                  <div class="muted">🔀 VARIATIONS ({{ ex.variations.length }})</div>
                  <span class="muted">{{ variationsOpenPlanIds.has(ex.plan_id) ? '▲' : '▼' }}</span>
                </div>
                @if (variationsOpenPlanIds.has(ex.plan_id)) {
                  <ul style="padding-left:18px;font-size:13px;line-height:1.5;margin-top:6px">
                    @for (v of ex.variations; track $index) { <li>{{ v }}</li> }
                  </ul>
                }
              }

              <div class="row" style="gap:8px;margin-top:10px">
                <button class="ghost" style="flex:1;font-size:12px;padding:8px"
                        (click)="toggleDetailPanel(ex.plan_id, 'swap')">🔁 Swap exercise</button>
                <button class="ghost" style="flex:1;font-size:12px;padding:8px"
                        (click)="toggleDetailPanel(ex.plan_id, 'custom')">➕ Custom exercise</button>
              </div>

              @if (detailPanelPlanId === ex.plan_id && detailPanelMode === 'swap') {
                <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
                  <label>Search ExerciseDB</label>
                  <div class="row">
                    <input [(ngModel)]="swapQuery" placeholder="e.g. incline dumbbell press" />
                    <button class="ghost" (click)="searchLiveExercises()">Search</button>
                  </div>
                  <p class="muted">{{ swapStatus }}</p>
                  @for (r of swapResults; track r.exercise_id) {
                    <div class="row spread" style="background:#0c0c12;border-radius:8px;padding:8px;margin-top:6px">
                      <div class="row" style="gap:8px;min-width:0">
                        @if (r.image_url) {
                          <img class="thumb" [src]="r.image_url" alt="" style="width:32px;height:32px" />
                        } @else {
                          <div class="thumb" style="width:32px;height:32px;font-size:14px">🏋️</div>
                        }
                        <div style="min-width:0">
                          <div style="font-size:13px">{{ r.name }}</div>
                          <div class="muted" style="font-size:10px">{{ typeLabel(r) }}</div>
                          @if (r.equipments.length) {
                            <div class="muted" style="font-size:10px">{{ r.equipments.join(', ') }}</div>
                          }
                        </div>
                      </div>
                      <div class="row" style="gap:6px;flex-shrink:0">
                        <button class="ghost" style="font-size:11px;padding:5px 8px"
                                (click)="showPreview(ex.plan_id, r.exercise_id)">Info</button>
                        <button class="ghost" style="font-size:11px;padding:5px 8px"
                                (click)="useExercise(ex.plan_id, r.exercise_id)">Use</button>
                      </div>
                    </div>
                  }

                  <div class="row spread" style="cursor:pointer;margin-top:12px" (click)="toggleCacheBrowse()">
                    <label style="margin:0">Browse already-cached exercises ({{ cacheOptions?.total || '…' }})</label>
                    <span class="muted">{{ cacheBrowseOpen ? '▲' : '▼' }}</span>
                  </div>
                  @if (cacheBrowseOpen) {
                    <input [(ngModel)]="cacheFilters.search_text" placeholder="Search name/overview…"
                           style="margin-top:8px" (ngModelChange)="runCacheSearch()" />

                    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
                      @for (f of filterDefs; track f.key) {
                        <button class="ghost" style="font-size:11px;padding:6px 10px"
                                (click)="toggleFilterDropdown(f.key)">
                          {{ f.label }}{{ cacheFilters[f.key].length ? ' (' + cacheFilters[f.key].length + ')' : '' }}
                          {{ openFilterKey === f.key ? '▲' : '▼' }}
                        </button>
                      }
                      <button class="ghost" style="font-size:11px;padding:6px 10px"
                              (click)="resetCacheFilters()">↺ Reset filters</button>
                    </div>
                    @if (openFilterKey) {
                      <div style="background:#0c0c12;border-radius:8px;padding:8px;margin-top:6px">
                        <input [(ngModel)]="filterOptionSearch" placeholder="Filter options…"
                               style="margin-bottom:6px" />
                        <div style="max-height:160px;overflow:auto">
                          @for (opt of currentFilterOptions(); track opt) {
                            <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px">
                              <input type="checkbox" style="width:auto" [checked]="isFilterSelected(opt)"
                                     (change)="toggleFilterOption(opt)" />
                              {{ opt }}
                            </label>
                          } @empty {
                            <p class="muted" style="margin:0">No matches.</p>
                          }
                        </div>
                      </div>
                    }

                    @for (item of cacheResults?.items || []; track item.exercise_id) {
                      <div class="row spread" style="background:#0c0c12;border-radius:8px;padding:8px;margin-top:6px">
                        <div class="row" style="gap:8px;min-width:0">
                          @if (item.image_url) {
                            <img class="thumb" [src]="item.image_url" alt="" style="width:32px;height:32px" />
                          } @else {
                            <div class="thumb" style="width:32px;height:32px;font-size:14px">🏋️</div>
                          }
                          <div style="min-width:0">
                            <div style="font-size:13px">{{ item.name }}</div>
                            <div class="muted" style="font-size:10px">{{ typeLabel(item) }}</div>
                            @if (item.equipments.length) {
                              <div class="muted" style="font-size:10px">{{ item.equipments.join(', ') }}</div>
                            }
                          </div>
                        </div>
                        <div class="row" style="gap:6px;flex-shrink:0">
                          <button class="ghost" style="font-size:11px;padding:5px 8px"
                                  (click)="showPreview(ex.plan_id, item.exercise_id)">Info</button>
                          <button class="ghost" style="font-size:11px;padding:5px 8px"
                                  (click)="useExercise(ex.plan_id, item.exercise_id)">Use</button>
                        </div>
                      </div>
                    }
                    @if (cacheResults && cacheResults.total_pages > 1) {
                      <div class="row spread" style="margin-top:8px">
                        <button class="ghost" [disabled]="cacheResults.page <= 1"
                                (click)="setCachePage(cacheResults.page - 1)">← Prev</button>
                        <span class="muted">Page {{ cacheResults.page }}/{{ cacheResults.total_pages }}</span>
                        <button class="ghost" [disabled]="cacheResults.page >= cacheResults.total_pages"
                                (click)="setCachePage(cacheResults.page + 1)">Next →</button>
                      </div>
                    }
                  }
                </div>
              }

              @if (previewPlanId === ex.plan_id) {
                <ng-container [ngTemplateOutlet]="exercisePreview"></ng-container>
              }

              @if (detailPanelPlanId === ex.plan_id && detailPanelMode === 'custom') {
                <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
                  <label>Name</label>
                  <input [(ngModel)]="customDraft.name" placeholder="Exercise name" />
                  <label>Image URL</label>
                  <input [(ngModel)]="customDraft.image_url" placeholder="https://…" />
                  <label>Video URL</label>
                  <input [(ngModel)]="customDraft.video_url" placeholder="https://…" />
                  <label>Overview</label>
                  <input [(ngModel)]="customDraft.overview" />
                  <label>Instructions (one per line)</label>
                  <textarea [(ngModel)]="customInstructionsText" rows="3"
                            style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
                                   border-radius:10px;padding:10px 12px;font-size:15px;resize:none"></textarea>
                  <div class="row">
                    <div style="flex:1"><label>Target muscles (comma-separated)</label>
                      <input [(ngModel)]="customMusclesText" /></div>
                    <div style="flex:1"><label>Equipment (comma-separated)</label>
                      <input [(ngModel)]="customEquipText" /></div>
                  </div>
                  <div class="row" style="margin-top:10px">
                    <button (click)="saveCustomExerciseForm()">Save custom exercise</button>
                    <button class="ghost" (click)="detailPanelPlanId = null; detailPanelMode = null">Cancel</button>
                  </div>
                </div>
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
                  <button [class.green]="set.done"
                          style="width:44px;padding:8px" (click)="toggleSet(ex, set.set_num)">✓</button>
                </div>
              }
              <button class="ghost ex-done-btn" [class.green]="completedExercises.has(ex.exercise)"
                      style="width:100%;margin-top:4px" (click)="toggleExerciseComplete(ex)">
                {{ completedExercises.has(ex.exercise) ? '✓ Done!' : 'Mark Complete' }}
              </button>
            </div>
          }
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
      <div class="seg" style="margin-top:16px">
        @for (g of phaseGroups; track g.key) {
          <button [class.active]="progressPhaseGroupKey === g.key"
                  (click)="selectProgressPhaseGroup(g.key)">{{ g.label }}</button>
        }
      </div>

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
          <h3>🏋️ {{ selectedProgressPhaseGroup().label }} Progress</h3>
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
  styles: [`
    .coach-fab {
      position: fixed;
      z-index: 40;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: none;
      background: var(--accent, #ff4d6d);
      font-size: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
      cursor: grab;
      touch-action: none;
      animation: coach-fab-pulse 2s ease-in-out infinite;
    }
    .coach-fab.dragging {
      animation: none;
      cursor: grabbing;
    }
    @keyframes coach-fab-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    .coach-bubble {
      position: fixed;
      z-index: 41;
      max-width: 220px;
      background: #fff;
      color: #111;
      border: 3px solid #111;
      border-radius: 18px;
      padding: 12px 30px 12px 14px;
      font-weight: 600;
      font-size: 14px;
      line-height: 1.35;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
    }
    .coach-bubble::before {
      content: '';
      position: absolute;
      top: -17px;
      right: 22px;
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-bottom: 14px solid #111;
    }
    .coach-bubble::after {
      content: '';
      position: absolute;
      top: -13px;
      right: 24px;
      width: 0;
      height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 12px solid #fff;
    }
    .coach-bubble.anchor-left::before {
      right: auto;
      left: 22px;
    }
    .coach-bubble.anchor-left::after {
      right: auto;
      left: 24px;
    }
    .coach-bubble-close {
      position: absolute;
      top: 4px;
      right: 6px;
      background: none;
      border: none;
      font-size: 14px;
      font-weight: 800;
      color: #111;
      cursor: pointer;
      line-height: 1;
      padding: 2px 4px;
    }
  `],
})
export class WorkoutComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);

  viewMode: 'overview' | 'workout' | 'progress' = 'workout';
  categoryMeta = exerciseCategoryMeta;
  exerciseCategories = EXERCISE_CATEGORIES;

  overviewWeek = 1;
  overviewLoading = false;
  overview: WorkoutOverview | null = null;
  overviewCardIndex = 0;
  private touchStartX = 0;

  currentWeek = 1;
  days: string[] = [];
  completedDays: string[] = [];
  weekLoading = false;
  weekOptions = Array.from({ length: 52 }, (_, i) => i + 1);
  initializing = false;
  initStatus = '';

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
  phaseGroups = PHASE_GROUPS;
  progressPhaseGroupKey = PHASE_GROUPS[0].key;

  status = '';

  // ---------- Workout Coach ----------
  showCoachBubble = false;
  coachLoading = false;
  coachMessage = '';
  private coachSub?: Subscription;

  // Drag-to-reposition: dragLeftPx is the live px position while actively
  // dragging (null when settled, so the anchored side takes over). Snaps to
  // whichever screen edge is nearer on release, like a chat-head bubble.
  coachTop = 160;
  coachSide: 'left' | 'right' = 'right';
  dragging = false;
  dragLeftPx: number | null = null;
  private dragMoved = false;
  private pointerId: number | null = null;
  private grabOffsetX = 0;
  private grabOffsetY = 0;
  private downClientX = 0;
  private downClientY = 0;
  private static readonly FAB_SIZE = 52;
  private static readonly DRAG_THRESHOLD = 6;
  private static readonly TOPBAR_HEIGHT = 52;

  onFabPointerDown(ev: PointerEvent): void {
    const btn = ev.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.grabOffsetX = ev.clientX - rect.left;
    this.grabOffsetY = ev.clientY - rect.top;
    this.downClientX = ev.clientX;
    this.downClientY = ev.clientY;
    this.dragging = true;
    this.dragMoved = false;
    this.pointerId = ev.pointerId;
    btn.setPointerCapture(ev.pointerId);
  }

  onFabPointerMove(ev: PointerEvent): void {
    if (!this.dragging || ev.pointerId !== this.pointerId) return;
    if (!this.dragMoved) {
      const dist = Math.hypot(ev.clientX - this.downClientX, ev.clientY - this.downClientY);
      if (dist < WorkoutComponent.DRAG_THRESHOLD) return;
      this.dragMoved = true;
    }
    const size = WorkoutComponent.FAB_SIZE;
    const margin = 4;
    const left = Math.min(Math.max(ev.clientX - this.grabOffsetX, margin), window.innerWidth - size - margin);
    const top = Math.min(
      Math.max(ev.clientY - this.grabOffsetY, WorkoutComponent.TOPBAR_HEIGHT + margin),
      window.innerHeight - size - margin,
    );
    this.dragLeftPx = left;
    this.coachTop = top;
  }

  onFabPointerUp(ev: PointerEvent): void {
    if (!this.dragging || ev.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.dragMoved) {
      const centerX = (this.dragLeftPx ?? 16) + WorkoutComponent.FAB_SIZE / 2;
      this.coachSide = centerX < window.innerWidth / 2 ? 'left' : 'right';
      this.dragLeftPx = null;
    } else {
      this.triggerCoach();
    }
  }

  triggerCoach(): void {
    this.coachSub?.unsubscribe();
    this.showCoachBubble = true;
    this.coachLoading = true;
    this.coachSub = this.api.workoutNudge().subscribe({
      next: (r) => {
        this.coachLoading = false;
        this.coachMessage = r.message;
      },
      error: () => {
        this.coachLoading = false;
        this.coachMessage = "Couldn't reach the coach — try again in a bit.";
      },
    });
  }

  dismissCoach(): void {
    this.showCoachBubble = false;
    this.coachSub?.unsubscribe();
  }

  ngOnDestroy(): void {
    this.coachSub?.unsubscribe();
  }

  // --- Phase 2: edit exercise fields ---
  editingPlanId: string | null = null;
  editDraft: WorkoutPlanUpdateRequest = {};

  // --- Phase 2: clone week ---
  cloneWeekOpen = false;
  cloneWeekSource = 1;

  // --- Phase 2: swap / custom exercise (one exercise's panel active at a time) ---
  detailPanelPlanId: string | null = null;
  detailPanelMode: 'swap' | 'custom' | null = null;

  swapQuery = '';
  swapResults: ExerciseSearchResultItem[] = [];
  swapStatus = '';

  cacheBrowseOpen = false;
  cacheOptions: ExerciseCacheOptions | null = null;
  cacheFilters = EMPTY_CACHE_FILTERS();
  cacheResults: ExerciseCacheSearchResult | null = null;
  filterDefs = CACHE_FILTER_DEFS;
  openFilterKey: CacheFilterKey | null = null;
  filterOptionSearch = '';

  customDraft: CustomExerciseRequest = { name: '' };
  customInstructionsText = '';
  customMusclesText = '';
  customEquipText = '';

  // --- Phase 2: exercise detail accordions (tips / variations / related) ---
  tipsOpenPlanIds = new Set<string>();
  variationsOpenPlanIds = new Set<string>();

  // --- Phase 2: exercise info preview (search results, cache results) ---
  previewPlanId: string | null = null;
  previewDetails: ExerciseDetails | null = null;
  previewLoading = false;

  ngOnInit(): void {
    this.api.getWorkoutConfig().subscribe({
      next: (res) => {
        this.currentWeek = res.config?.current_week || 1;
        this.loadWeek(this.currentWeek);
      },
      error: () => this.loadWeek(this.currentWeek),
    });
  }

  switchView(mode: 'overview' | 'workout' | 'progress'): void {
    this.viewMode = mode;
    if (mode === 'progress') {
      this.progressPhaseGroupKey = this.getPhaseGroup(this.currentWeek).key;
      this.loadProgress();
    } else if (mode === 'overview') {
      this.overviewWeek = this.currentWeek;
      this.loadOverview();
    }
  }

  loadOverview(): void {
    this.overviewLoading = true;
    this.overviewCardIndex = 0;
    this.api.getWorkoutLoadOverview(this.overviewWeek).subscribe({
      next: (o) => {
        this.overview = o;
        this.overviewLoading = false;
      },
      error: () => {
        this.overview = null;
        this.overviewLoading = false;
      },
    });
  }

  changeOverviewWeek(delta: number): void {
    this.overviewWeek = Math.max(1, this.overviewWeek + delta);
    this.loadOverview();
  }

  goToCard(i: number): void {
    if (!this.overview) return;
    this.overviewCardIndex = Math.max(0, Math.min(this.overview.days.length - 1, i));
  }

  sectionExercises(card: OverviewDay, section: string) {
    return card.exercises.filter((ex) => ex.section === section);
  }

  onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.touches[0].clientX;
  }

  onTouchEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    if (Math.abs(dx) < 40) return;
    this.goToCard(this.overviewCardIndex + (dx < 0 ? 1 : -1));
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

  initializePlan(): void {
    this.initializing = true;
    this.initStatus = '';
    this.api.initializeWorkoutPlan().subscribe({
      next: (r) => {
        this.initializing = false;
        if (r.initialized) {
          this.initStatus = '';
          this.loadWeek(this.currentWeek);
        } else {
          this.initStatus = 'You already have a workout plan.';
        }
      },
      error: () => {
        this.initializing = false;
        this.initStatus = 'Could not set up your plan — try again.';
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
    this.editingPlanId = null;
    this.detailPanelPlanId = null;
    this.detailPanelMode = null;
    this.tipsOpenPlanIds = new Set<string>();
    this.variationsOpenPlanIds = new Set<string>();
    this.closePreview();
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

  toggleSet(ex: PlanExercise, setNum: number): void {
    const draft = this.setDraftsByExercise[ex.exercise]?.find((d) => d.set_num === setNum);
    if (!draft || !this.currentDay) return;
    if (draft.done) {
      draft.done = false;
      this.completedExercises.delete(ex.exercise);
      this.api.deleteWorkoutSet(this.currentWeek, this.currentDay, ex.exercise, setNum).subscribe({
        error: () => {
          draft.done = true;
          this.status = 'Could not update set.';
        },
      });
    } else {
      draft.done = true;
      this.api.logWorkoutSet({
        week: this.currentWeek, day: this.currentDay, exercise: ex.exercise, set_num: setNum,
        planned_reps: ex.reps,
        actual_reps: draft.actual_reps != null ? String(draft.actual_reps) : '',
        weight: draft.weight != null ? String(draft.weight) : '',
      }).subscribe({
        error: () => {
          draft.done = false;
          this.completedExercises.delete(ex.exercise);
          this.status = 'Could not update set.';
        },
      });
    }
  }

  toggleExerciseComplete(ex: PlanExercise): void {
    if (this.completedExercises.has(ex.exercise)) {
      this.completedExercises.delete(ex.exercise);
    } else {
      this.completedExercises.add(ex.exercise);
    }
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
    const g = this.selectedProgressPhaseGroup();
    this.api.getWorkoutProgress(g.weekStart, g.weekEnd).subscribe({
      next: (p) => {
        this.progress = p;
        this.progressLoading = false;
      },
      error: () => {
        this.progressLoading = false;
      },
    });
  }

  selectedProgressPhaseGroup(): PhaseGroup {
    return this.phaseGroups.find((g) => g.key === this.progressPhaseGroupKey) ?? this.phaseGroups[0];
  }

  selectProgressPhaseGroup(key: string): void {
    if (this.progressPhaseGroupKey === key) return;
    this.progressPhaseGroupKey = key;
    this.loadProgress();
  }

  progressPct(): number {
    if (!this.progress || !this.progress.total_planned_days) return 0;
    return Math.min(100, Math.round(
      (this.progress.distinct_days_completed / this.progress.total_planned_days) * 100));
  }

  energyIcon(level: string): string {
    return sharedEnergyIcon(level);
  }

  getPhaseLabel(week: number): string {
    if (week <= 2) return 'Phase 1: Reintroduction 🌱';
    if (week <= 5) return 'Phase 2: Building 📈';
    if (week <= 8) return 'Phase 3: Strength 💪';
    if (week <= 10) return 'Phase 4: Peak 🔥';
    return 'Maintenance 🛠️';
  }

  getPhaseGroup(week: number): PhaseGroup {
    return PHASE_GROUPS.find((g) => week >= g.weekStart && week <= g.weekEnd)
      ?? PHASE_GROUPS[PHASE_GROUPS.length - 1];
  }

  weekInGroupLabel(week: number): string {
    const g = this.getPhaseGroup(week);
    const indexInGroup = week - g.weekStart + 1;
    const groupLength = g.weekEnd - g.weekStart + 1;
    return `Week ${week} · week ${indexInGroup} of ${groupLength}`;
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

  // ==========================================
  // Phase 2: edit exercise fields
  // ==========================================

  openEditPlan(ex: PlanExercise): void {
    if (!ex.plan_id) return;
    this.editingPlanId = ex.plan_id;
    this.editDraft = {
      exercise: ex.exercise, sets: ex.sets, reps: ex.reps, weight: ex.weight,
      tempo: ex.tempo, rest: ex.rest, notes: ex.notes, category: ex.category,
    };
  }

  saveEditPlan(): void {
    if (!this.editingPlanId) return;
    this.api.updateWorkoutPlanExercise(this.editingPlanId, this.editDraft).subscribe({
      next: () => {
        this.editingPlanId = null;
        this.status = 'Exercise updated.';
        if (this.currentDay) this.selectDay(this.currentDay);
      },
      error: () => (this.status = 'Could not update exercise.'),
    });
  }

  // ==========================================
  // Phase 2: clone day / clone week
  // ==========================================

  cloneDay(day: string): void {
    const newName = window.prompt(
      'New day name for the cloned session:\n(e.g. "Day 4 - Upper Body B")', `${day} (Copy)`);
    if (!newName || !newName.trim()) return;
    this.api.cloneWorkoutDay({
      week: this.currentWeek, source_day: day, new_day_name: newName.trim(),
    }).subscribe({
      next: (res) => {
        this.status = res.message;
        if (res.success) this.loadWeek(this.currentWeek);
      },
      error: () => (this.status = 'Clone failed.'),
    });
  }

  performCloneWeek(): void {
    this.api.cloneWorkoutWeek({ source_week: this.cloneWeekSource }).subscribe({
      next: (res) => {
        this.cloneWeekOpen = false;
        this.status = res.message;
        if (res.success && res.new_week) {
          this.currentWeek = res.new_week;
          this.currentDay = null;
          this.dayData = null;
          this.api.setWorkoutConfig(this.currentWeek).subscribe();
          this.loadWeek(this.currentWeek);
        }
      },
      error: () => (this.status = 'Clone failed.'),
    });
  }

  // ==========================================
  // Phase 2: swap exercise (live search + cache browse) / custom exercise
  // ==========================================

  toggleDetailPanel(planId: string | null | undefined, mode: 'swap' | 'custom'): void {
    if (!planId) return;
    if (this.detailPanelPlanId === planId && this.detailPanelMode === mode) {
      this.detailPanelPlanId = null;
      this.detailPanelMode = null;
      return;
    }
    this.detailPanelPlanId = planId;
    this.detailPanelMode = mode;
    this.swapQuery = '';
    this.swapResults = [];
    this.swapStatus = '';
    this.cacheBrowseOpen = false;
    this.cacheResults = null;
    this.cacheFilters = EMPTY_CACHE_FILTERS();
    this.openFilterKey = null;
    this.closePreview();
    if (mode === 'custom') {
      this.customDraft = { name: '' };
      this.customInstructionsText = '';
      this.customMusclesText = '';
      this.customEquipText = '';
    }
  }

  searchLiveExercises(): void {
    const q = this.swapQuery.trim();
    if (!q) return;
    this.swapStatus = 'Searching…';
    this.api.searchWorkoutExercises(q).subscribe({
      next: (res) => {
        this.swapResults = res.results;
        this.swapStatus = res.results.length
          ? `Found ${res.results.length} result(s).` : 'No exercises found.';
      },
      error: () => (this.swapStatus = 'Search failed.'),
    });
  }

  toggleCacheBrowse(): void {
    this.cacheBrowseOpen = !this.cacheBrowseOpen;
    if (!this.cacheBrowseOpen) return;
    if (!this.cacheOptions) {
      this.api.getExerciseCacheOptions().subscribe((opts) => {
        this.cacheOptions = opts;
        this.runCacheSearch();
      });
    } else {
      this.runCacheSearch();
    }
  }

  runCacheSearch(): void {
    this.cacheFilters.page = 1;
    this.api.searchExerciseCache(this.cacheFilters).subscribe((res) => (this.cacheResults = res));
  }

  setCachePage(page: number): void {
    this.cacheFilters.page = page;
    this.api.searchExerciseCache(this.cacheFilters).subscribe((res) => (this.cacheResults = res));
  }

  resetCacheFilters(): void {
    this.cacheFilters = EMPTY_CACHE_FILTERS();
    this.openFilterKey = null;
    this.filterOptionSearch = '';
    this.runCacheSearch();
  }

  toggleFilterDropdown(key: CacheFilterKey): void {
    this.openFilterKey = this.openFilterKey === key ? null : key;
    this.filterOptionSearch = '';
  }

  currentFilterOptions(): string[] {
    if (!this.openFilterKey || !this.cacheOptions) return [];
    const all = this.cacheOptions[this.openFilterKey] || [];
    const q = this.filterOptionSearch.trim().toLowerCase();
    return q ? all.filter((o) => o.toLowerCase().includes(q)) : all;
  }

  isFilterSelected(opt: string): boolean {
    return !!this.openFilterKey && this.cacheFilters[this.openFilterKey].includes(opt);
  }

  toggleFilterOption(opt: string): void {
    if (!this.openFilterKey) return;
    const arr = this.cacheFilters[this.openFilterKey];
    const idx = arr.indexOf(opt);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(opt);
    this.runCacheSearch();
  }

  typeLabel(item: { exercise_type?: string; body_parts?: string[] }): string {
    return [item.exercise_type, ...(item.body_parts || [])].filter(Boolean).join(' · ');
  }

  // --- exercise info preview ---

  showPreview(planId: string | null | undefined, exerciseId: string): void {
    if (!planId) return;
    this.previewPlanId = planId;
    this.previewDetails = null;
    this.previewLoading = true;
    this.api.getWorkoutExerciseDetails(exerciseId).subscribe({
      next: (d) => {
        this.previewDetails = d;
        this.previewLoading = false;
      },
      error: () => {
        this.previewLoading = false;
        this.swapStatus = 'Could not load details.';
      },
    });
  }

  closePreview(): void {
    this.previewPlanId = null;
    this.previewDetails = null;
    this.previewLoading = false;
  }

  // --- tips / variations accordions ---

  toggleAccordion(set: Set<string>, planId: string | null | undefined): void {
    if (!planId) return;
    if (set.has(planId)) set.delete(planId); else set.add(planId);
  }

  useExercise(planId: string | null | undefined, exerciseId: string): void {
    if (!planId) return;
    this.api.swapWorkoutExercise(planId, exerciseId).subscribe({
      next: () => {
        this.status = 'Exercise updated.';
        this.detailPanelPlanId = null;
        this.detailPanelMode = null;
        this.closePreview();
        if (this.currentDay) this.selectDay(this.currentDay);
      },
      error: () => (this.swapStatus = 'Could not swap exercise.'),
    });
  }

  saveCustomExerciseForm(): void {
    if (!this.detailPanelPlanId || !this.customDraft.name.trim()) {
      this.status = 'Exercise name is required.';
      return;
    }
    const req: CustomExerciseRequest = {
      ...this.customDraft,
      instructions: this.customInstructionsText.split('\n').map((s) => s.trim()).filter(Boolean),
      target_muscles: this.customMusclesText.split(',').map((s) => s.trim()).filter(Boolean),
      equipments: this.customEquipText.split(',').map((s) => s.trim()).filter(Boolean),
    };
    this.api.saveCustomExercise(this.detailPanelPlanId, req).subscribe({
      next: () => {
        this.status = 'Custom exercise saved.';
        this.detailPanelPlanId = null;
        this.detailPanelMode = null;
        if (this.currentDay) this.selectDay(this.currentDay);
      },
      error: () => (this.status = 'Could not save custom exercise.'),
    });
  }
}
