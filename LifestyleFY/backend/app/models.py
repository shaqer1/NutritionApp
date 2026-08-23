"""Pydantic request/response models shared across routes."""
from datetime import date, datetime

from pydantic import BaseModel, Field


class Macros(BaseModel):
    cal: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    sugar_g: float = 0
    fiber_g: float = 0
    sat_fat_g: float = 0
    sodium_mg: float = 0


class FoodItem(BaseModel):
    """A resolved food (from scan, search, or manual entry)."""
    name: str
    barcode: str | None = None
    per_serving: Macros = Field(default_factory=Macros)
    source: str = "manual"  # off | chomp | cache | manual
    brand: str | None = None
    serving_size: str | None = None  # raw human label, e.g. "1 bar (40 g)"
    serving_size_qty: float | None = None  # informational: leading qty before "(", e.g. 1 in "1 bar (40 g)" — NOT used in calcs
    serving_size_unit: str | None = None  # informational: leading unit/word before "(", e.g. "bar"
    serving_qty: float | None = None  # calc quantity per serving, any unit — drives grams/decrement math
    serving_unit: str | None = None  # calc unit, e.g. "g", "ml"
    serving_qty_g: float | None = None  # grams-only convenience; set only when serving_unit == "g"
    macros_basis: str | None = None  # "serving" | "100g" | None — which basis per_serving actually used
    image_url: str | None = None
    nutrition_grade: str | None = None  # e.g. Nutri-Score a-e
    category: str | None = None  # id from services/categories.py
    ingredients_text: str | None = None  # free-text ingredient list


class ScanRequest(BaseModel):
    barcode: str


class InventoryItem(FoodItem):
    item_id: str | None = None
    qty: float = 1  # servings remaining
    unit: str = "unit"
    location: str = "pantry"  # pantry | fridge | freezer
    initial_qty: float | None = None  # servings at creation; never mutated after


class LogRequest(BaseModel):
    meal: str = "snack"  # breakfast | lunch | dinner | snack
    meal_instance: int = 1  # distinguishes separate sittings, e.g. "Lunch 2"
    item_name: str
    barcode: str | None = None
    source: str = "manual"
    servings: float = 1
    macros: Macros
    from_inventory: bool = False
    inventory_item_id: str | None = None  # decrements this item's qty when set
    grams: float | None = None  # actual grams consumed, computed client-side
    log_date: date | None = None  # client's local calendar day; bucketing uses
    # this instead of the UTC date of `ts` — otherwise entries logged in the
    # evening in any UTC-negative timezone silently land in "tomorrow".
    ts: datetime | None = None  # defaults to now server-side


class LogEntry(BaseModel):
    """One itemized food_log row, as returned by GET /log."""
    log_id: str | None = None  # addresses this row for PUT/DELETE /log/{log_id}
    item_name: str
    barcode: str | None = None
    meal: str
    meal_instance: int = 1
    servings: float
    macros: Macros  # totals for this entry (already scaled by servings)
    grams: float | None = None
    ts: datetime


