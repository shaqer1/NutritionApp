"""All HTTP routes for the nutrition API."""
from datetime import date as date_type
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import current_uid
from ..deps import coach_dep, resolver_dep, store_dep
from ..models import (
    AiPrompts, Goals, GroceryList, InventoryItem, LogRequest, Profile, Recipe, ScanRequest,
    TodaySummary,
)
from ..services.coach import Coach, compute_goals, next_goal
from ..services.food import FoodResolver
from ..services.store import Store

router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True}


# ---------- Scanning & search ----------
@router.post("/scan")
async def scan(req: ScanRequest, uid: str = Depends(current_uid),
               resolver: FoodResolver = Depends(resolver_dep),
               store: Store = Depends(store_dep)):
    item, source = await resolver.resolve_barcode(req.barcode)
    store.record_scan(uid, req.barcode, source,
                      item.name if item else None, item is not None)
    if not item:
        raise HTTPException(404, {"message": "Not found — enter manually",
                                  "barcode": req.barcode})
    return {"item": item, "source": source}


@router.get("/search")
async def search(q: str, uid: str = Depends(current_uid),
                 resolver: FoodResolver = Depends(resolver_dep)):
    return {"results": await resolver.search(q)}


@router.get("/product/{barcode}/raw")
async def raw_product(barcode: str, uid: str = Depends(current_uid),
                      resolver: FoodResolver = Depends(resolver_dep)):
    return {"product": await resolver.raw_product(barcode)}


# ---------- Inventory ----------
@router.get("/inventory")
def list_inventory(uid: str = Depends(current_uid),
                   store: Store = Depends(store_dep)):
    return {"items": store.list_inventory(uid)}


@router.post("/inventory")
def add_inventory(item: InventoryItem, uid: str = Depends(current_uid),
                  store: Store = Depends(store_dep)):
    return {"item": store.add_inventory(uid, item)}


@router.delete("/inventory/{item_id}")
def delete_inventory(item_id: str, uid: str = Depends(current_uid),
                     store: Store = Depends(store_dep)):
    store.delete_inventory(uid, item_id)
    return {"ok": True}


# ---------- Logging & today ----------
@router.post("/log", response_model=TodaySummary)
def log_meal(req: LogRequest, uid: str = Depends(current_uid),
             store: Store = Depends(store_dep)):
    summary = store.log_meal(uid, req)
    store.sync_summary_to_sheet(uid)
    return summary


@router.get("/today", response_model=TodaySummary)
def today(date: date_type | None = None, uid: str = Depends(current_uid),
         store: Store = Depends(store_dep)):
    # date should be the client's local calendar day (see list_log's docstring
    # for why) — defaulting to UTC here is only a fallback for callers that
    # omit it.
    return store.get_today_summary(uid, date or datetime.now(timezone.utc).date())


@router.get("/log")
def get_log(date: date_type | None = None, uid: str = Depends(current_uid),
           store: Store = Depends(store_dep)):
    # Default to today in UTC, matching how `ts` is stored (store.py:_now()) —
    # naive local time would disagree with the stored UTC date near midnight.
    return {"entries": store.list_log(uid, date or datetime.now(timezone.utc).date())}


@router.put("/log/{log_id}", response_model=TodaySummary)
def edit_log_entry(log_id: str, req: LogRequest, uid: str = Depends(current_uid),
                   store: Store = Depends(store_dep)):
    """Corrects a previously logged entry's own data (name/meal/servings/macros).
    Never touches any linked inventory item — editing a log mistake doesn't
    re-adjust pantry stock."""
    log_date = req.log_date or datetime.now(timezone.utc).date()
    summary = store.update_log_entry(uid, log_id, log_date, req)
    store.sync_summary_to_sheet(uid)
    return summary


