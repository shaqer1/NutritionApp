"""AI coaching (Gemini) + deterministic goal math.

- compute_goals(): Mifflin-St Jeor BMR -> TDEE -> surplus for the phase.
  Deterministic and free; Gemini is only used for natural-language phrasing
  and for the open-ended recipe/grocery/nudge generation.
- nudge(): meal-time check. If behind pace, ask Gemini for one realistic,
  quick, energy-boosting meal that closes the gap using on-hand inventory.
- suggest_recipe(): structured (JSON) recipe draft built from real pantry
  ingredients — distinct from grocery()'s free-text generation, since a
  recipe needs to be editable/saveable as a Recipe, not just prose.
- grocery(): open-ended generation from inventory + goals + prefs.

USE_STUBS returns canned text (or a canned Recipe) so the API runs with no
Gemini key.
"""
from __future__ import annotations

import json
import re
from datetime import date

from ..config import Settings
from ..models import (
    FoodItem, Goals, GroceryItem, GroceryList, GrocerySwap, InventoryItem, LogEntry, Macros,
    Profile, Recipe, RecipeIngredient, TodaySummary, WorkoutDaySummary,
)
from .categories import APP_CATEGORIES

_CATEGORY_IDS = ", ".join(c["id"] for c in APP_CATEGORIES)

