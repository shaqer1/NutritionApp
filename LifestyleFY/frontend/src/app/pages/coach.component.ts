import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../core/api.service';
import { CoachMessage } from '../core/models';

@Component({
  selector: 'app-coach',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>Coach</h1>

    <div class="card blue">
      <h3>Ask the coach</h3>
      <div class="row" style="flex-wrap:wrap">
        <button (click)="check()">Am I on track?</button>
        <button class="ghost" (click)="getRecipes()">Recipe ideas</button>
        <button class="ghost" (click)="getGrocery()">Grocery list</button>
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
  status = '';
  output = '';
  messages: CoachMessage[] = [];

  ngOnInit(): void { this.loadMessages(); }

  loadMessages(): void {
    this.api.coachMessages().subscribe((r) => (this.messages = r.messages));
  }

  check(): void {
    this.status = 'Checking…';
    this.api.runCoach('dinner', 'now').subscribe((r) => {
      this.status = r.on_track ? "You're on track — keep it up! 💪" : '';
      this.output = r.nudge ?? '';
      this.loadMessages();
    });
  }

  getRecipes(): void {
    this.status = 'Thinking up recipes…';
    this.api.recipes().subscribe((r) => { this.output = r.recipes; this.status = ''; });
  }

  getGrocery(): void {
    this.status = 'Building your grocery list…';
    this.api.grocery(7).subscribe((r) => { this.output = r.grocery_list; this.status = ''; });
  }
}
