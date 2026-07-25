// Mirrors the FastAPI backend Pydantic models (app/models.py).

export interface Macros {
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar_g: number;
  fiber_g: number;
  sat_fat_g: number;
  sodium_mg: number;
}

export interface FoodItem {
  name: string;
  barcode?: string | null;
  per_serving: Macros;
  source: string; // off | chomp | cache | manual
  brand?: string | null;
  serving_size?: string | null; // human label, e.g. "15g" or "1 cup (240ml)"
  serving_qty_g?: number | null; // parsed grams, for scaling
  image_url?: string | null;
  nutrition_grade?: string | null; // e.g. Nutri-Score a-e
  category?: string | null; // id from core/categories.ts
}

export interface InventoryItem extends FoodItem {
  item_id?: string | null;
  qty: number; // servings remaining
  unit: string;
  location: string; // pantry | fridge | freezer
  initial_qty?: number | null; // servings at creation; never mutated after
}

export interface Goals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  target_weight_lb?: number | null;
  weekly_gain_lb?: number | null;
  phase: string;
  set_by: string;
}

export interface Profile {
  weight_lb: number;
  height_in: number;
  age: number;
  sex: string;
  activity_level: string;
  dietary_prefs: string[];
  allergies: string[];
}

export interface TodaySummary {
  date: string;
  consumed: Macros;
  remaining: Macros;
  meals_logged: number;
  pct_to_goal: number;
  goals?: Goals | null;
  coach_tip?: string | null;
}

export interface LogRequest {
  meal: string;
  item_name: string;
  barcode?: string | null;
  source?: string;
  servings: number;
  macros: Macros;
  from_inventory?: boolean;
  inventory_item_id?: string | null;
}

export interface CoachMessage {
  text: string;
  type: string;
  created_at: string;
  read?: boolean;
}
