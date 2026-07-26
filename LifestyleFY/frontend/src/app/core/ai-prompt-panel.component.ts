import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AiPromptPreview, AiPrompts } from './models';

export type AiPromptCategory = 'nudge' | 'recipe' | 'grocery';

/** Collapsible "what's actually being sent to the AI" panel, reused across
 * Coach (nudge), Recipes and Groceries — the only 3x-repeated UI structure in
 * this feature. The live preview is fetched fresh every time the panel opens
 * (not cached), matching the transparency purpose of the panel. */
@Component({
  selector: 'app-ai-prompt-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <div class="row spread" style="cursor:pointer" (click)="toggle()">
        <h3>AI prompt preview</h3>
        <span class="muted">{{ open ? '▲' : '▼' }}</span>
      </div>
      @if (open) {
        <div style="margin-top:10px">
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
        </div>
      }
    </div>
  `,
})
export class AiPromptPanelComponent {
  private api = inject(ApiService);

  @Input({ required: true }) category!: AiPromptCategory;
  @Input({ required: true }) fetchPreview!: () => Observable<AiPromptPreview>;

  open = false;
  loading = false;
  preview?: AiPromptPreview;
  customNote = '';
  saveStatus = '';

  toggle(): void {
    this.open = !this.open;
    if (this.open) this.refresh();
  }

  private refresh(): void {
    this.loading = true;
    this.saveStatus = '';
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
