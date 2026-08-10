import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { Goals } from './models';

/** Shared goals state so the Coach page's "Current goal" card stays in sync
 * when goals are changed from the header's Profile panel (a different
 * component instance) without needing a page navigation to refetch. */
@Injectable({ providedIn: 'root' })
export class GoalsService {
  private api = inject(ApiService);
  private goalsSubject = new BehaviorSubject<Goals | undefined>(undefined);
  goals$ = this.goalsSubject.asObservable();

  refresh(): void {
    this.api.getGoals().subscribe((r) => this.goalsSubject.next(r.goals ?? undefined));
  }

  set(goals: Goals): void {
    this.goalsSubject.next(goals);
  }
}
