import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AdminUser } from './models';

/** App-Admin-only screen: add allowed-user emails and toggle their
 * isAiAdmin/isAppAdmin roles. Opened from the profile panel's "Admin"
 * button — that button is itself gated on isAppAdmin, so reaching this
 * component at all already implies the caller has access; the backend
 * re-checks independently on every call regardless.
 *
 * Renders its own backdrop/slide-panel on top of the profile panel behind
 * it (same fixed-position classes, later in the DOM so it paints over). */
@Component({
  selector: 'app-admin-users-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="slide-panel-backdrop" (click)="closed.emit()"></div>
    <div class="slide-panel">
      <button class="slide-panel-close" (click)="closed.emit()" aria-label="Close">✕</button>
      <h3>Admin: users &amp; roles</h3>
      <p class="muted" style="margin-top:-8px">
        App Admin can add users and grant roles. AI Admin can edit AI system prompts.
      </p>

      @if (loading) {
        <p class="muted">Loading…</p>
      } @else {
        @for (u of users; track u.email) {
          <div class="row spread" style="padding:10px 0;border-top:1px solid var(--border);gap:8px">
            <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              {{ u.email }}
            </div>
            <label class="row" style="gap:4px;align-items:center;white-space:nowrap">
              <input type="checkbox" [checked]="u.isAiAdmin"
                (change)="toggleRole(u, 'isAiAdmin', $event)" />
              <span class="muted" style="font-size:12px">AI Admin</span>
            </label>
            <label class="row" style="gap:4px;align-items:center;white-space:nowrap">
              <input type="checkbox" [checked]="u.isAppAdmin"
                [disabled]="isSelf(u) && u.isAppAdmin"
                (change)="toggleRole(u, 'isAppAdmin', $event)" />
              <span class="muted" style="font-size:12px">App Admin</span>
            </label>
            <button class="ghost" style="font-size:12px;padding:2px 8px" (click)="revokeNotifications(u)">
              Revoke notifications
            </button>
          </div>
        }
      }

      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
        <label>Add user by email</label>
        <div class="row">
          <input [(ngModel)]="newEmail" placeholder="name@example.com" style="flex:1" />
          <button class="ghost" (click)="addUser()" [disabled]="!newEmail.trim()">Add</button>
        </div>
        <p class="muted">{{ status }}</p>
      </div>
    </div>
  `,
})
export class AdminUsersPanelComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  @Output() closed = new EventEmitter<void>();

  users: AdminUser[] = [];
  loading = false;
  newEmail = '';
  status = '';

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.api.listAdminUsers().subscribe((r) => {
      this.users = r.users;
      this.loading = false;
    });
  }

  isSelf(u: AdminUser): boolean {
    return u.email === this.auth.currentUser?.email;
  }

  toggleRole(u: AdminUser, role: 'isAiAdmin' | 'isAppAdmin', ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    const isAiAdmin = role === 'isAiAdmin' ? checked : u.isAiAdmin;
    const isAppAdmin = role === 'isAppAdmin' ? checked : u.isAppAdmin;
    this.api.setAdminUserRoles(u.email, isAiAdmin, isAppAdmin).subscribe((r) => (this.users = r.users));
  }

  revokeNotifications(u: AdminUser): void {
    if (!confirm(`Revoke all push notification devices for ${u.email}?`)) return;
    this.api.revokeUserDeviceTokens(u.email).subscribe({
      next: () => (this.status = `Revoked notifications for ${u.email}.`),
      error: () => (this.status = `Failed to revoke notifications for ${u.email}.`),
    });
  }

  addUser(): void {
    const email = this.newEmail.trim().toLowerCase();
    if (!email) return;
    this.api.addAdminUser(email).subscribe({
      next: (r) => {
        this.users = r.users;
        this.newEmail = '';
        this.status = `Added ${email}.`;
      },
      error: () => (this.status = 'Failed to add user.'),
    });
  }
}
