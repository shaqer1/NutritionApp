// Mirrors the FastAPI backend Pydantic models (app/models.py).

export interface Macros {
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodItem {
  name: string;
  barcode?: string | null;
  per_serving: Macros;
  source: string; // off | chomp | cache | manual
}

export interface InventoryItem extends FoodItem {
  item_id?: string | null;
  qty: number;
  unit: string;
  category?: string | null;
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
}

export interface CoachMessage {
  text: string;
  type: string;
  created_at: string;
  read?: boolean;
}
