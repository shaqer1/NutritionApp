"""All HTTP routes for the nutrition API."""
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import current_uid
from ..deps import coach_dep, resolver_dep, store_dep
from ..models import (
    Goals, InventoryItem, LogRequest, Profile, ScanRequest, TodaySummary,
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
def today(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return store.get_today_summary(uid)


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


# ---------- AI: recipes, grocery, coach ----------
@router.post("/recipes")
def recipes(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
            coach: Coach = Depends(coach_dep)):
    profile = store.get_profile(uid)
    summary = store.get_today_summary(uid)
    text = coach.recipes(
        store.list_inventory(uid), summary.remaining,
        profile.dietary_prefs if profile else [],
        profile.allergies if profile else [])
    return {"recipes": text}


@router.post("/grocery")
def grocery(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
            coach: Coach = Depends(coach_dep), days: int = Body(7, embed=True)):
    goals = store.get_goals(uid)
    profile = store.get_profile(uid)
    if not goals:
        raise HTTPException(400, "Set goals first")
    text = coach.grocery(store.list_inventory(uid), goals,
                         profile.dietary_prefs if profile else [], days)
    return {"grocery_list": text}


@router.post("/coach")
def run_coach(uid: str = Depends(current_uid), store: Store = Depends(store_dep),
              coach: Coach = Depends(coach_dep),
              meal: str = Body("dinner", embed=True),
              time_label: str = Body("evening", embed=True)):
    """Meal-time checkpoint. Called by Cloud Scheduler or the app."""
    summary = store.get_today_summary(uid)
    tip = coach.nudge(summary, store.list_inventory(uid), meal, time_label)
    if tip:
        store.add_coach_message(uid, tip, "nudge")
        store.sync_summary_to_sheet(uid)
    return {"nudge": tip, "on_track": tip is None}


@router.get("/coach/messages")
def coach_messages(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return {"messages": store.list_coach_messages(uid)}


# ---------- Summary sync (read by workout app if using HTTP variant) ----------
@router.get("/summary")
def summary(uid: str = Depends(current_uid), store: Store = Depends(store_dep)):
    return store.get_today_summary(uid)
