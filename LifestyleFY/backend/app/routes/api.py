"""All HTTP routes for the nutrition API."""
from datetime import date as date_type
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import current_roles, current_uid, require_ai_prompt_admin
from ..deps import coach_dep, exercisedb_dep, resolver_dep, store_dep
from ..models import (
    AiPrompts, CloneDayRequest, CloneWeekRequest, CustomExerciseRequest, ExerciseCacheFilters,
    ExerciseCacheOptions, ExerciseCacheSearchResult, ExerciseDetails, ExerciseSearchResultItem,
    ExerciseSwapRequest, FoodItem, Goals, GroceryList, InventoryItem, LogRequest, Profile, Recipe,
    ScanRequest, SystemPrompts, TodaySummary, WorkoutDay, WorkoutDaySummary, WorkoutOverview,
    WorkoutPlanUpdateRequest, WorkoutProgress, WorkoutSessionLogRequest, WorkoutSetLogRequest,
    WorkoutWeekOverview,
)
from ..services.coach import Coach, compute_goals, next_goal
from ..services.exercisedb import ExerciseDbClient
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


@router.post("/food/ai-search")
def ai_food_search(query: str = Body(..., embed=True), uid: str = Depends(current_uid),
                   coach: Coach = Depends(coach_dep)) -> dict[str, FoodItem]:
    if not query.strip():
        raise HTTPException(400, "Query is required")
    try:
        item = coach.ai_food_lookup(query)
    except ValueError as e:
        raise HTTPException(502, f"AI lookup failed: {e}") from e
    if item is None:
        raise HTTPException(404, {"message": "AI couldn't confidently identify that item", "query": query})
    return {"item": item}


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
    sys_prompts = store.get_system_prompts()
    today = datetime.now(timezone.utc).date()
    recent_workouts = store.get_workout_day_summaries(uid, limit=3)
    try:
        recipe = coach.suggest_recipe(
            store.list_inventory(uid),
            profile.dietary_prefs if profile else [],
            profile.allergies if profile else [],
            meal_period, summary.remaining, today, recent_workouts=recent_workouts,
            custom_note=prompts.recipe, message=message, generic_override=sys_prompts.recipe)
    except ValueError as e:
        raise HTTPException(502, f"Recipe generation failed: {e}") from e
    return {"recipe": recipe}


@router.post("/recipes/suggest/preview")
def suggest_recipe_preview(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                           coach: Coach = Depends(coach_dep),
                           meal_period: str = Body("lunch", embed=True)):
    profile = store.get_profile(uid)
    summary = store.get_today_summary(uid)
    today = datetime.now(timezone.utc).date()
    generic, context = coach.recipe_prompt_parts(
        store.list_inventory(uid),
        profile.dietary_prefs if profile else [],
        profile.allergies if profile else [],
        meal_period, summary.remaining, today,
        generic_override=store.get_system_prompts().recipe)
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
    today = day or datetime.now(timezone.utc).date()
    history = store.weekly_macro_history(uid, today)
    recent_workouts = store.get_workout_day_summaries(uid, limit=3)
    try:
        grocery_list = coach.grocery(store.list_inventory(uid), goals,
                             profile.dietary_prefs if profile else [], days, history, today,
                             recent_workouts=recent_workouts,
                             custom_note=prompts.grocery, message=message,
                             generic_override=store.get_system_prompts().grocery)
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
    today = day or datetime.now(timezone.utc).date()
    history = store.weekly_macro_history(uid, today)
    generic, context = coach.grocery_prompt_parts(
        store.list_inventory(uid), goals, profile.dietary_prefs if profile else [], days, history, today,
        generic_override=store.get_system_prompts().grocery)
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
    recent_workouts = store.get_workout_day_summaries(uid, limit=3)
    try:
        tip = coach.nudge(summary, store.list_inventory(uid), log_entries, meal, time_label, day,
                          recent_workouts=recent_workouts, custom_note=prompts.nudge, message=message,
                          generic_override=store.get_system_prompts().nudge)
    except ValueError as e:
        raise HTTPException(502, f"Coach nudge failed: {e}") from e
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
                                                log_entries, meal, time_label, day,
                                                generic_override=store.get_system_prompts().nudge)
    return {"generic": generic, "context": context, "custom_note": store.get_ai_prompts(uid).nudge}


@router.get("/coach/messages")
def coach_messages(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"messages": store.list_coach_messages(uid)}


# ---------- AI prompts: per-category standing note (editable by anyone) ----------
@router.get("/ai-prompts")
def get_ai_prompts(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"prompts": store.get_ai_prompts(uid)}


@router.put("/ai-prompts")
def set_ai_prompts(prompts: AiPrompts, uid: str = Depends(current_uid),
                   store: Store = Depends(store_dep)):
    store.set_ai_prompts(uid, prompts)
    return {"ok": True}


