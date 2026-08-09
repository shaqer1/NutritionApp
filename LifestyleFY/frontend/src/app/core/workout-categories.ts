// Mirrors the exercise category taxonomy carried over from the old workout
// Apps Script app (Code.gs's EDIT_CATEGORIES).

export interface ExerciseCategoryMeta {
  id: string;
  label: string;
  emoji: string;
}

/** Icon for a logged session's energy_level ("high" | "medium" | "low") —
 * shared between the workout progress card and the Overview summary. */
export function energyIcon(level: string): string {
  if (level === 'high') return '🔥';
  if (level === 'low') return '😔';
  return '💪';
}

export const EXERCISE_CATEGORIES: ExerciseCategoryMeta[] = [
  { id: 'push', label: 'Push', emoji: '💪' },
  { id: 'pull', label: 'Pull', emoji: '🎣' },
  { id: 'legs', label: 'Legs', emoji: '🦵' },
  { id: 'arms', label: 'Arms', emoji: '💪' },
  { id: 'core', label: 'Core', emoji: '⚡' },
  { id: 'warmup', label: 'Warm-up', emoji: '🛡️' },
  { id: 'stretch', label: 'Stretch', emoji: '🧘' },
];

const OTHER: ExerciseCategoryMeta = { id: 'other', label: 'Other', emoji: '🏋️' };
const BY_ID = new Map(EXERCISE_CATEGORIES.map((c) => [c.id, c]));

export function exerciseCategoryMeta(id: string | null | undefined): ExerciseCategoryMeta {
  return (id && BY_ID.get(id)) || OTHER;
}
