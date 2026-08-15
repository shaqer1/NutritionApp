import { Injectable, signal } from '@angular/core';

export interface HamburgerOverride {
  icon: string;
  label: string;
  action: () => void;
}

/** Open/close state for the hamburger-triggered slide panel. The header
 * button (app.component.ts) lives outside the page whose content should
 * show — each page (Groceries/Recipes/Coach/Workout) renders its own panel
 * content gated on `open()`, so only the active route's content ever appears.
 *
 * Some pages (Inventory, Overview) repurpose the header button entirely
 * instead of using the AI-prompt panel — they set `override` in ngOnInit and
 * clear it in ngOnDestroy, swapping the button's icon/label and making
 * `toggle()` call their own action instead of opening the generic panel. */
@Injectable({ providedIn: 'root' })
export class HamburgerMenuService {
  open = signal(false);
  override = signal<HamburgerOverride | null>(null);

  toggle(): void {
    const o = this.override();
    if (o) {
      o.action();
      return;
    }
    this.open.set(!this.open());
  }

  close(): void {
    this.open.set(false);
  }
}
