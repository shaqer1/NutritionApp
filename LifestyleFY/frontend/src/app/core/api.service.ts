import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CoachMessage, FoodItem, Goals, InventoryItem, LogRequest, Profile, TodaySummary,
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
  today(): Observable<TodaySummary> {
    return this.http.get<TodaySummary>(`${this.base}/today`);
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

  // --- AI ---
  recipes(): Observable<{ recipes: string }> {
    return this.http.post<{ recipes: string }>(`${this.base}/recipes`, {});
  }
  grocery(days = 7): Observable<{ grocery_list: string }> {
    return this.http.post<{ grocery_list: string }>(`${this.base}/grocery`, { days });
  }
  runCoach(meal = 'dinner', timeLabel = 'evening'):
    Observable<{ nudge: string | null; on_track: boolean }> {
    return this.http.post<{ nudge: string | null; on_track: boolean }>(
      `${this.base}/coach`, { meal, time_label: timeLabel });
  }
  coachMessages(): Observable<{ messages: CoachMessage[] }> {
    return this.http.get<{ messages: CoachMessage[] }>(`${this.base}/coach/messages`);
  }
}
