"""Fixed pantry category taxonomy, shared conceptually with the frontend's
core/categories.ts (hand-synced, same pattern as the Pydantic/TS model split).
"""
from __future__ import annotations

APP_CATEGORIES = [
    {"id": "produce", "label": "Produce", "emoji": "🥦"},
    {"id": "dairy", "label": "Dairy", "emoji": "🥛"},
    {"id": "meat", "label": "Meat & Seafood", "emoji": "🍗"},
    {"id": "frozen", "label": "Frozen", "emoji": "🧊"},
    {"id": "grains", "label": "Grains & Bread", "emoji": "🍞"},
    {"id": "snacks", "label": "Snacks", "emoji": "🍿"},
    {"id": "sweets", "label": "Sweets & Desserts", "emoji": "🍫"},
    {"id": "beverages", "label": "Beverages", "emoji": "🥤"},
    {"id": "condiments", "label": "Condiments & Sauces", "emoji": "🧂"},
    {"id": "canned", "label": "Canned & Jarred", "emoji": "🥫"},
    {"id": "other", "label": "Other", "emoji": "🧺"},
]

_DEFAULT_LOCATION = {
    "produce": "fridge",
    "dairy": "fridge",
    "meat": "fridge",
    "frozen": "freezer",
    "grains": "pantry",
    "snacks": "pantry",
    "sweets": "pantry",
    "beverages": "pantry",
    "condiments": "pantry",
    "canned": "pantry",
    "other": "pantry",
}

_PNNS_GROUP_1_MAP = {
    "Fruits and vegetables": "produce",
    "Milk and dairy products": "dairy",
    "Fish Meat Eggs": "meat",
    "Cereals and potatoes": "grains",
    "Salty snacks": "snacks",
    "Sugary snacks": "sweets",
    "Beverages": "beverages",
    "Fat and sauces": "condiments",
}


def category_from_off(pnns_group_1: str | None, categories_tags: list[str] | None) -> str:
    """Map OFF's pnns_groups_1 (+ a frozen-foods override) to an app category id.
    Always returns a valid id, defaulting to "other" when nothing matches."""
    tags = categories_tags or []
    if "en:frozen-foods" in tags:
        return "frozen"
    return _PNNS_GROUP_1_MAP.get(pnns_group_1 or "", "other")


def default_location(category: str | None) -> str:
    return _DEFAULT_LOCATION.get(category or "", "pantry")