class Goals(BaseModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    target_weight_lb: float | None = None
    weekly_gain_lb: float | None = None
    phase: str = "bulk"
    set_by: str = "manual"  # manual | ai


class Profile(BaseModel):
    weight_lb: float
    height_in: float
    age: int
    sex: str = "male"  # male | female
    activity_level: str = "moderate"  # sedentary|light|moderate|active|very_active
    dietary_prefs: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    # IANA name; defaults to Central so existing users read back unchanged.
    timezone: str = "America/Chicago"


class AiPrompts(BaseModel):
    """Per-category standing note the user can edit, appended to that
    category's AI prompt on every future generate call."""
    nudge: str = ""
    recipe: str = ""
    grocery: str = ""
    workout: str = ""


class Roles(BaseModel):
    """Caller's role flags from the `config/access` Firestore doc — either
    flag grants system-prompt edit access (see auth.require_ai_prompt_admin).
    Simple booleans for now, expandable later."""
    isAiAdmin: bool = False
    isAppAdmin: bool = False


class SystemPrompts(BaseModel):
    """Admin-editable override of each category's hardcoded 'generic' prompt
    template. Empty string means "use the hardcoded default" (see each
    Coach.*_prompt_parts()'s generic_override param). Global, not per-user —
    unlike AiPrompts' standing note, this replaces the base instructions
    every user's calls build on."""
    nudge: str = ""
    recipe: str = ""
    grocery: str = ""
    workout: str = ""


class AdminUser(BaseModel):
    """One row of the App-Admin user/role management screen — merges
    `config/access`'s allowed_emails + roles into a single view."""
    email: str
    isAiAdmin: bool = False
    isAppAdmin: bool = False


class DeviceToken(BaseModel):
    """A registered FCM web push token — doc id in Firestore is the token
    itself, so re-registration overwrites rather than duplicating."""
    token: str
    platform: str = "web"


class MealNotificationPrefs(BaseModel):
    breakfast: bool = False
    lunch: bool = False
    snack: bool = False
    dinner: bool = False


class NotificationPrefs(BaseModel):
    """Per-user opt-in flags for push notifications — everything defaults
    off; users must explicitly enable each type from Settings."""
    coach_nudges: bool = False
    meals: MealNotificationPrefs = Field(default_factory=MealNotificationPrefs)
    # event name -> ISO date (user's local date) last sent; dedupes the sweep
    # beyond the "already logged" check (e.g. tolerance-window overlap at a run boundary).
    last_notified: dict[str, str] = Field(default_factory=dict)


class TodaySummary(BaseModel):
    date: date
    consumed: Macros
    remaining: Macros
    meals_logged: int
    pct_to_goal: float  # 0..1 on calories
    goals: Goals | None = None
    coach_tip: str | None = None


class CoachMessage(BaseModel):
    text: str
    type: str  # nudge | goal | recipe
    created_at: datetime


class RecipeIngredient(BaseModel):
    item_id: str | None = None  # pantry Ingredient reference, if matched
    name: str
    quantity: float
    unit: str
    macros: Macros = Field(default_factory=Macros)  # snapshot, for this quantity


class Recipe(BaseModel):
    recipe_id: str | None = None
    name: str
    servings: float = 1
    instructions: str = ""
    ingredients: list[RecipeIngredient] = Field(default_factory=list)
    source: str = "manual"  # ai | manual
    image_url: str | None = None
    is_active: bool = True
    created_at: datetime | None = None
    meal: str = ""  # breakfast | lunch | dinner | snack | "" (unset, incl. older recipes)


class GroceryItem(BaseModel):
    name: str
    quantity: str = ""  # free text, e.g. "2 bunches"
    section: str = "other"  # id from services/categories.py
    checked: bool = False


class GrocerySwap(BaseModel):
    title: str
    explanation: str


class GroceryList(BaseModel):
    grocery_list_id: str | None = None
    name: str = ""
    days: int = 7
    items: list[GroceryItem] = Field(default_factory=list)
    swaps: list[GrocerySwap] = Field(default_factory=list)
    source: str = "manual"  # ai | manual
    is_active: bool = True
    created_at: datetime | None = None


# ---------- Workout ----------

class PlanExercise(BaseModel):
    """One WorkoutPlan slot (a single exercise within a week/day/section).
    image_url/overview/instructions/target_muscles are joined in from
    exercise_cache at read time — never stored on the plan doc itself."""
    plan_id: str | None = None  # deterministic: week_day_section_order
    week: int
    day: str
    phase: str = ""
    section: str  # Warm-Up | Strength | Cool-Down
    order: int
    exercise: str
    sets: str = ""
    reps: str = ""
    weight: str = ""
    tempo: str = ""
    rest: str = ""
    video_url: str = ""
    exercise_id: str | None = None
    notes: str = ""
    category: str = ""  # push | pull | legs | arms | core | warmup | stretch
    is_custom: bool = False
    image_url: str | None = None
    overview: str | None = None
    instructions: list[str] = Field(default_factory=list)
    target_muscles: list[str] = Field(default_factory=list)
    equipments: list[str] = Field(default_factory=list)
    exercise_tips: list[str] = Field(default_factory=list)
    variations: list[str] = Field(default_factory=list)
    related_exercise_ids: list[str] = Field(default_factory=list)


class WorkoutConfig(BaseModel):
    current_week: int = 1
    start_date: date | None = None


class WorkoutWeekOverview(BaseModel):
    days: list[str] = Field(default_factory=list)
    completed_days: list[str] = Field(default_factory=list)


class OverviewExercise(BaseModel):
    """One planned exercise slot, annotated with load-so-far pulled from
    workout_set_log — for the swipeable card overview, not plan editing."""
    order: int
    section: str
    exercise: str
    category: str = ""
    sets: str = ""
    reps: str = ""
    sets_logged: int = 0
    week_min: int | None = None
    week_max: int | None = None
    best_weight: float | None = None
    recent_weight: float | None = None
    recent_reps: float | None = None


class OverviewDay(BaseModel):
    day: str
    exercises: list[OverviewExercise] = Field(default_factory=list)


class WorkoutOverview(BaseModel):
    week: int
    days: list[OverviewDay] = Field(default_factory=list)


class WorkoutDay(BaseModel):
    warmup: list[PlanExercise] = Field(default_factory=list)
    strength: list[PlanExercise] = Field(default_factory=list)
    cooldown: list[PlanExercise] = Field(default_factory=list)
    phase: str = ""


class WorkoutSetLogRequest(BaseModel):
    week: int
    day: str
    exercise: str
    set_num: int
    planned_reps: str = ""
    actual_reps: str = ""
    weight: str = ""
    notes: str = ""
    log_date: date | None = None
    ts: datetime | None = None


class WorkoutSetEntry(BaseModel):
    """One already-logged set, as returned by GET /workout/sets — used to
    hydrate the set tracker with what's already been logged for a day."""
    exercise: str
    set_num: int
    planned_reps: str = ""
    actual_reps: str = ""
    weight: str = ""
    notes: str = ""


class WorkoutSessionLogRequest(BaseModel):
    week: int
    day: str
    energy_level: str = "medium"  # high | medium | low
    notes: str = ""
    total_exercises: int = 0
    log_date: date | None = None
    ts: datetime | None = None


class WorkoutSession(BaseModel):
    """One completed workout session, as returned in progress history."""
    date: str
    week: str
    day: str
    energy_level: str = ""
    notes: str = ""


class WorkoutProgress(BaseModel):
    total_sessions: int = 0  # logged session instances, repeats included
    total_sets: int = 0
    distinct_days_completed: int = 0  # unique planned (week, day) slots with >=1 session
    total_planned_days: int = 40
    recent: list[WorkoutSession] = Field(default_factory=list)


class WorkoutSetSummary(BaseModel):
    """One logged set, as shown within a WorkoutDaySummary."""
    exercise: str
    set_num: int
    reps: str = ""
    weight: str = ""


class WorkoutDaySummary(BaseModel):
    """One completed workout day (session + its logged sets), grouped by
    (date, week, day) — used for the Overview "today's workouts" section and
    as AI prompt context (recent workouts)."""
    date: str
    week: str
    day: str
    energy_level: str = ""
    notes: str = ""
    sets: list[WorkoutSetSummary] = Field(default_factory=list)


# ---------- Workout: Phase 2 (plan editing, cache browsing, ExerciseDB) ----------

class WorkoutPlanUpdateRequest(BaseModel):
    """Body for PUT /workout/plan/{plan_id}. All fields optional — only the
    ones provided are changed, mirroring the old app's updateWorkoutPlanRow."""
    exercise: str | None = None
    sets: str | None = None
    reps: str | None = None
    weight: str | None = None
    tempo: str | None = None
    rest: str | None = None
    notes: str | None = None
    category: str | None = None


class CloneDayRequest(BaseModel):
    week: int
    source_day: str
    new_day_name: str


class CloneWeekRequest(BaseModel):
    source_week: int


class ExerciseCacheOptions(BaseModel):
    equipments: list[str] = Field(default_factory=list)
    body_parts: list[str] = Field(default_factory=list)
    exercise_type: list[str] = Field(default_factory=list)
    target_muscles: list[str] = Field(default_factory=list)
    secondary_muscles: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    total: int = 0


class ExerciseCacheFilters(BaseModel):
    equipments: list[str] = Field(default_factory=list)
    body_parts: list[str] = Field(default_factory=list)
    exercise_type: list[str] = Field(default_factory=list)
    target_muscles: list[str] = Field(default_factory=list)
    secondary_muscles: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    search_text: str = ""
    page: int = 1


class ExerciseCacheItem(BaseModel):
    exercise_id: str
    name: str
    image_url: str = ""
    equipments: list[str] = Field(default_factory=list)
    body_parts: list[str] = Field(default_factory=list)
    exercise_type: str = ""
    target_muscles: list[str] = Field(default_factory=list)


class ExerciseCacheSearchResult(BaseModel):
    items: list[ExerciseCacheItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    total_pages: int = 0


class ExerciseSearchResultItem(BaseModel):
    """A single ExerciseDB live-search hit, decorated with cached
    equipment/body-part/type info when we've already seen this exercise
    before (empty when it's a genuinely new result)."""
    exercise_id: str
    name: str
    image_url: str = ""
    equipments: list[str] = Field(default_factory=list)
    body_parts: list[str] = Field(default_factory=list)
    exercise_type: str = ""


class ExerciseDetails(BaseModel):
    """Full exercise record — used for both the cache-browse "Info" view and
    the live ExerciseDB search-result preview before swapping."""
    exercise_id: str
    name: str
    image_url: str = ""
    video_url: str = ""
    overview: str = ""
    instructions: list[str] = Field(default_factory=list)
    exercise_tips: list[str] = Field(default_factory=list)
    variations: list[str] = Field(default_factory=list)
    target_muscles: list[str] = Field(default_factory=list)
    secondary_muscles: list[str] = Field(default_factory=list)
    equipments: list[str] = Field(default_factory=list)
    body_parts: list[str] = Field(default_factory=list)
    exercise_type: str = ""
    keywords: list[str] = Field(default_factory=list)
    related_exercise_ids: list[str] = Field(default_factory=list)


class ExerciseSwapRequest(BaseModel):
    new_exercise_id: str


class CustomExerciseRequest(BaseModel):
    name: str
    image_url: str = ""
    video_url: str = ""
    overview: str = ""
    instructions: list[str] = Field(default_factory=list)
    exercise_tips: list[str] = Field(default_factory=list)
    variations: list[str] = Field(default_factory=list)
    target_muscles: list[str] = Field(default_factory=list)
    secondary_muscles: list[str] = Field(default_factory=list)
    equipments: list[str] = Field(default_factory=list)
    body_parts: list[str] = Field(default_factory=list)
    exercise_type: str = ""
    keywords: list[str] = Field(default_factory=list)