# Matches <meta property="og:image" content="..."> in either attribute order.
_OG_IMAGE_RE = re.compile(
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', re.IGNORECASE)
_OG_IMAGE_ALT_RE = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', re.IGNORECASE)
_OG_WIDTH_RE = re.compile(
    r'<meta[^>]+property=["\']og:image:width["\'][^>]+content=["\'](\d+)["\']', re.IGNORECASE)
_OG_HEIGHT_RE = re.compile(
    r'<meta[^>]+property=["\']og:image:height["\'][^>]+content=["\'](\d+)["\']', re.IGNORECASE)
# Confirmed live against real false positives: generic site-wide branding/
# share images are named things like "calory-og.png" or "opengraph-image.png"
# — a real uploaded content photo (e.g. a WordPress "20231007_192437-scaled
# .jpg") essentially never matches these tokens as a whole delimited segment.
_GENERIC_IMAGE_HINT_RE = re.compile(
    r'(?:[/_-]|^)(og|opengraph|logo|favicon|placeholder|default)(?:[/_.-]|$)', re.IGNORECASE)


def _extract_og_image(html: str, min_dimension: int = 200) -> str | None:
    """Pulls a page's Open Graph image — the same mechanism link-preview
    unfurls (Slack/iMessage/Twitter) use. Two-tier trust: if the page
    declares og:image:width/height, trust it iff both are >= min_dimension
    (a real photo vs. a tiny icon). If it doesn't declare dimensions — very
    common even for genuine content photos, confirmed live (a real food-blog
    review photo had none) — fall back to rejecting only filenames that look
    like generic site branding/share-card assets, accepting everything else.
    Never downloads the image itself, just reads page HTML already fetched."""
    m = _OG_IMAGE_RE.search(html) or _OG_IMAGE_ALT_RE.search(html)
    if not m:
        return None
    url = m.group(1)
    w = _OG_WIDTH_RE.search(html)
    h = _OG_HEIGHT_RE.search(html)
    if w and h:
        if int(w.group(1)) < min_dimension or int(h.group(1)) < min_dimension:
            return None
        return url
    if _GENERIC_IMAGE_HINT_RE.search(url):
        return None
    return url

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

    def _generate_response(self, prompt: str, smart: bool = False, grounded: bool = False):
        """Raw Gemini response (only call directly when a caller needs more
        than the text, e.g. grounding_metadata for source URLs — otherwise
        use _generate()). Caller is responsible for the use_stubs/no-key
        check; this always makes a real API call."""
        model = self.s.gemini_model_smart if smart else self.s.gemini_model_fast
        config = None
        if grounded:
            from google.genai import types
            config = types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            )
        from google.genai import errors
        try:
            return self._gemini().models.generate_content(model=model, contents=prompt, config=config)
        except errors.APIError as e:
            raise ValueError(f"Gemini API error: {e}") from e

    def _generate(self, prompt: str, smart: bool = False, grounded: bool = False) -> str:
        if self.s.use_stubs or not self.s.gemini_api_key:
            return f"[stubbed coach reply] {prompt[:120]}..."
        resp = self._generate_response(prompt, smart=smart, grounded=grounded)
        return (resp.text or "").strip()

    def _resolve_grounding_image(self, response) -> str | None:
        """Best-effort real photo for an AI food lookup: follows the actual
        web pages Gemini's Google Search grounding visited (not the model's
        own guess — LLMs hallucinate URLs with total confidence) and takes
        the first one with a real Open Graph image. Tries several sources
        (not just the first) since delivery/ordering platforms (Toast, Uber
        Eats) commonly block non-browser requests with 403/429 — confirmed
        live, ~40% of sources for one query were blocked this way — so a
        single-source attempt would miss otherwise-fetchable images. Fails
        silently either way; this is a nice-to-have the lookup must work
        fine without."""
        try:
            metadata = response.candidates[0].grounding_metadata
            chunks = metadata.grounding_chunks or [] if metadata else []
        except (AttributeError, IndexError):
            return None

        import httpx
        with httpx.Client(timeout=4.0, follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (compatible; personal-nutrition-app/1.0)"}) as client:
            for chunk in chunks[:5]:
                uri = getattr(getattr(chunk, "web", None), "uri", None)
                if not uri:
                    continue
                try:
                    resp = client.get(uri)
                    if resp.status_code != 200:
                        continue
                    image_url = _extract_og_image(resp.text)
                    if image_url:
                        return image_url
                except httpx.HTTPError:
                    continue
        return None

    @staticmethod
    def _recent_workouts_text(days: list[WorkoutDaySummary]) -> str:
        if not days:
            return "no recent workouts logged"
        parts = []
        for d in days:
            sets_text = "; ".join(
                f"{s.exercise} set {s.set_num}: {s.reps} reps @ {s.weight}" for s in d.sets
            ) or "no sets logged"
            parts.append(
                f"{d.date} ({d.day or 'workout'}, week {d.week}, felt: "
                f"{d.energy_level or 'not rated'}) — {sets_text}"
            )
        return " | ".join(parts)

    @staticmethod
    def _assemble_prompt(generic: str, context: str, custom_note: str, message: str = "") -> str:
        parts = [generic, context]
        if custom_note.strip():
            parts.append(f"User's standing note: {custom_note.strip()}")
        if message.strip():
            parts.append(f"User's one-time request for this message: {message.strip()}")
        return "\n\n".join(parts)

    # ---------- Meal-time nudge ----------
    def nudge_prompt_parts(self, summary: TodaySummary, inventory: list[InventoryItem],
                           log_entries: list[LogEntry], meal: str,
                           time_label: str, today: date,
                           generic_override: str = "") -> tuple[str, str]:
        g = summary.goals
        generic = generic_override.strip() or (
            "You are a nutrition coach for a muscle-gain app. Suggest ONE realistic, "
            "quick meal or snack the user can eat right now that closes as much of "
            "their remaining macro gap as possible using what's on hand — OR, if the "
            "pantry genuinely can't cover the gap, say so and suggest a grocery run "
            "instead. Two to three sentences, encouraging, no preamble, no markdown."
        )
        eaten = "; ".join(
            f"{e.meal} #{e.meal_instance}: {e.item_name} ({round(e.macros.cal)} kcal)"
            for e in log_entries
        ) or "nothing yet"
        on_hand = ", ".join(i.name for i in inventory[:20]) or "nothing logged"
        goal_line = (
            f"Daily target: {g.calories} kcal / {g.protein_g}g protein / "
            f"{g.carbs_g}g carbs / {g.fat_g}g fat."
            if g else "No macro goals set yet."
        )
        # {Recent_workouts} is a display placeholder, not sent to Gemini as-is
        # — nudge() substitutes the real recent-workout summary right before
        # generating, same pattern as {Pantry_items} below.
        context = (
            f"Today's date: {today.isoformat()}.\n"
            f"It's {time_label} ({meal} time).\n{goal_line}\n"
            f"Consumed so far: {round(summary.consumed.cal)} kcal / "
            f"{round(summary.consumed.protein)}g P / {round(summary.consumed.carbs)}g C / "
            f"{round(summary.consumed.fat)}g F.\n"
            f"Remaining: {round(summary.remaining.cal)} kcal / "
            f"{round(summary.remaining.protein)}g P / {round(summary.remaining.carbs)}g C / "
            f"{round(summary.remaining.fat)}g F.\n"
            f"Meals/items already eaten today: {eaten}.\n"
            f"Pantry on hand: {on_hand}.\n"
            "Recent workouts (up to 3, most recent first): {Recent_workouts}"
        )
        return generic, context

    def nudge(self, summary: TodaySummary, inventory: list[InventoryItem],
              log_entries: list[LogEntry], meal: str, time_label: str, today: date,
              recent_workouts: list[WorkoutDaySummary] | None = None,
              custom_note: str = "", message: str = "", generic_override: str = "") -> str | None:
        # Always generates on request (button click or direct question) — no
        # "only nudge if behind on macros" gate. Only skips if there's no goal
        # to nudge against at all.
        if not summary.goals:
            return None
        generic, context = self.nudge_prompt_parts(summary, inventory, log_entries, meal, time_label, today,
                                                    generic_override=generic_override)
        context = context.replace("{Recent_workouts}", self._recent_workouts_text(recent_workouts or []))
        return self._generate(self._assemble_prompt(generic, context, custom_note, message))

    # ---------- Recipes ----------
    def recipe_prompt_parts(self, inventory: list[InventoryItem], prefs: list[str],
                            allergies: list[str], meal_period: str,
                            remaining: Macros, today: date,
                            generic_override: str = "") -> tuple[str, str]:
        # An override that drops the JSON-shape instructions below will break
        # suggest_recipe()'s json.loads() — surfaces as the existing malformed-
        # JSON ValueError (502), not a crash. Admin's responsibility to fix.
        generic = generic_override.strip() or (
            "You are a recipe assistant for a muscle-gain nutrition app. Using ONLY "
            "(or as much as possible) the ingredients listed below from the user's "
            "own pantry, suggest ONE high-protein, calorie-dense recipe sized to fit "
            "the remaining macro budget given below for the specified meal period.\n"
            "Respond with ONLY valid JSON (no markdown fences, no commentary) "
            "matching exactly this shape:\n"
            '{"name": "string", "servings": number, "instructions": "string", '
            '"ingredients": [{"item_id": "string or null", "name": "string", '
            '"quantity": number, "unit": "string", "macros": {"cal": number, '
            '"protein": number, "carbs": number, "fat": number, "sugar_g": number, '
            '"fiber_g": number, "sat_fat_g": number, "sodium_mg": number}}]}\n'
            "The macros object per ingredient should reflect that ingredient's "
            "quantity in this recipe (not per-serving-of-the-original-product).\n"
            "IMPORTANT: whenever an ingredient is matched to a real pantry item "
            "(item_id set, not null), \"quantity\" MUST be a count of servings of "
            "THAT pantry item, in the same \"unit\" it already uses in the pantry "
            "list below (e.g. pantry entry {\"unit\": \"container\", ...} and the "
            "recipe uses half of it -> quantity: 0.5, unit: \"container\") — never "
            "grams or any other unit, even though macros/serving_qty are shown in "
            "grams for nutritional reference below. This quantity is subtracted "
            "directly from that item's remaining stock when the recipe is logged "
            "or cooked. Ingredients with no pantry match (item_id: null) are free "
            "text for quantity/unit and are not used for inventory math."
        )
        # {Pantry_items} is a display placeholder, not sent to Gemini as-is —
        # suggest_recipe() substitutes the real pantry JSON in right before
        # generating. The preview route shows the placeholder untouched, so
        # the (potentially long) raw JSON dump never needs to be shown to the
        # user, even though it's exactly what gets sent for real.
        context = (
            f"Today's date: {today.isoformat()}.\n"
            f"Meal period: {meal_period}.\n"
            f"Remaining macro budget for today: {round(remaining.cal)} kcal / "
            f"{round(remaining.protein)}g protein / {round(remaining.carbs)}g carbs / "
            f"{round(remaining.fat)}g fat.\n"
            f"Dietary prefs: {', '.join(prefs) or 'none'}. "
            f"Allergies: {', '.join(allergies) or 'none'} (must avoid).\n"
            "Recent workouts (up to 3, most recent first): {Recent_workouts}\n\n"
            "Pantry ingredients (JSON): {Pantry_items}"
        )
        return generic, context

    @staticmethod
    def _pantry_json(inventory: list[InventoryItem]) -> str:
        on_hand = [
            {
                "item_id": i.item_id, "name": i.name, "unit": i.unit,
                "serving_qty": i.serving_qty, "serving_unit": i.serving_unit,
                "macros_per_serving": i.per_serving.model_dump(),
            }
            for i in inventory
        ]
        return json.dumps(on_hand)

    def suggest_recipe(self, inventory: list[InventoryItem], prefs: list[str],
                       allergies: list[str], meal_period: str, remaining: Macros, today: date,
                       recent_workouts: list[WorkoutDaySummary] | None = None,
                       custom_note: str = "", message: str = "",
                       generic_override: str = "") -> Recipe:
        """A structured (not free-text) recipe draft, built preferentially from
        real pantry ingredients so it's directly editable/saveable and its
        ingredient lines can later be logged against actual inventory."""
        inventory = [i for i in inventory if i.qty > 0]
        if self.s.use_stubs or not self.s.gemini_api_key:
            sample = inventory[:2]
            return Recipe(
                name="Stubbed Recipe (no Gemini key)",
                servings=1,
                instructions="This is a stub — set GEMINI_API_KEY for real AI suggestions.",
                ingredients=[
                    RecipeIngredient(
                        item_id=i.item_id, name=i.name, quantity=1, unit=i.unit,
                        macros=i.per_serving,
                    )
                    for i in sample
                ],
                source="ai",
            )

        generic, context = self.recipe_prompt_parts(inventory, prefs, allergies, meal_period, remaining, today,
                                                     generic_override=generic_override)
        context = context.replace("{Pantry_items}", self._pantry_json(inventory))
        context = context.replace("{Recent_workouts}", self._recent_workouts_text(recent_workouts or []))
        text = self._generate(self._assemble_prompt(generic, context, custom_note, message), smart=True)
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:]
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValueError(f"AI returned malformed recipe JSON: {e}") from e
        data["source"] = "ai"
        return Recipe(**data)

    # ---------- Grocery list ----------
    def grocery_prompt_parts(self, inventory: list[InventoryItem], goals: Goals,
                             prefs: list[str], days: int,
                             weekly_history: list[dict], today: date,
                             generic_override: str = "") -> tuple[str, str]:
        # An override replaces the whole computed default below, including its
        # {days}-day phrasing and the JSON-shape/category-id instructions —
        # same tradeoff as recipe_prompt_parts above.
        generic = generic_override.strip() or (
            f"Plan a {days}-day muscle-gain grocery list. Include only the items to "
            "BUY (not what's on hand), with quantities. Prioritize cheap, "
            "high-protein, calorie-dense staples. Also explicitly suggest 2-3 "
            "ingredient or meal substitutions that would make it easier to hit the "
            "macro goals, based on the weekly pattern below (e.g. consistently "
            "short on one macro).\n"
            "Respond with ONLY valid JSON (no markdown fences, no commentary) "
            "matching exactly this shape:\n"
            '{"name": "string", "days": number, '
            '"items": [{"name": "string", "quantity": "string", "section": "string", '
            '"checked": false}], '
            '"swaps": [{"title": "string", "explanation": "string"}]}\n'
            f"Each item's \"section\" must be one of exactly these ids: {_CATEGORY_IDS}."
        )
        on_hand = ", ".join(i.name for i in inventory) or "nothing"
        history_lines = "; ".join(
            f"{h['date']}: {round(h['consumed'].cal)} kcal / {round(h['consumed'].protein)}g P "
            f"(target {goals.calories} kcal / {goals.protein_g}g P)"
            for h in weekly_history
        ) or "no history yet"
        context = (
            f"Today's date: {today.isoformat()}.\n"
            f"Daily target: {goals.calories} kcal / {goals.protein_g}g protein / "
            f"{goals.carbs_g}g carbs / {goals.fat_g}g fat.\n"
            f"Already have: {on_hand}.\nPrefs: {', '.join(prefs) or 'none'}.\n"
            f"Last 7 days consumed-vs-target: {history_lines}.\n"
            "Recent workouts (up to 3, most recent first): {Recent_workouts}"
        )
        return generic, context

    def grocery(self, inventory: list[InventoryItem], goals: Goals, prefs: list[str],
                days: int, weekly_history: list[dict], today: date,
                recent_workouts: list[WorkoutDaySummary] | None = None,
                custom_note: str = "", message: str = "",
                generic_override: str = "") -> GroceryList:
        """A structured (not free-text) grocery list draft, so it can be saved,
        edited, and archived like a Recipe rather than living only as prose."""
        if self.s.use_stubs or not self.s.gemini_api_key:
            return GroceryList(
                name=f"Stubbed {days}-day list (no Gemini key)",
                days=days,
                items=[
                    GroceryItem(name="Chicken breast", quantity="4 lbs", section="meat"),
                    GroceryItem(name="Rolled oats", quantity="1 tub (42 oz)", section="grains"),
                ],
                swaps=[
                    GrocerySwap(title="Set GEMINI_API_KEY for real suggestions",
                               explanation="This is a stub grocery list."),
                ],
                source="ai",
            )

        generic, context = self.grocery_prompt_parts(inventory, goals, prefs, days, weekly_history, today,
                                                      generic_override=generic_override)
        context = context.replace("{Recent_workouts}", self._recent_workouts_text(recent_workouts or []))
        text = self._generate(self._assemble_prompt(generic, context, custom_note, message), smart=True)
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:]
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValueError(f"AI returned malformed grocery list JSON: {e}") from e
        data["source"] = "ai"
        return GroceryList(**data)

    # ---------- AI food lookup ("Ask AI" in Inventory add/scan) ----------
    #
    # Two-step by necessity, confirmed live: a single call asking Gemini to
    # both search AND return strict JSON almost never actually invokes
    # Google Search grounding (grounding_metadata came back None repeatedly)
    # — the tight output-format instructions suppress tool use even with the
    # search tool enabled. A plain natural-language research question
    # reliably grounds (5-7 real sources every time in testing). So: step 1
    # asks a simple grounded question and keeps the raw response (for both
    # the text and its grounding sources); step 2 is a small non-grounded
    # call that reformats step 1's answer into the exact JSON shape the app
    # needs — reformatting never needs search, so nothing is lost by
    # dropping the tool for that call.
    @staticmethod
    def _food_research_prompt(query: str) -> str:
        return (
            "You are a nutrition-lookup assistant. Search for accurate, "
            f'currently-published nutrition facts for this specific item: "{query.strip()}". '
            "If it names a whole multi-serving item with no portion specified "
            "(e.g. \"Domino's pepperoni pizza\" with no \"slice\"/\"whole\" "
            "qualifier), use ONE standard single serving as that food is "
            "normally eaten or reported (e.g. one slice of a pizza) — never "
            "the entire multi-serving item — and state exactly what serving "
            "you're reporting. Give me: the item's precise name, brand (if "
            "any), the exact serving you're reporting, full nutrition facts "
            "for that serving (calories, protein, carbs, fat, sugar, fiber, "
            "saturated fat, sodium), and its typical ingredients. If you "
            "cannot find or confidently identify this item at all (too "
            "vague, misspelled beyond recognition, or not a real food), say "
            "so plainly instead of guessing."
        )

    @staticmethod
    def _food_format_prompt(research_text: str) -> str:
        return (
            "Convert the nutrition research below into JSON. If the research "
            "says the item couldn't be found/identified, respond with ONLY "
            'this JSON: {"error": "short reason"}. Otherwise respond with '
            "ONLY valid JSON (no markdown fences, no commentary) matching "
            "exactly this shape:\n"
            '{"name": "string", "brand": "string or null", '
            '"serving_size": "string", "serving_size_qty": "number or null", '
            '"serving_size_unit": "string or null", "serving_qty": "number or '
            'null", "serving_unit": "string or null, e.g. \\"g\\"", '
            '"serving_qty_g": "number or null, grams, set only when '
            'serving_unit is \\"g\\"", "macros_basis": "serving", '
            '"per_serving": {"cal": "number", "protein": "number", "carbs": '
            '"number", "fat": "number", "sugar_g": "number", "fiber_g": '
            '"number", "sat_fat_g": "number", "sodium_mg": "number"}, '
            '"category": "string", "ingredients_text": "string or null"}\n\n'
            "RULES:\n"
            "- Every field inside \"per_serving\" is a required number — "
            "never null. If the research wasn't precise on a figure, give a "
            "realistic estimate. Only use 0 if the true value really is ~0 — "
            "not as a placeholder for \"unknown\".\n"
            "- Leave \"brand\" null unless a specific brand/chain is clearly "
            "identified.\n"
            "- Set \"macros_basis\" to exactly \"serving\" (never \"100g\").\n"
            f"- \"category\" must be one of exactly these ids: {_CATEGORY_IDS}.\n\n"
            f"Research:\n{research_text}"
        )

    def ai_food_lookup(self, query: str) -> FoodItem | None:
        """Grounded Gemini lookup for a free-text restaurant/menu/brand query —
        the same workflow the user does manually via Gemini "AI mode" search
        today. Returns None when the model can't confidently identify the
        item — caller treats that like resolve_barcode() returning None (a
        404, not an error)."""
        if self.s.use_stubs or not self.s.gemini_api_key:
            return FoodItem(
                name=f"Stubbed AI result for '{query}' (no Gemini key)",
                per_serving=Macros(cal=350, protein=20, carbs=30, fat=15,
                                   sugar_g=5, fiber_g=3, sat_fat_g=4, sodium_mg=600),
                source="ai", serving_size="1 serving (estimate)",
                macros_basis="serving", category="prepared",
            )
        research_resp = self._generate_response(self._food_research_prompt(query), grounded=True)
        research_text = (research_resp.text or "").strip()

        text = self._generate(self._food_format_prompt(research_text), smart=False, grounded=False)
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:]
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValueError(f"AI returned malformed food JSON: {e}") from e
        if "error" in data:
            return None
        # Defensive: never trust the model for these — force regardless of
        # what it returned, since a wrong value here breaks downstream UI
        # (e.g. an invalid category silently hides the item from Pantry).
        data["source"] = "ai"
        data["barcode"] = None
        data["macros_basis"] = "serving"
        if data.get("category") not in _CATEGORY_IDS.split(", "):
            data["category"] = "other"
        # Never let the model write its own image URL (hallucination-prone) —
        # derive it deterministically from the real pages step 1's grounding
        # actually visited.
        data["image_url"] = self._resolve_grounding_image(research_resp)
        return FoodItem(**data)

    # ---------- Workout coach (floating-button nudge) ----------
    def workout_nudge_prompt_parts(self, generic_override: str = "") -> tuple[str, str]:
        generic = generic_override.strip() or (
            "You are an encouraging workout coach for a muscle-gain app. Based on "
            "the JSON context, write ONE short message reacting to whichever is "
            "most relevant: an in-progress workout, this week's progress, or "
            "what's coming up next. Mostly encouraging, but include light "
            "constructive feedback if the data calls for it (e.g. skipped days, "
            "dropping reps/weight). 1-2 casual sentences, speak directly to the "
            "user (\"you\"), no markdown, no preamble."
        )
        # {Workout_context} is a display placeholder, not sent to Gemini as-is —
        # workout_nudge() substitutes the real context JSON in right before
        # generating, same pattern as {Recent_workouts}/{Pantry_items} above.
        # The preview route shows the placeholder untouched, so the (potentially
        # long) raw JSON dump never needs to be shown to the user.
        return generic, "Context (JSON): {Workout_context}"

    def workout_nudge(self, context: dict, custom_note: str = "", generic_override: str = "") -> str:
        """Short reaction to the workout context JSON built by
        Store.get_workout_coach_context()."""
        if self.s.use_stubs or not self.s.gemini_api_key:
            return "[stubbed] Keep it up — set GEMINI_API_KEY for real coaching."
        generic, ctx = self.workout_nudge_prompt_parts(generic_override=generic_override)
        ctx = ctx.replace("{Workout_context}", json.dumps(context))
        return self._generate(self._assemble_prompt(generic, ctx, custom_note))
