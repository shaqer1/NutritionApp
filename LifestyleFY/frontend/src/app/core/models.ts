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
  workout: string;
}

export interface AiPromptPreview {
  generic: string;
  context: string;
  custom_note: string;
}

export interface Roles {
  isAiAdmin: boolean;
  isAppAdmin: boolean;
}

export interface SystemPrompts {
  nudge: string;
  recipe: string;
  grocery: string;
  workout: string;
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
  meal?: string; // breakfast | lunch | dinner | snack | '' (unset)
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

// --- Workout ---

export interface PlanExercise {
  plan_id?: string | null;
  week: number;
  day: string;
  phase: string;
  section: string; // Warm-Up | Strength | Cool-Down
  order: number;
  exercise: string;
  sets: string;
  reps: string;
  weight: string;
  tempo: string;
  rest: string;
  video_url: string;
  exercise_id?: string | null;
  notes: string;
  category: string; // id from core/workout-categories.ts
  is_custom?: boolean;
  // Joined in from the shared exercise cache at read time.
  image_url?: string | null;
  overview?: string | null;
  instructions: string[];
  target_muscles: string[];
  equipments: string[];
  exercise_tips: string[];
  variations: string[];
  related_exercise_ids: string[];
}

export interface WorkoutConfig {
  current_week: number;
  start_date?: string | null;
}

export interface WorkoutWeekOverview {
  days: string[];
  completed_days: string[];
}

export interface OverviewExercise {
  order: number;
  section: string;
  exercise: string;
  category: string;
  sets: string;
  reps: string;
  sets_logged: number;
  week_min: number | null;
  week_max: number | null;
  best_weight: number | null;
  recent_weight: number | null;
  recent_reps: number | null;
}

export interface OverviewDay {
  day: string;
  exercises: OverviewExercise[];
}

export interface WorkoutOverview {
  week: number;
  days: OverviewDay[];
}

export interface WorkoutDay {
  warmup: PlanExercise[];
  strength: PlanExercise[];
  cooldown: PlanExercise[];
  phase: string;
}

export interface WorkoutSetLogRequest {
  week: number;
  day: string;
  exercise: string;
  set_num: number;
  planned_reps?: string;
  actual_reps?: string;
  weight?: string;
  notes?: string;
  log_date?: string;
}

export interface WorkoutSetEntry {
  exercise: string;
  set_num: number;
  planned_reps: string;
  actual_reps: string;
  weight: string;
  notes: string;
}

export interface WorkoutSessionLogRequest {
  week: number;
  day: string;
  energy_level: string; // high | medium | low
  notes?: string;
  total_exercises?: number;
  log_date?: string;
}

export interface WorkoutSession {
  date: string;
  week: string;
  day: string;
  energy_level: string;
  notes: string;
}

export interface WorkoutProgress {
  total_sessions: number; // logged session instances, repeats included
  total_sets: number;
  distinct_days_completed: number; // unique planned (week, day) slots with >=1 session
  total_planned_days: number;
  recent: WorkoutSession[];
}

export interface WorkoutSetSummary {
  exercise: string;
  set_num: number;
  reps: string;
  weight: string;
}

export interface WorkoutDaySummary {
  date: string;
  week: string;
  day: string;
  energy_level: string;
  notes: string;
  sets: WorkoutSetSummary[];
}

// --- Workout: Phase 2 (plan editing, cache browsing, ExerciseDB) ---

export interface WorkoutPlanUpdateRequest {
  exercise?: string;
  sets?: string;
  reps?: string;
  weight?: string;
  tempo?: string;
  rest?: string;
  notes?: string;
  category?: string;
}

export interface CloneDayRequest {
  week: number;
  source_day: string;
  new_day_name: string;
}

export interface CloneWeekRequest {
  source_week: number;
}

export interface CloneResult {
  success: boolean;
  message: string;
  new_week?: number;
}

export interface ExerciseCacheOptions {
  equipments: string[];
  body_parts: string[];
  exercise_type: string[];
  target_muscles: string[];
  secondary_muscles: string[];
  keywords: string[];
  total: number;
}

export interface ExerciseCacheFilters {
  equipments: string[];
  body_parts: string[];
  exercise_type: string[];
  target_muscles: string[];
  secondary_muscles: string[];
  keywords: string[];
  search_text: string;
  page: number;
}

export interface ExerciseCacheItem {
  exercise_id: string;
  name: string;
  image_url: string;
  equipments: string[];
  body_parts: string[];
  exercise_type: string;
  target_muscles: string[];
}

export interface ExerciseCacheSearchResult {
  items: ExerciseCacheItem[];
  total: number;
  page: number;
  total_pages: number;
}

export interface ExerciseSearchResultItem {
  exercise_id: string;
  name: string;
  image_url: string;
  equipments: string[];
  body_parts: string[];
  exercise_type: string;
}

export interface ExerciseDetails {
  exercise_id: string;
  name: string;
  image_url: string;
  video_url: string;
  overview: string;
  instructions: string[];
  exercise_tips: string[];
  variations: string[];
  target_muscles: string[];
  secondary_muscles: string[];
  equipments: string[];
  body_parts: string[];
  exercise_type: string;
  keywords: string[];
  related_exercise_ids: string[];
}

export interface CustomExerciseRequest {
  name: string;
  image_url?: string;
  video_url?: string;
  overview?: string;
  instructions?: string[];
  exercise_tips?: string[];
  variations?: string[];
  target_muscles?: string[];
  secondary_muscles?: string[];
  equipments?: string[];
  body_parts?: string[];
  exercise_type?: string;
  keywords?: string[];
}
