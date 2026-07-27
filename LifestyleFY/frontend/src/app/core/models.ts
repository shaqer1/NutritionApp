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
  serving_size?: string | null; // raw human label, e.g. "1 bar (40 g)"
  serving_size_qty?: number | null; // informational: leading qty before "(", e.g. 1 in "1 bar (40 g)" — NOT used in calcs
  serving_size_unit?: string | null; // informational: leading unit/word before "(", e.g. "bar"
  serving_qty?: number | null; // calc quantity per serving, any unit — drives grams/decrement math
  serving_unit?: string | null; // calc unit, e.g. "g", "ml"
  serving_qty_g?: number | null; // grams-only convenience; set only when serving_unit === "g"
  macros_basis?: string | null; // "serving" | "100g" | null — which basis per_serving actually used
  image_url?: string | null;
  nutrition_grade?: string | null; // e.g. Nutri-Score a-e
  category?: string | null; // id from core/categories.ts
  ingredients_text?: string | null; // free-text ingredient list
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

export interface AiPrompts {
  nudge: string;
  recipe: string;
  grocery: string;
}

export interface AiPromptPreview {
  generic: string;
  context: string;
  custom_note: string;
}

export interface LogRequest {
  meal: string;
  meal_instance?: number; // distinguishes separate sittings, e.g. "Lunch 2"
  item_name: string;
  barcode?: string | null;
  source?: string;
  servings: number;
  macros: Macros;
  from_inventory?: boolean;
  inventory_item_id?: string | null;
  grams?: number | null; // actual grams consumed, computed client-side
  log_date?: string | null; // client's local calendar day (YYYY-MM-DD)
}

export interface LogEntry {
  log_id?: string | null; // addresses this row for updateLog/deleteLog
  item_name: string;
  barcode?: string | null;
  meal: string;
  meal_instance: number;
  servings: number;
  macros: Macros; // totals for this entry (already scaled by servings)
  grams?: number | null;
  ts: string;
}

export interface CoachMessage {
  text: string;
  type: string;
  created_at: string;
  read?: boolean;
}

export interface RecipeIngredient {
  item_id?: string | null; // pantry Ingredient reference, if matched
  name: string;
  quantity: number;
  unit: string;
  macros: Macros; // snapshot, for this quantity
}

export interface Recipe {
  recipe_id?: string | null;
  name: string;
  servings: number;
  instructions: string;
  ingredients: RecipeIngredient[];
  source: string; // ai | manual
  image_url?: string | null;
  is_active?: boolean;
  created_at?: string | null;
}

export interface GroceryItem {
  name: string;
  quantity: string; // free text, e.g. "2 bunches"
  section: string; // id from core/categories.ts
  checked?: boolean;
}

export interface GrocerySwap {
  title: string;
  explanation: string;
}

export interface GroceryList {
  grocery_list_id?: string | null;
  name: string;
  days: number;
  items: GroceryItem[];
  swaps: GrocerySwap[];
  source: string; // ai | manual
  is_active?: boolean;
  created_at?: string | null;
}
