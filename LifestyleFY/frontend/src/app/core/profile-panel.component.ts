import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { clearLocalAppData } from './local-data';
import { Profile } from './models';

/** Header's profile slide panel: signed-in user identity + the profile form
 * that used to live inline on the Coach page. "Suggest bulking goals" lives
 * on the Coach page's Current goal card instead — the backend reads whatever
 * profile is already saved, so it doesn't need this form's live state. */
@Component({
  selector: 'app-profile-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="slide-panel-backdrop" (click)="closed.emit()"></div>
    <div class="slide-panel">
      <button class="slide-panel-close" (click)="closed.emit()" aria-label="Close">✕</button>

      <div class="row" style="align-items:center;gap:12px;margin-bottom:16px">
        @if (auth.currentUser?.photoURL) {
          <img [src]="auth.currentUser?.photoURL" alt=""
            style="width:48px;height:48px;border-radius:50%;object-fit:cover" />
        } @else {
          <div class="thumb" style="width:48px;height:48px;border-radius:50%;font-size:22px">👤</div>
        }
        <div style="flex:1">
          <div style="font-weight:700">{{ auth.currentUser?.displayName || 'You' }}</div>
          <div class="muted">{{ auth.currentUser?.email }}</div>
        </div>
        <button class="ghost" style="padding:8px 12px;font-size:13px" (click)="signOut()">Sign out</button>
      </div>

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
      </div>
      <p class="muted">{{ profileStatus }}</p>
    </div>
  `,
})
export class ProfilePanelComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);

  @Output() closed = new EventEmitter<void>();

  profileStatus = '';
  profile: Profile = {
    weight_lb: 120, height_in: 70, age: 30, sex: 'male',
    activity_level: 'moderate', dietary_prefs: ['high-protein'], allergies: [],
  };

  // Plain text fields, only synced with profile.dietary_prefs/allergies on
  // load and just before save — NOT a live getter/setter, since re-deriving
  // the array (and rejoining) on every keystroke would eat the trailing
  // ", " the user just typed and make it impossible to enter a second item.
  dietaryPrefsText = '';
  allergiesText = '';

  ngOnInit(): void {
    this.api.getProfile().subscribe((r) => {
      if (r.profile) this.profile = r.profile;
      this.dietaryPrefsText = this.profile.dietary_prefs.join(', ');
      this.allergiesText = this.profile.allergies.join(', ');
    });
  }

  private syncProfileFromText(): void {
    this.profile.dietary_prefs = this.dietaryPrefsText.split(',').map((s) => s.trim()).filter(Boolean);
    this.profile.allergies = this.allergiesText.split(',').map((s) => s.trim()).filter(Boolean);
  }

  saveProfile(): void {
    this.syncProfileFromText();
    this.api.setProfile(this.profile).subscribe(() => (this.profileStatus = 'Profile saved.'));
  }

  /** Full sign-out: Firebase session + service worker/caches/IndexedDB, so a
   * later sign-in (same account or a different one) starts from a clean
   * slate rather than picking up any stale local state. */
  async signOut(): Promise<void> {
    try {
      await this.auth.signOut();
      await clearLocalAppData();
    } finally {
      window.location.reload();
    }
  }
}
