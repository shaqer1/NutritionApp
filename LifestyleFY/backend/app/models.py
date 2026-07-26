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


class AiPrompts(BaseModel):
    """Per-category standing note the user can edit, appended to that
    category's AI prompt on every future generate call."""
    nudge: str = ""
    recipe: str = ""
    grocery: str = ""


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
