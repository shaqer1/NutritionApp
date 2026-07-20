import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Goals, Profile } from '../core/models';

@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>Goals</h1>

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
      <div style="margin-top:12px" class="row">
        <button (click)="saveProfile()">Save profile</button>
        <button class="green" (click)="suggest()">Suggest bulking goals →</button>
      </div>
      <p class="muted">{{ status }}</p>
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
  `,
})
export class GoalsComponent implements OnInit {
  private api = inject(ApiService);
  status = '';
  profile: Profile = {
    weight_lb: 120, height_in: 70, age: 30, sex: 'male',
    activity_level: 'moderate', dietary_prefs: ['high-protein'], allergies: [],
  };
  goals?: Goals;

  ngOnInit(): void {
    this.api.getProfile().subscribe((r) => { if (r.profile) this.profile = r.profile; });
    this.api.getGoals().subscribe((r) => { if (r.goals) this.goals = r.goals; });
  }

  saveProfile(): void {
    this.api.setProfile(this.profile).subscribe(() => (this.status = 'Profile saved.'));
  }

  suggest(): void {
    this.api.setProfile(this.profile).subscribe(() =>
      this.api.suggestGoals('bulk').subscribe((r) => {
        this.goals = r.goals;
        this.status = 'Goals generated from your stats.';
      }));
  }

  advance(): void {
    this.api.nextGoal().subscribe((r) => {
      this.goals = r.goals;
      this.status = 'Advanced to your next goal.';
    });
  }
}