@router.delete("/log/{log_id}", response_model=TodaySummary)
def delete_log_entry(log_id: str, day: date_type | None = None,
                     uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    log_date = day or datetime.now(timezone.utc).date()
    summary = store.delete_log_entry(uid, log_id, log_date)
    store.sync_summary_to_sheet(uid)
    return summary


# ---------- Profile & goals ----------
@router.get("/profile")
def get_profile(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"profile": store.get_profile(uid)}


@router.put("/profile")
def set_profile(profile: Profile, uid: str = Depends(current_uid),
                store: Store = Depends(store_dep)):
    store.set_profile(uid, profile)
    return {"ok": True}


@router.get("/goals")
def get_goals(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"goals": store.get_goals(uid)}


@router.put("/goals")
def set_goals(goals: Goals, uid: str = Depends(current_uid),
              store: Store = Depends(store_dep)):
    store.set_goals(uid, goals, reason="manual set")
    return {"ok": True}


@router.post("/goals/suggest")
def suggest_goals(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                  phase: str = Body("bulk", embed=True),
                  target_weight_lb: float | None = Body(None, embed=True)):
    profile = store.get_profile(uid)
    if not profile:
        raise HTTPException(400, "Set your profile first")
    goals = compute_goals(profile, phase=phase, target_weight_lb=target_weight_lb)
    store.set_goals(uid, goals, reason=f"ai suggest ({phase})")
    return {"goals": goals}


@router.post("/goals/next")
def advance_goal(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    profile = store.get_profile(uid)
    current = store.get_goals(uid)
    if not (profile and current):
        raise HTTPException(400, "Need profile + current goal")
    goals = next_goal(current, profile)
    store.set_goals(uid, goals, reason="next goal after reaching target")
    return {"goals": goals}


# ---------- Recipes: AI-suggested draft, then explicit save/list/delete ----------
@router.post("/recipes/suggest")
def suggest_recipe(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                   coach: Coach = Depends(coach_dep),
                   meal_period: str = Body("lunch", embed=True),
                   message: str = Body("", embed=True)):
    profile = store.get_profile(uid)
    summary = store.get_today_summary(uid)
    prompts = store.get_ai_prompts(uid)
    try:
        recipe = coach.suggest_recipe(
            store.list_inventory(uid),
            profile.dietary_prefs if profile else [],
            profile.allergies if profile else [],
            meal_period, summary.remaining, custom_note=prompts.recipe, message=message)
    except ValueError as e:
        raise HTTPException(502, f"Recipe generation failed: {e}") from e
    return {"recipe": recipe}


@router.post("/recipes/suggest/preview")
def suggest_recipe_preview(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                           coach: Coach = Depends(coach_dep),
                           meal_period: str = Body("lunch", embed=True)):
    profile = store.get_profile(uid)
    summary = store.get_today_summary(uid)
    generic, context = coach.recipe_prompt_parts(
        store.list_inventory(uid),
        profile.dietary_prefs if profile else [],
        profile.allergies if profile else [],
        meal_period, summary.remaining)
    return {"generic": generic, "context": context, "custom_note": store.get_ai_prompts(uid).recipe}


@router.post("/recipes")
def save_recipe(recipe: Recipe, uid: str = Depends(current_uid),
                store: Store = Depends(store_dep)):
    return {"recipe": store.save_recipe(uid, recipe)}


@router.get("/recipes")
def list_recipes(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"recipes": store.list_recipes(uid)}


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: str, uid: str = Depends(current_uid),
                  store: Store = Depends(store_dep)):
    store.delete_recipe(uid, recipe_id)
    return {"ok": True}


# ---------- AI: grocery, coach ----------


@router.post("/grocery")
def grocery(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
            coach: Coach = Depends(coach_dep), days: int = Body(7, embed=True),
            day: date_type | None = Body(None, embed=True),
            message: str = Body("", embed=True)):
    goals = store.get_goals(uid)
    profile = store.get_profile(uid)
    if not goals:
        raise HTTPException(400, "Set goals first")
    prompts = store.get_ai_prompts(uid)
    history = store.weekly_macro_history(uid, day or datetime.now(timezone.utc).date())
    try:
        grocery_list = coach.grocery(store.list_inventory(uid), goals,
                             profile.dietary_prefs if profile else [], days, history,
                             custom_note=prompts.grocery, message=message)
    except ValueError as e:
        raise HTTPException(502, f"Grocery list generation failed: {e}") from e
    return {"grocery_list": grocery_list}


@router.post("/grocery-lists")
def save_grocery_list(gl: GroceryList, uid: str = Depends(current_uid),
                      store: Store = Depends(store_dep)):
    return {"grocery_list": store.save_grocery_list(uid, gl)}


@router.get("/grocery-lists")
def list_grocery_lists(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"grocery_lists": store.list_grocery_lists(uid)}


@router.delete("/grocery-lists/{grocery_list_id}")
def delete_grocery_list(grocery_list_id: str, uid: str = Depends(current_uid),
                        store: Store = Depends(store_dep)):
    store.delete_grocery_list(uid, grocery_list_id)
    return {"ok": True}


@router.post("/grocery/preview")
def grocery_preview(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                    coach: Coach = Depends(coach_dep), days: int = Body(7, embed=True),
                    day: date_type | None = Body(None, embed=True)):
    goals = store.get_goals(uid)
    profile = store.get_profile(uid)
    if not goals:
        raise HTTPException(400, "Set goals first")
    history = store.weekly_macro_history(uid, day or datetime.now(timezone.utc).date())
    generic, context = coach.grocery_prompt_parts(
        store.list_inventory(uid), goals, profile.dietary_prefs if profile else [], days, history)
    return {"generic": generic, "context": context, "custom_note": store.get_ai_prompts(uid).grocery}


@router.post("/coach")
def run_coach(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
              coach: Coach = Depends(coach_dep),
              meal: str = Body("dinner", embed=True),
              time_label: str = Body("evening", embed=True),
              day: date_type | None = Body(None, embed=True),
              message: str = Body("", embed=True)):
    """Meal-time checkpoint, triggered by the "Am I on track?" button."""
    day = day or datetime.now(timezone.utc).date()
    summary = store.get_today_summary(uid, day)
    log_entries = store.list_log(uid, day)
    prompts = store.get_ai_prompts(uid)
    tip = coach.nudge(summary, store.list_inventory(uid), log_entries, meal, time_label,
                      custom_note=prompts.nudge, message=message)
    if tip:
        store.add_coach_message(uid, tip, "nudge")
        store.sync_summary_to_sheet(uid)
    return {"nudge": tip, "on_track": tip is None}


@router.post("/coach/preview")
def coach_preview(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                  coach: Coach = Depends(coach_dep),
                  meal: str = Body("dinner", embed=True),
                  time_label: str = Body("evening", embed=True),
                  day: date_type | None = Body(None, embed=True)):
    day = day or datetime.now(timezone.utc).date()
    summary = store.get_today_summary(uid, day)
    log_entries = store.list_log(uid, day)
    generic, context = coach.nudge_prompt_parts(summary, store.list_inventory(uid),
                                                log_entries, meal, time_label)
    return {"generic": generic, "context": context, "custom_note": store.get_ai_prompts(uid).nudge}


@router.get("/coach/messages")
def coach_messages(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"messages": store.list_coach_messages(uid)}


# ---------- AI prompts: per-category standing note ----------
@router.get("/ai-prompts")
def get_ai_prompts(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"prompts": store.get_ai_prompts(uid)}


@router.put("/ai-prompts")
def set_ai_prompts(prompts: AiPrompts, uid: str = Depends(current_uid),
                   store: Store = Depends(store_dep)):
    store.set_ai_prompts(uid, prompts)
    return {"ok": True}


# ---------- Summary sync (read by workout app if using HTTP variant) ----------
@router.get("/summary")
def summary(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return store.get_today_summary(uid)
