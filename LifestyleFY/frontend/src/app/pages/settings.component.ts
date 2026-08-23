import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { NotificationPrefs } from '../core/models';
import { PushNotificationsService } from '../core/push-notifications.service';

/** Notification preferences — everything defaults off; turning a toggle on
 * for the first time also requests browser push permission if needed. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <h2>Settings</h2>
      <h3>Notifications</h3>
      <p class="muted">All notifications are off by default — turn on what you want below.</p>

      <label class="row" style="gap:8px;align-items:center">
        <input type="checkbox" [(ngModel)]="prefs.coach_nudges" (change)="save()" />
        Coach nudges <span class="muted">(AI check-ins, same as the "Am I on track?" button)</span>
      </label>

      <h3 style="margin-top:20px">Meal reminders</h3>
      <p class="muted">A reminder only fires if you haven't logged that meal yet that day.</p>
      <label class="row" style="gap:8px;align-items:center">
        <input type="checkbox" [(ngModel)]="prefs.meals.breakfast" (change)="save()" />
        Breakfast <span class="muted">(~8am, your local time)</span>
      </label>
      <label class="row" style="gap:8px;align-items:center">
        <input type="checkbox" [(ngModel)]="prefs.meals.lunch" (change)="save()" />
        Lunch <span class="muted">(~12pm, your local time)</span>
      </label>
      <label class="row" style="gap:8px;align-items:center">
        <input type="checkbox" [(ngModel)]="prefs.meals.snack" (change)="save()" />
        Snack <span class="muted">(~4pm, your local time)</span>
      </label>
      <label class="row" style="gap:8px;align-items:center">
        <input type="checkbox" [(ngModel)]="prefs.meals.dinner" (change)="save()" />
        Dinner <span class="muted">(~8pm, your local time)</span>
      </label>

      <p class="muted" style="margin-top:12px">{{ status }}</p>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);
  private push = inject(PushNotificationsService);

  prefs: NotificationPrefs = {
    coach_nudges: false,
    meals: { breakfast: false, lunch: false, snack: false, dinner: false },
  };
  status = '';

  ngOnInit(): void {
    this.api.getNotificationPrefs().subscribe((r) => (this.prefs = r.prefs));
  }

  async save(): Promise<void> {
    const anyEnabled = this.prefs.coach_nudges || Object.values(this.prefs.meals).some(Boolean);
    if (anyEnabled) {
      const granted = await this.push.ensurePermissionAndToken();
      if (!granted) {
        this.status = 'Notifications need browser permission — allow it and try again.';
        return;
      }
    }
    this.api.setNotificationPrefs(this.prefs).subscribe({
      next: () => (this.status = 'Saved.'),
      error: () => (this.status = 'Failed to save.'),
    });
  }
}
