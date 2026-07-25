// Mirrors the backend pantry category taxonomy (app/services/categories.py).

export type Location = 'pantry' | 'fridge' | 'freezer';

export interface CategoryMeta {
  id: string;
  label: string;
  emoji: string;
  defaultLocation: Location;
}

export const APP_CATEGORIES: CategoryMeta[] = [
  { id: 'produce', label: 'Produce', emoji: '🥦', defaultLocation: 'fridge' },
  { id: 'dairy', label: 'Dairy', emoji: '🥛', defaultLocation: 'fridge' },
  { id: 'meat', label: 'Meat & Seafood', emoji: '🍗', defaultLocation: 'fridge' },
  { id: 'frozen', label: 'Frozen', emoji: '🧊', defaultLocation: 'freezer' },
  { id: 'grains', label: 'Grains & Bread', emoji: '🍞', defaultLocation: 'pantry' },
  { id: 'snacks', label: 'Snacks', emoji: '🍿', defaultLocation: 'pantry' },
  { id: 'sweets', label: 'Sweets & Desserts', emoji: '🍫', defaultLocation: 'pantry' },
  { id: 'beverages', label: 'Beverages', emoji: '🥤', defaultLocation: 'pantry' },
  { id: 'condiments', label: 'Condiments & Sauces', emoji: '🧂', defaultLocation: 'pantry' },
  { id: 'canned', label: 'Canned & Jarred', emoji: '🥫', defaultLocation: 'pantry' },
  { id: 'other', label: 'Other', emoji: '🧺', defaultLocation: 'pantry' },
];

const OTHER = APP_CATEGORIES[APP_CATEGORIES.length - 1];
const BY_ID = new Map(APP_CATEGORIES.map((c) => [c.id, c]));

export function categoryMeta(id: string | null | undefined): CategoryMeta {
  return (id && BY_ID.get(id)) || OTHER;
}

export function defaultLocation(categoryId: string | null | undefined): Location {
  return categoryMeta(categoryId).defaultLocation;
}

export const LOCATIONS: { id: Location; label: string }[] = [
  { id: 'pantry', label: 'Pantry' },
  { id: 'fridge', label: 'Fridge' },
  { id: 'freezer', label: 'Freezer' },
];
