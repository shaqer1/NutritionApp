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
    serving_size: str | None = None  # human label, e.g. "15g" or "1 cup (240ml)"
    serving_qty_g: float | None = None  # parsed grams, for scaling
    image_url: str | None = None
    nutrition_grade: str | None = None  # e.g. Nutri-Score a-e
    category: str | None = None  # id from services/categories.py


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
    item_name: str
    barcode: str | None = None
    source: str = "manual"
    servings: float = 1
    macros: Macros
    from_inventory: bool = False
    inventory_item_id: str | None = None  # decrements this item's qty when set
    ts: datetime | None = None  # defaults to now server-side


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
