import { Injectable, signal } from '@angular/core';

/** Open/close state for the hamburger-triggered slide panel. The header
 * button (app.component.ts) lives outside the page whose content should
 * show — each page (Groceries/Recipes/Coach) renders its own panel content
 * gated on `open()`, so only the active route's content ever appears. */
@Injectable({ providedIn: 'root' })
export class HamburgerMenuService {
  open = signal(false);

  toggle(): void {
    this.open.set(!this.open());
  }

  close(): void {
    this.open.set(false);
  }
}
