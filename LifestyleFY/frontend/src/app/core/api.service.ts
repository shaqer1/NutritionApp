import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AiPromptPreview, AiPrompts, CoachMessage, FoodItem, Goals, GroceryList, InventoryItem,
  LogEntry, LogRequest, Profile, Recipe, TodaySummary,
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
}
