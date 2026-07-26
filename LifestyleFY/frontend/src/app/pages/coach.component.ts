import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AiPromptPanelComponent } from '../core/ai-prompt-panel.component';
import { CoachMessage, Goals, Profile } from '../core/models';
import { currentMealType, currentTimeLabel, todayStr } from '../core/meal-picker';

@Component({
  selector: 'app-coach',
  standalone: true,
  imports: [CommonModule, FormsModule, AiPromptPanelComponent],
  template: `
    <h1>Coach</h1>

    <div class="card">
      <h3>Your profile</h3>
      <div class="row">
        <div style="flex:1"><label>Weight (lb)</label>
          <input type="number" [(ngModel)]="profile.weight_lb" /></div>
        <div style="flex:1"><label>Height (in)</label>
          <input type="number" [(ngModel)]="profile.height_in" /></div>
        <div style="flex:1"><label>Age</label>
          <input type="number" [(ngModel)]="profile.age" /></div>
      </div>
      <label>Activity level</label>
      <select [(ngModel)]="profile.activity_level">
        <option value="sedentary">Sedentary</option>
        <option value="light">Light</option>
        <option value="moderate">Moderate</option>
        <option value="active">Active</option>
        <option value="very_active">Very active</option>
      </select>
      <label>Sex <span class="muted">(used for calorie/macro math)</span></label>
      <select [(ngModel)]="profile.sex">
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
      <label>Dietary prefs <span class="muted">(comma-separated)</span></label>
      <input [(ngModel)]="dietaryPrefsText" placeholder="e.g. high-protein, low-carb" />
      <label>Allergies <span class="muted">(comma-separated — the AI will avoid these)</span></label>
      <input [(ngModel)]="allergiesText" placeholder="e.g. peanuts, shellfish" />
      <div style="margin-top:12px" class="row">
        <button (click)="saveProfile()">Save profile</button>
        <button class="green" (click)="suggest()">Suggest bulking goals →</button>
      </div>
      <p class="muted">{{ profileStatus }}</p>
    </div>

    @if (goals) {
      <div class="card green">
        <div class="row spread"><h3>Current goal</h3>
          <span class="muted">{{ goals.phase }} · {{ goals.set_by }}</span></div>
        <div class="row spread"><span>Calories</span><b>{{ goals.calories | number:'1.0-0' }} kcal</b></div>
        <div class="row spread"><span>Protein</span><b>{{ goals.protein_g | number:'1.0-0' }} g</b></div>
        <div class="row spread"><span>Carbs</span><b>{{ goals.carbs_g | number:'1.0-0' }} g</b></div>
        <div class="row spread"><span>Fat</span><b>{{ goals.fat_g | number:'1.0-0' }} g</b></div>
        @if (goals.target_weight_lb) {
          <div class="row spread"><span>Target weight</span>
            <b>{{ goals.target_weight_lb }} lb (+{{ goals.weekly_gain_lb }}/wk)</b></div>
        }
        <div style="margin-top:12px">
          <button class="ghost" (click)="advance()">Reached it → next goal</button>
        </div>
      </div>
    }

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

    <app-ai-prompt-panel category="nudge" [fetchPreview]="previewNudge" />

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

  profileStatus = '';
  profile: Profile = {
    weight_lb: 120, height_in: 70, age: 30, sex: 'male',
    activity_level: 'moderate', dietary_prefs: ['high-protein'], allergies: [],
  };
  goals?: Goals;

  // Plain text fields, only synced with profile.dietary_prefs/allergies on
  // load and just before save — NOT a live getter/setter, since re-deriving
  // the array (and rejoining) on every keystroke would eat the trailing
  // ", " the user just typed and make it impossible to enter a second item.
  dietaryPrefsText = '';
  allergiesText = '';

  status = '';
  output = '';
  message = '';
  messages: CoachMessage[] = [];

  previewNudge = () => this.api.coachPreview(currentMealType(), currentTimeLabel(), todayStr());

  ngOnInit(): void {
    this.api.getProfile().subscribe((r) => {
      if (r.profile) this.profile = r.profile;
      this.dietaryPrefsText = this.profile.dietary_prefs.join(', ');
      this.allergiesText = this.profile.allergies.join(', ');
    });
    this.api.getGoals().subscribe((r) => { if (r.goals) this.goals = r.goals; });
    this.loadMessages();
  }

  private syncProfileFromText(): void {
    this.profile.dietary_prefs = this.dietaryPrefsText.split(',').map((s) => s.trim()).filter(Boolean);
    this.profile.allergies = this.allergiesText.split(',').map((s) => s.trim()).filter(Boolean);
  }

  loadMessages(): void {
    this.api.coachMessages().subscribe((r) => (this.messages = r.messages));
  }

  saveProfile(): void {
    this.syncProfileFromText();
    this.api.setProfile(this.profile).subscribe(() => (this.profileStatus = 'Profile saved.'));
  }

  suggest(): void {
    this.syncProfileFromText();
    this.api.setProfile(this.profile).subscribe(() =>
      this.api.suggestGoals('bulk').subscribe((r) => {
        this.goals = r.goals;
        this.profileStatus = 'Goals generated from your stats.';
      }));
  }

  advance(): void {
    this.api.nextGoal().subscribe((r) => {
      this.goals = r.goals;
      this.profileStatus = 'Advanced to your next goal.';
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
