import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AiPromptPreview, AiPrompts } from './models';

export type AiPromptCategory = 'nudge' | 'recipe' | 'grocery' | 'workout';

/** "What's actually being sent to the AI" content, reused across Coach
 * (nudge), Recipes, Groceries and Workout — shown inside each page's hamburger-menu
 * slide panel. Show/hide is the parent's job (gated on HamburgerMenuService);
 * this component just fetches a fresh preview whenever it's instantiated,
 * i.e. every time the panel opens, matching the transparency purpose of the
 * panel — no caching across opens. */
@Component({
  selector: 'app-ai-prompt-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h3>AI prompt preview</h3>
    @if (loading) {
      <p class="muted">Loading preview…</p>
    } @else if (preview) {
      <label>Generic prompt</label>
      <pre class="ai">{{ preview.generic }}</pre>
      <label>Live context (right now)</label>
      <pre class="ai">{{ preview.context }}</pre>
    }
    <label>Your standing note <span class="muted">(always appended)</span></label>
    <textarea [(ngModel)]="customNote" rows="2"
      style="width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);
             border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="ghost" (click)="save()">Save note</button>
      <span class="muted">{{ saveStatus }}</span>
    </div>
  `,
})
export class AiPromptPanelComponent implements OnInit {
  private api = inject(ApiService);

  @Input({ required: true }) category!: AiPromptCategory;
  @Input({ required: true }) fetchPreview!: () => Observable<AiPromptPreview>;

  loading = false;
  preview?: AiPromptPreview;
  customNote = '';
  saveStatus = '';

  ngOnInit(): void {
    this.loading = true;
    this.fetchPreview().subscribe((r) => {
      this.preview = r;
      this.customNote = r.custom_note;
      this.loading = false;
    });
  }

  save(): void {
    this.api.getAiPrompts().subscribe((r) => {
      const prompts: AiPrompts = { ...r.prompts, [this.category]: this.customNote };
      this.api.setAiPrompts(prompts).subscribe(() => (this.saveStatus = 'Saved.'));
    });
  }
}
