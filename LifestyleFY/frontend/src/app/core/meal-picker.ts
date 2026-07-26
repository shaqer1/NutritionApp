// Shared meal-instance picker logic, used by both the Add/Scan flow
// (inventory.component.ts) and the item detail page (inventory-item.component.ts).
import { LogEntry } from './models';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

export function mealLabel(mealType: string, instance: number): string {
  return `${mealType.charAt(0).toUpperCase()}${mealType.slice(1)} ${instance}`;
}

export function existingInstances(entries: LogEntry[], mealType: string): number[] {
  const nums = entries.filter((e) => e.meal === mealType).map((e) => e.meal_instance);
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function nextInstance(entries: LogEntry[], mealType: string): number {
  const existing = existingInstances(entries, mealType);
  return existing.length ? Math.max(...existing) + 1 : 1;
}

/** Client's local calendar day as YYYY-MM-DD. Always pass this explicitly to
 * GET /log for "today" — the backend's own default is UTC (matching how `ts`
 * is stored), which can silently disagree with the user's local "today" near
 * a midnight-UTC boundary. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Best-guess meal period from the client's local wall clock, used to default
 * the nudge/recipe AI context instead of a hardcoded meal name. */
export function currentMealType(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 21) return 'dinner';
  return 'snack';
}

/** Human-readable local time, e.g. "2:30 PM" — shown to the AI as context. */
export function currentTimeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
