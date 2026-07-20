"""AI coaching (Gemini) + deterministic goal math.

- compute_goals(): Mifflin-St Jeor BMR -> TDEE -> surplus for the phase.
  Deterministic and free; Gemini is only used for natural-language phrasing
  and for the open-ended recipe/grocery/nudge generation.
- nudge(): meal-time check. If behind pace, ask Gemini for one realistic,
  quick, energy-boosting meal that closes the gap using on-hand inventory.
- recipes()/grocery(): open-ended generation from inventory + goals + prefs.

USE_STUBS returns canned text so the API runs with no Gemini key.
"""
from __future__ import annotations

from ..config import Settings
from ..models import Goals, InventoryItem, Macros, Profile, TodaySummary

ACTIVITY = {
    "sedentary": 1.2, "light": 1.375, "moderate": 1.55,
    "active": 1.725, "very_active": 1.9,
}
# kcal surplus by phase (muscle gain needs a moderate surplus).
PHASE_SURPLUS = {"bulk": 400, "lean-gain": 250, "maintain": 0, "cut": -400}


def compute_goals(profile: Profile, phase: str = "bulk",
                  target_weight_lb: float | None = None) -> Goals:
    """Mifflin-St Jeor (metric) -> TDEE -> phase surplus -> macro split."""
    kg = profile.weight_lb * 0.453592
    cm = profile.height_in * 2.54
    if profile.sex == "female":
        bmr = 10 * kg + 6.25 * cm - 5 * profile.age - 161
    else:
        bmr = 10 * kg + 6.25 * cm - 5 * profile.age + 5
    tdee = bmr * ACTIVITY.get(profile.activity_level, 1.55)
    calories = round(tdee + PHASE_SURPLUS.get(phase, 400))

    # Macro targets: ~1g protein/lb bodyweight, 25% cal from fat, rest carbs.
    protein_g = round(profile.weight_lb * 1.0)
    fat_g = round(calories * 0.25 / 9)
    carbs_g = round((calories - protein_g * 4 - fat_g * 9) / 4)
    weekly_gain = 0.5 if phase in ("bulk", "lean-gain") else 0.0

    return Goals(
        calories=calories, protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g,
        target_weight_lb=target_weight_lb or round(profile.weight_lb + 15),
        weekly_gain_lb=weekly_gain, phase=phase, set_by="ai",
    )


def next_goal(current: Goals, profile: Profile) -> Goals:
    """When target weight is reached, propose the next mesocycle."""
    reached = current.target_weight_lb or profile.weight_lb
    new_profile = profile.model_copy(update={"weight_lb": reached})
    # After a bulk, step to lean-gain toward +10 more lb.
    phase = "lean-gain" if current.phase == "bulk" else "bulk"
    return compute_goals(new_profile, phase=phase,
                         target_weight_lb=round(reached + 10))


class Coach:
    def __init__(self, settings: Settings):
        self.s = settings
        self._client = None

    def _gemini(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=self.s.gemini_api_key)
        return self._client

    def _generate(self, prompt: str, smart: bool = False) -> str:
        if self.s.use_stubs or not self.s.gemini_api_key:
            return f"[stubbed coach reply] {prompt[:120]}..."
        model = self.s.gemini_model_smart if smart else self.s.gemini_model_fast
        resp = self._gemini().models.generate_content(model=model, contents=prompt)
        return (resp.text or "").strip()

    # ---------- Meal-time nudge ----------
    def nudge(self, summary: TodaySummary, inventory: list[InventoryItem],
              meal: str, time_label: str) -> str | None:
        g = summary.goals
        if not g:
            return None
        # Only nudge if behind on calories or protein for the time of day.
        behind = (summary.remaining.protein > g.protein_g * 0.35
                  or summary.remaining.cal > g.calories * 0.45)
        if not behind:
            return None
        on_hand = ", ".join(i.name for i in inventory[:20]) or "nothing logged"
        prompt = (
            f"It's {time_label}. Bulking target is {g.calories} kcal / "
            f"{g.protein_g}g protein. So far today: {round(summary.consumed.cal)} kcal, "
            f"{round(summary.consumed.protein)}g protein. Remaining: "
            f"{round(summary.remaining.cal)} kcal, {round(summary.remaining.protein)}g "
            f"protein. On hand: {on_hand}. Suggest ONE realistic, quick, "
            f"energy-boosting {meal} that closes most of the protein/calorie gap. "
            f"Two sentences, encouraging, no preamble."
        )
        return self._generate(prompt)

    # ---------- Recipes ----------
    def recipes(self, inventory: list[InventoryItem], remaining: Macros,
                prefs: list[str], allergies: list[str], count: int = 3) -> str:
        on_hand = ", ".join(f"{i.name} (x{i.qty})" for i in inventory) or "basic staples"
        prompt = (
            f"Ingredients on hand: {on_hand}. Dietary prefs: "
            f"{', '.join(prefs) or 'none'}. Allergies: {', '.join(allergies) or 'none'}. "
            f"Suggest {count} muscle-gain recipes that together roughly hit "
            f"{round(remaining.cal)} kcal and {round(remaining.protein)}g protein "
            f"remaining today. For each: name, ingredients used, quick steps, and "
            f"approx macros. Prefer high-protein, calorie-dense options."
        )
        return self._generate(prompt, smart=True)

    # ---------- Grocery list ----------
    def grocery(self, inventory: list[InventoryItem], goals: Goals,
                prefs: list[str], days: int = 7) -> str:
        on_hand = ", ".join(i.name for i in inventory) or "nothing"
        prompt = (
            f"Plan a {days}-day muscle-gain grocery list for a bulking target of "
            f"{goals.calories} kcal / {goals.protein_g}g protein per day. "
            f"Already have: {on_hand}. Prefs: {', '.join(prefs) or 'none'}. "
            f"Return only the items to BUY (not what's on hand), grouped by store "
            f"section, with quantities. Prioritize cheap, high-protein, "
            f"calorie-dense staples."
        )
        return self._generate(prompt, smart=True)
