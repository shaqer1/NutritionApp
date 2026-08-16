import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AiPromptPreview, AiPrompts, SystemPrompts } from './models';

export type AiPromptCategory = 'nudge' | 'recipe' | 'grocery' | 'workout';

/** Placeholder tokens like {Recent_workouts}/{Pantry_items}/{Workout_context}
 * are display stand-ins for data substituted in right before the real
 * generate call (see the *_prompt_parts() comments in coach.py) — highlight
 * them so it's obvious they aren't literal prompt text. */
function highlightPlaceholders(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\{[A-Za-z_]+\}/g, (m) => `<span class="prompt-placeholder">${m}</span>`);
}

const TEXTAREA_STYLE = 'width:100%;background:#14141c;color:var(--text);border:1px solid var(--border);'
  + 'border-radius:10px;padding:10px 12px;font-size:15px;font-family:inherit';

/** "What's actually being sent to the AI" content, reused across Coach
 * (nudge), Recipes, Groceries and Workout — shown inside each page's hamburger-menu
 * slide panel. Show/hide is the parent's job (gated on HamburgerMenuService);
 * this component just fetches a fresh preview whenever it's instantiated,
 * i.e. every time the panel opens, matching the transparency purpose of the
 * panel — no caching across opens.
 *
 * Two separately editable layers, per category:
 * - Standing note: per-user preference, appended on every call. Editable by
 *   anyone (it's their own note).
 * - System prompt (the "Generic prompt" block): the shared base instruction
 *   template every user's calls build on. Gated to isAiAdmin/isAppAdmin
 *   (config/access Firestore doc) — everyone else sees it read-only. */
@Component({
  selector: 'app-ai-prompt-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h3>AI prompt preview</h3>
    @if (loading) {
      <p class="muted">Loading preview…</p>
    } @else if (preview) {
      <label>Generic prompt <span class="muted">(shared, admin-editable)</span></label>
      @if (canEditSystem) {
        <textarea [(ngModel)]="systemPromptDraft" rows="4" [style]="TEXTAREA_STYLE"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="ghost" (click)="saveSystemPrompt()">Save system prompt</button>
          <span class="muted">{{ systemSaveStatus }}</span>
        </div>
      } @else {
        <pre class="ai" [innerHTML]="highlight(preview.generic)"></pre>
      }
      <label style="margin-top:12px;display:block">Live context (right now)</label>
      <pre class="ai" [innerHTML]="highlight(preview.context)"></pre>
    }
    <label>Standing note <span class="muted">(your own, always appended)</span></label>
    <textarea [(ngModel)]="customNote" rows="2" [style]="TEXTAREA_STYLE"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="ghost" (click)="save()">Save note</button>
      <span class="muted">{{ saveStatus }}</span>
    </div>
  `,
})
export class AiPromptPanelComponent implements OnInit {
  private api = inject(ApiService);
  protected readonly TEXTAREA_STYLE = TEXTAREA_STYLE;

  @Input({ required: true }) category!: AiPromptCategory;
  @Input({ required: true }) fetchPreview!: () => Observable<AiPromptPreview>;

  loading = false;
  preview?: AiPromptPreview;
  customNote = '';
  saveStatus = '';
  canEditSystem = false;
  systemPromptDraft = '';
  systemSaveStatus = '';

  ngOnInit(): void {
    this.loading = true;
    this.fetchPreview().subscribe((r) => {
      this.preview = r;
      this.customNote = r.custom_note;
      this.systemPromptDraft = r.generic;
      this.loading = false;
    });
    this.api.getAiSystemPrompts().subscribe((r) => {
      this.canEditSystem = r.roles.isAiAdmin || r.roles.isAppAdmin;
    });
  }

  highlight(text: string): string {
    return highlightPlaceholders(text);
  }

  save(): void {
    this.api.getAiPrompts().subscribe((r) => {
      const prompts: AiPrompts = { ...r.prompts, [this.category]: this.customNote };
      this.api.setAiPrompts(prompts).subscribe(() => (this.saveStatus = 'Saved.'));
    });
  }

  saveSystemPrompt(): void {
    this.api.getAiSystemPrompts().subscribe((r) => {
      const prompts: SystemPrompts = { ...r.prompts, [this.category]: this.systemPromptDraft };
      this.api.setAiSystemPrompts(prompts).subscribe(() => (this.systemSaveStatus = 'Saved.'));
    });
  }
}