# ---------- AI system prompts: shared "generic" instructions (admin-editable) ----------
# Global, not per-user — this is the base instruction template every user's
# calls build on, distinct from AiPrompts' per-user standing note above.
@router.get("/ai-system-prompts")
def get_ai_system_prompts(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                          roles: dict = Depends(current_roles)):
    return {"prompts": store.get_system_prompts(), "roles": roles}


@router.put("/ai-system-prompts")
def set_ai_system_prompts(prompts: SystemPrompts, store: Store = Depends(store_dep),
                          _admin: None = Depends(require_ai_prompt_admin)):
    store.set_system_prompts(prompts)
    return {"ok": True}


# ---------- Workout ----------
@router.get("/workout/config")
def get_workout_config(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"config": store.get_workout_config(uid)}


@router.put("/workout/config")
def set_workout_config(current_week: int = Body(..., embed=True),
                       uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    store.set_workout_current_week(uid, current_week)
    return {"ok": True}


@router.post("/workout/plan/initialize")
def initialize_workout_plan(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    """Copies the shared starter plan into a brand-new user's own workout_plan
    collection. No-ops (returns initialized: false) if they already have one,
    so this is always safe to call — never overwrites existing data."""
    return {"initialized": store.initialize_workout_plan(uid)}


@router.get("/workout/weeks/{week}/overview", response_model=WorkoutWeekOverview)
def workout_week_overview(week: int, uid: str = Depends(current_uid),
                          store: Store = Depends(store_dep)):
    return store.get_week_overview(uid, week)


@router.get("/workout/weeks/{week}/load-overview", response_model=WorkoutOverview)
def workout_load_overview(week: int, uid: str = Depends(current_uid),
                          store: Store = Depends(store_dep)):
    return store.get_workout_overview(uid, week)


@router.get("/workout/weeks/{week}/days/{day}", response_model=WorkoutDay)
def workout_day(week: int, day: str, uid: str = Depends(current_uid),
                store: Store = Depends(store_dep)):
    return store.get_workout_day(uid, week, day)


@router.post("/workout/sets")
def post_workout_set(req: WorkoutSetLogRequest, uid: str = Depends(current_uid),
                     store: Store = Depends(store_dep)):
    store.log_workout_set(uid, req)
    return {"ok": True}


@router.get("/workout/sets")
def get_workout_sets(week: int, day: str, uid: str = Depends(current_uid),
                     store: Store = Depends(store_dep)):
    return {"sets": store.get_workout_log_state(uid, week, day)}


@router.delete("/workout/sets")
def delete_workout_set(week: int, day: str, exercise: str, set_num: int,
                       uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    store.delete_workout_set(uid, week, day, exercise, set_num)
    return {"ok": True}


@router.post("/workout/sessions")
def post_workout_session(req: WorkoutSessionLogRequest, uid: str = Depends(current_uid),
                         store: Store = Depends(store_dep)):
    store.log_workout_session(uid, req)
    return {"ok": True}


@router.get("/workout/progress", response_model=WorkoutProgress)
def workout_progress(week_min: int | None = None, week_max: int | None = None,
                     uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return store.get_workout_progress(uid, week_min=week_min, week_max=week_max)


@router.get("/workout/day-summaries")
def workout_day_summaries(date: date_type | None = None, limit: int | None = None,
                          uid: str = Depends(current_uid), store: Store = Depends(store_dep)
                          ) -> dict[str, list[WorkoutDaySummary]]:
    """Session + set rows grouped by day — date filters to one day (Overview's
    "today's workouts" section), limit caps most-recent-first (AI context)."""
    return {"days": store.get_workout_day_summaries(
        uid, date_filter=date.isoformat() if date else None, limit=limit)}


@router.post("/workout/nudge")
def workout_nudge(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                  coach: Coach = Depends(coach_dep)):
    """Encouragement/feedback for the floating Workout Coach button — context
    built entirely server-side, tunable via the user's standing note."""
    today = datetime.now(timezone.utc).date()
    context = store.get_workout_coach_context(uid, today)
    custom_note = store.get_ai_prompts(uid).workout
    try:
        message = coach.workout_nudge(context, custom_note=custom_note,
                                      generic_override=store.get_system_prompts().workout)
    except ValueError as e:
        raise HTTPException(502, f"Workout nudge failed: {e}") from e
    return {"message": message}


@router.post("/workout/nudge/preview")
def workout_nudge_preview(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                          coach: Coach = Depends(coach_dep)):
    generic, ctx = coach.workout_nudge_prompt_parts(generic_override=store.get_system_prompts().workout)
    return {"generic": generic, "context": ctx, "custom_note": store.get_ai_prompts(uid).workout}


# ---------- Workout: Phase 2 (plan editing, cache browsing, ExerciseDB) ----------

async def _ensure_exercise_cached(store: Store, exercisedb: ExerciseDbClient,
                                  exercise_id: str) -> ExerciseDetails | None:
    """Cache-aside: return the cached record if we have one, otherwise fetch
    it live from ExerciseDB and persist it so it's never fetched twice."""
    details = store.get_exercise_details(exercise_id)
    if details:
        return details
    raw = await exercisedb.get_details(exercise_id)
    if not raw:
        return None
    store.upsert_exercise_cache(exercise_id, {
        "name": raw.get("name", ""), "image_url": raw.get("imageUrl", ""),
        "image_urls": raw.get("imageUrls") or {},
        "equipments": raw.get("equipments") or [], "body_parts": raw.get("bodyParts") or [],
        "exercise_type": raw.get("exerciseType", ""),
        "target_muscles": raw.get("targetMuscles") or [],
        "secondary_muscles": raw.get("secondaryMuscles") or [],
        "video_url": raw.get("videoUrl", ""), "keywords": raw.get("keywords") or [],
        "overview": raw.get("overview", ""), "instructions": raw.get("instructions") or [],
        "exercise_tips": raw.get("exerciseTips") or [], "variations": raw.get("variations") or [],
        "related_exercise_ids": raw.get("relatedExerciseIds") or [],
    })
    return store.get_exercise_details(exercise_id)


@router.put("/workout/plan/{plan_id}")
def update_workout_plan_exercise(plan_id: str, req: WorkoutPlanUpdateRequest,
                                 uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    ex = store.update_workout_plan_exercise(uid, plan_id, req)
    if ex is None:
        raise HTTPException(404, "Exercise not found.")
    return {"exercise": ex}


@router.post("/workout/plan/clone-day")
def clone_workout_day(req: CloneDayRequest, uid: str = Depends(current_uid),
                      store: Store = Depends(store_dep)):
    return store.clone_workout_day(uid, req)


@router.post("/workout/plan/clone-week")
def clone_workout_week(req: CloneWeekRequest, uid: str = Depends(current_uid),
                       store: Store = Depends(store_dep)):
    return store.clone_workout_week(uid, req)


@router.get("/workout/exercise-cache/options", response_model=ExerciseCacheOptions)
def exercise_cache_options(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return store.get_exercise_cache_options()


@router.post("/workout/exercise-cache/search", response_model=ExerciseCacheSearchResult)
def exercise_cache_search(filters: ExerciseCacheFilters, uid: str = Depends(current_uid),
                          store: Store = Depends(store_dep)):
    return store.search_exercise_cache(filters)


@router.post("/workout/plan/{plan_id}/custom-exercise")
def save_custom_exercise(plan_id: str, req: CustomExerciseRequest,
                         uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    ex = store.save_custom_exercise(uid, plan_id, req)
    if ex is None:
        raise HTTPException(404, "Exercise not found.")
    return {"exercise": ex}


@router.get("/workout/exercises/search")
async def search_workout_exercises(q: str, uid: str = Depends(current_uid),
                                   store: Store = Depends(store_dep),
                                   exercisedb: ExerciseDbClient = Depends(exercisedb_dep)):
    results = await exercisedb.search(q)
    decorated = store.decorate_search_results(results)
    return {"results": [
        ExerciseSearchResultItem(
            exercise_id=r["exerciseId"], name=r["name"], image_url=r["imageUrl"],
            equipments=r["equipments"], body_parts=r["body_parts"],
            exercise_type=r["exercise_type"])
        for r in decorated
    ]}


@router.get("/workout/exercises/{exercise_id}", response_model=ExerciseDetails)
async def get_workout_exercise_details(exercise_id: str, uid: str = Depends(current_uid),
                                       store: Store = Depends(store_dep),
                                       exercisedb: ExerciseDbClient = Depends(exercisedb_dep)):
    details = await _ensure_exercise_cached(store, exercisedb, exercise_id)
    if details is None:
        raise HTTPException(404, "Exercise details not found.")
    return details


@router.put("/workout/plan/{plan_id}/exercise-selection")
async def swap_workout_exercise(plan_id: str, req: ExerciseSwapRequest,
                                uid: str = Depends(current_uid), store: Store = Depends(store_dep),
                                exercisedb: ExerciseDbClient = Depends(exercisedb_dep)):
    details = await _ensure_exercise_cached(store, exercisedb, req.new_exercise_id)
    if details is None:
        raise HTTPException(404, "Could not resolve the new exercise.")
    ex = store.update_exercise_selection(uid, plan_id, req.new_exercise_id)
    if ex is None:
        raise HTTPException(404, "Exercise not found.")
    return {"exercise": ex}


# ---------- Summary sync (read by workout app if using HTTP variant) ----------
@router.get("/summary")
def summary(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return store.get_today_summary(uid)
