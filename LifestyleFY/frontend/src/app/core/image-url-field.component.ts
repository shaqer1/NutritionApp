import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Image URL text input + inline preview thumbnail, reused everywhere an
 * "Image URL" field exists (Inventory manual entry/edit, Recipes, custom
 * exercises). The <img> load/error events are the actual URL validation —
 * simpler and more accurate than regex-checking the string, since it catches
 * everything that actually matters (typos, dead links, non-image URLs)
 * without false-flagging a technically-odd-looking but working URL. */
@Component({
  selector: 'app-image-url-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <input [ngModel]="value || ''" (ngModelChange)="onChange($event)" [placeholder]="placeholder" />
    @if (value) {
      <div class="row" style="align-items:center;gap:8px;margin-top:6px">
        @if (!loadError) {
          <img [src]="value" alt="" class="thumb" style="width:44px;height:44px;object-fit:cover"
            (load)="loadError = false" (error)="loadError = true" />
          <a [href]="value" target="_blank" rel="noopener noreferrer" class="muted" style="font-size:13px">
            Preview full image ↗
          </a>
        } @else {
          <div class="thumb" style="width:44px;height:44px;font-size:18px">⚠️</div>
          <span class="muted" style="font-size:13px;color:var(--accent)">
            Couldn't load this image — check the URL
          </span>
        }
      </div>
    }
  `,
})
export class ImageUrlFieldComponent {
  @Input() value: string | null | undefined = '';
  @Input() placeholder = 'https://...';
  @Output() valueChange = new EventEmitter<string>();

  loadError = false;

  onChange(v: string): void {
    this.loadError = false; // reset so a corrected URL gets a fresh load attempt
    this.valueChange.emit(v);
  }
}
