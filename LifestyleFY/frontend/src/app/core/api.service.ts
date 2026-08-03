import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AiPromptPreview, AiPrompts, CloneDayRequest, CloneResult, CloneWeekRequest, CoachMessage,
  CustomExerciseRequest, ExerciseCacheFilters, ExerciseCacheOptions, ExerciseCacheSearchResult,
  ExerciseDetails, ExerciseSearchResultItem, FoodItem, Goals, GroceryList, InventoryItem,
  LogEntry, LogRequest, PlanExercise, Profile, Recipe, TodaySummary, WorkoutConfig, WorkoutDay,
  WorkoutOverview, WorkoutPlanUpdateRequest, WorkoutProgress, WorkoutSessionLogRequest,
  WorkoutSetEntry, WorkoutSetLogRequest, WorkoutWeekOverview,
} from './models';

/** Typed client for the FastAPI nutrition backend. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiBase;

  // --- scanning / search ---
  scan(barcode: string): Observable<{ item: FoodItem; source: string }> {
    return this.http.post<{ item: FoodItem; source: string }>(
      `${this.base}/scan`, { barcode });
  }
  search(q: string): Observable<{ results: FoodItem[] }> {
    return this.http.get<{ results: FoodItem[] }>(
      `${this.base}/search`, { params: { q } });
  }
  getRawProduct(barcode: string): Observable<{ product: any }> {
    return this.http.get<{ product: any }>(`${this.base}/product/${barcode}/raw`);
  }

  // --- inventory ---
  listInventory(): Observable<{ items: InventoryItem[] }> {
    return this.http.get<{ items: InventoryItem[] }>(`${this.base}/inventory`);
  }
  addInventory(item: InventoryItem): Observable<{ item: InventoryItem }> {
    return this.http.post<{ item: InventoryItem }>(`${this.base}/inventory`, item);
  }
  deleteInventory(itemId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/inventory/${itemId}`);
  }

  // --- logging / today ---
  log(req: LogRequest): Observable<TodaySummary> {
    return this.http.post<TodaySummary>(`${this.base}/log`, req);
  }
  today(date?: string): Observable<TodaySummary> {
    return this.http.get<TodaySummary>(
      `${this.base}/today`, { params: date ? { date } : {} });
  }
  getLog(date?: string): Observable<{ entries: LogEntry[] }> {
    return this.http.get<{ entries: LogEntry[] }>(
      `${this.base}/log`, { params: date ? { date } : {} });
  }
  updateLog(logId: string, req: LogRequest): Observable<TodaySummary> {
    return this.http.put<TodaySummary>(`${this.base}/log/${logId}`, req);
  }
  deleteLog(logId: string, day?: string): Observable<TodaySummary> {
    return this.http.delete<TodaySummary>(
      `${this.base}/log/${logId}`, { params: day ? { day } : {} });
  }

  // --- profile / goals ---
  getProfile(): Observable<{ profile: Profile | null }> {
    return this.http.get<{ profile: Profile | null }>(`${this.base}/profile`);
  }
  setProfile(p: Profile): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.base}/profile`, p);
  }
  getGoals(): Observable<{ goals: Goals | null }> {
    return this.http.get<{ goals: Goals | null }>(`${this.base}/goals`);
  }
  setGoals(g: Goals): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.base}/goals`, g);
  }
  suggestGoals(phase = 'bulk', targetWeightLb?: number): Observable<{ goals: Goals }> {
    return this.http.post<{ goals: Goals }>(
      `${this.base}/goals/suggest`,
      { phase, target_weight_lb: targetWeightLb ?? null });
  }
  nextGoal(): Observable<{ goals: Goals }> {
    return this.http.post<{ goals: Goals }>(`${this.base}/goals/next`, {});
  }

  // --- Recipes ---
  suggestRecipe(mealPeriod: string, message = ''): Observable<{ recipe: Recipe }> {
    return this.http.post<{ recipe: Recipe }>(
      `${this.base}/recipes/suggest`, { meal_period: mealPeriod, message });
  }
  suggestRecipePreview(mealPeriod: string): Observable<AiPromptPreview> {
    return this.http.post<AiPromptPreview>(
      `${this.base}/recipes/suggest/preview`, { meal_period: mealPeriod });
  }
  saveRecipe(recipe: Recipe): Observable<{ recipe: Recipe }> {
    return this.http.post<{ recipe: Recipe }>(`${this.base}/recipes`, recipe);
  }
  listRecipes(): Observable<{ recipes: Recipe[] }> {
    return this.http.get<{ recipes: Recipe[] }>(`${this.base}/recipes`);
  }
  deleteRecipe(recipeId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/recipes/${recipeId}`);
  }

  // --- AI ---
  grocery(days = 7, day?: string, message = ''): Observable<{ grocery_list: GroceryList }> {
    return this.http.post<{ grocery_list: GroceryList }>(`${this.base}/grocery`, { days, day, message });
  }
  groceryPreview(days = 7, day?: string): Observable<AiPromptPreview> {
    return this.http.post<AiPromptPreview>(`${this.base}/grocery/preview`, { days, day });
  }

  // --- Grocery lists (saved/persisted) ---
  saveGroceryList(gl: GroceryList): Observable<{ grocery_list: GroceryList }> {
    return this.http.post<{ grocery_list: GroceryList }>(`${this.base}/grocery-lists`, gl);
  }
  listGroceryLists(): Observable<{ grocery_lists: GroceryList[] }> {
    return this.http.get<{ grocery_lists: GroceryList[] }>(`${this.base}/grocery-lists`);
  }
  deleteGroceryList(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/grocery-lists/${id}`);
  }
  runCoach(meal: string, timeLabel: string, day?: string, message = ''):
    Observable<{ nudge: string | null; on_track: boolean }> {
    return this.http.post<{ nudge: string | null; on_track: boolean }>(
      `${this.base}/coach`, { meal, time_label: timeLabel, day, message });
  }
  coachPreview(meal: string, timeLabel: string, day?: string): Observable<AiPromptPreview> {
    return this.http.post<AiPromptPreview>(
      `${this.base}/coach/preview`, { meal, time_label: timeLabel, day });
  }
  coachMessages(): Observable<{ messages: CoachMessage[] }> {
    return this.http.get<{ messages: CoachMessage[] }>(`${this.base}/coach/messages`);
  }

  // --- AI prompts: per-category standing note ---
  getAiPrompts(): Observable<{ prompts: AiPrompts }> {
    return this.http.get<{ prompts: AiPrompts }>(`${this.base}/ai-prompts`);
  }
  setAiPrompts(prompts: AiPrompts): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.base}/ai-prompts`, prompts);
  }

  // --- workout ---
  getWorkoutConfig(): Observable<{ config: WorkoutConfig }> {
    return this.http.get<{ config: WorkoutConfig }>(`${this.base}/workout/config`);
  }
  setWorkoutConfig(currentWeek: number): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(
      `${this.base}/workout/config`, { current_week: currentWeek });
  }
  getWorkoutWeekOverview(week: number): Observable<WorkoutWeekOverview> {
    return this.http.get<WorkoutWeekOverview>(`${this.base}/workout/weeks/${week}/overview`);
  }
  getWorkoutLoadOverview(week: number): Observable<WorkoutOverview> {
    return this.http.get<WorkoutOverview>(`${this.base}/workout/weeks/${week}/load-overview`);
  }
  getWorkoutDay(week: number, day: string): Observable<WorkoutDay> {
    return this.http.get<WorkoutDay>(
      `${this.base}/workout/weeks/${week}/days/${encodeURIComponent(day)}`);
  }
  logWorkoutSet(req: WorkoutSetLogRequest): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/workout/sets`, req);
  }
  getWorkoutSets(week: number, day: string): Observable<{ sets: WorkoutSetEntry[] }> {
    return this.http.get<{ sets: WorkoutSetEntry[] }>(
      `${this.base}/workout/sets`, { params: { week, day } });
  }
  deleteWorkoutSet(week: number, day: string, exercise: string,
                   setNum: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.base}/workout/sets`, { params: { week, day, exercise, set_num: setNum } });
  }
  logWorkoutSession(req: WorkoutSessionLogRequest): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/workout/sessions`, req);
  }
  getWorkoutProgress(weekMin?: number, weekMax?: number): Observable<WorkoutProgress> {
    const params: Record<string, number> = {};
    if (weekMin != null) params['week_min'] = weekMin;
    if (weekMax != null) params['week_max'] = weekMax;
    return this.http.get<WorkoutProgress>(`${this.base}/workout/progress`, { params });
  }

  // --- workout: Phase 2 (plan editing, cache browsing, ExerciseDB) ---
  updateWorkoutPlanExercise(planId: string, req: WorkoutPlanUpdateRequest):
    Observable<{ exercise: PlanExercise }> {
    return this.http.put<{ exercise: PlanExercise }>(
      `${this.base}/workout/plan/${planId}`, req);
  }
  cloneWorkoutDay(req: CloneDayRequest): Observable<CloneResult> {
    return this.http.post<CloneResult>(`${this.base}/workout/plan/clone-day`, req);
  }
  cloneWorkoutWeek(req: CloneWeekRequest): Observable<CloneResult> {
    return this.http.post<CloneResult>(`${this.base}/workout/plan/clone-week`, req);
  }
  getExerciseCacheOptions(): Observable<ExerciseCacheOptions> {
    return this.http.get<ExerciseCacheOptions>(`${this.base}/workout/exercise-cache/options`);
  }
  searchExerciseCache(filters: ExerciseCacheFilters): Observable<ExerciseCacheSearchResult> {
    return this.http.post<ExerciseCacheSearchResult>(
      `${this.base}/workout/exercise-cache/search`, filters);
  }
  saveCustomExercise(planId: string, req: CustomExerciseRequest):
    Observable<{ exercise: PlanExercise }> {
    return this.http.post<{ exercise: PlanExercise }>(
      `${this.base}/workout/plan/${planId}/custom-exercise`, req);
  }
  searchWorkoutExercises(q: string): Observable<{ results: ExerciseSearchResultItem[] }> {
    return this.http.get<{ results: ExerciseSearchResultItem[] }>(
      `${this.base}/workout/exercises/search`, { params: { q } });
  }
  getWorkoutExerciseDetails(exerciseId: string): Observable<ExerciseDetails> {
    return this.http.get<ExerciseDetails>(
      `${this.base}/workout/exercises/${encodeURIComponent(exerciseId)}`);
  }
  swapWorkoutExercise(planId: string, newExerciseId: string):
    Observable<{ exercise: PlanExercise }> {
    return this.http.put<{ exercise: PlanExercise }>(
      `${this.base}/workout/plan/${planId}/exercise-selection`,
      { new_exercise_id: newExerciseId });
  }
}
