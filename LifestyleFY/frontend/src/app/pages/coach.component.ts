import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AiPromptPanelComponent } from '../core/ai-prompt-panel.component';
import { GoalsService } from '../core/goals.service';
import { HamburgerMenuService } from '../core/hamburger-menu.service';
import { CoachMessage, Goals } from '../core/models';
import { currentMealType, currentTimeLabel, todayStr } from '../core/meal-picker';

@Component({
  selector: 'app-coach',
  standalone: true,
  imports: [CommonModule, FormsModule, AiPromptPanelComponent],
  template: `
    @if (hamburger.open()) {
      <div class="slide-panel-backdrop" (click)="hamburger.close()"></div>
      <div class="slide-panel">
        <button class="slide-panel-close" (click)="hamburger.close()" aria-label="Close">✕</button>
        <app-ai-prompt-panel category="nudge" [fetchPreview]="previewNudge" />
      </div>
    }

    <div class="card green">
      <h3>Current goal</h3>
      @if (goals) {
        <div class="row spread"><span class="muted">{{ goals.phase }} · {{ goals.set_by }}</span></div>
        <div class="row spread"><span>Calories</span><b>{{ goals.calories | number:'1.0-0' }} kcal</b></div>
        <div class="row spread"><span>Protein</span><b>{{ goals.protein_g | number:'1.0-0' }} g</b></div>
        <div class="row spread"><span>Carbs</span><b>{{ goals.carbs_g | number:'1.0-0' }} g</b></div>
        <div class="row spread"><span>Fat</span><b>{{ goals.fat_g | number:'1.0-0' }} g</b></div>
        @if (goals.target_weight_lb) {
          <div class="row spread"><span>Target weight</span>
            <b>{{ goals.target_weight_lb }} lb (+{{ goals.weekly_gain_lb }}/wk)</b></div>
        }
        <div style="margin-top:12px" class="row">
          <button class="ghost" (click)="advance()">Reached it → next goal</button>
          <button class="green" (click)="suggestGoals()">Suggest bulking goals →</button>
        </div>
      } @else {
        <p class="muted">No goals set yet — set your profile via the icon above, then:</p>
        <button class="green" (click)="suggestGoals()">Suggest bulking goals →</button>
      }
      <p class="muted">{{ goalStatus }}</p>
    </div>

    <div class="card blue">
      <h3>Ask the coach</h3>
      <label>Ask something specific <span class="muted">(sent with this request only)</span></label>
      <textarea [(ngModel)]="message" rows="2" placeholder="e.g. I feel like tacos, what should I eat?"
        style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
               border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>
      <div style="margin-top:8px">
        <button (click)="check()">Am I on track?</button>
      </div>
      <p class="muted">{{ status }}</p>
    </div>

    @if (output) {
      <div class="card">
        <pre class="ai">{{ output }}</pre>
      </div>
    }

    @if (messages.length) {
      <div class="card">
        <h3>Recent nudges</h3>
        @for (m of messages; track m.created_at) {
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div>{{ m.text }}</div>
            <div class="muted">{{ m.type }} · {{ m.created_at | date:'short' }}</div>
          </div>
        }
      </div>
    }
  `,
})
export class CoachComponent implements OnInit {
  private api = inject(ApiService);
  private goalsService = inject(GoalsService);
  hamburger = inject(HamburgerMenuService);

  goals?: Goals;
  goalStatus = '';

  status = '';
  output = '';
  message = '';
  messages: CoachMessage[] = [];

  previewNudge = () => this.api.coachPreview(currentMealType(), currentTimeLabel(), todayStr());

  ngOnInit(): void {
    this.goalsService.goals$.subscribe((g) => (this.goals = g));
    this.goalsService.refresh();
    this.loadMessages();
  }

  loadMessages(): void {
    this.api.coachMessages().subscribe((r) => (this.messages = r.messages));
  }

  advance(): void {
    this.api.nextGoal().subscribe((r) => {
      this.goalsService.set(r.goals);
      this.goalStatus = 'Advanced to your next goal.';
    });
  }

  suggestGoals(): void {
    this.api.suggestGoals('bulk').subscribe({
      next: (r) => {
        this.goalsService.set(r.goals);
        this.goalStatus = 'Goals generated from your stats.';
      },
      error: () => (this.goalStatus = 'Set your profile first (tap the icon above).'),
    });
  }

  check(): void {
    this.status = 'Checking…';
    this.api.runCoach(currentMealType(), currentTimeLabel(), todayStr(), this.message).subscribe((r) => {
      this.status = r.on_track ? "You're on track — keep it up! 💪" : '';
      this.output = r.nudge ?? '';
      this.message = '';
      this.loadMessages();
    });
  }
}
