"""Persistence layer: Firestore (hot state) + BigQuery (append-only history).

Every meal log writes to BOTH: BigQuery `food_log` (history) and Firestore
`today_summary` (recomputed). When USE_STUBS is set, everything is held in
process memory so the API runs offline with no GCP calls.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from ..config import Settings
from ..models import (
    AdminUser, AiPrompts, CloneDayRequest, CloneWeekRequest, CustomExerciseRequest,
    ExerciseCacheFilters, ExerciseCacheItem, ExerciseCacheOptions, ExerciseCacheSearchResult,
    ExerciseDetails, Goals, GroceryList, InventoryItem, LogEntry, LogRequest, Macros,
    NotificationPrefs, OverviewDay, OverviewExercise, PlanExercise, Profile, Recipe, SystemPrompts,
    TodaySummary, WorkoutConfig, WorkoutDay, WorkoutDaySummary, WorkoutPlanUpdateRequest,
    WorkoutProgress, WorkoutSessionLogRequest, WorkoutSetEntry, WorkoutSetLogRequest,
    WorkoutSetSummary, WorkoutSession, WorkoutWeekOverview, WorkoutOverview,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


_LOAD_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _parse_load_number(s: str) -> float | None:
    m = _LOAD_NUM_RE.search(s or "")
    return float(m.group()) if m else None


log = logging.getLogger(__name__)


class Store:
    def __init__(self, settings: Settings):
        self.s = settings
        self.stub = settings.use_stubs
        if self.stub:
            # In-memory mirrors of Firestore docs + BigQuery rows.
            self._profiles: dict[str, dict] = {}
            self._ai_prompts: dict[str, dict] = {}
            self._system_prompts: dict = {}
            self._access: dict = {"allowed_emails": [], "roles": {}}
            self._goals: dict[str, dict] = {}
            self._inventory: dict[str, dict[str, dict]] = {}
            self._recipes: dict[str, dict[str, dict]] = {}
            self._grocery_lists: dict[str, dict[str, dict]] = {}
            self._today: dict[str, dict] = {}
            self._coach: dict[str, list[dict]] = {}
            self._barcode_cache: dict[str, dict] = {}
            self._food_log: list[dict] = []
            self._scans: list[dict] = []
            self._workout_config: dict[str, dict] = {}
            self._workout_plan: dict[str, dict[str, dict]] = {}
            self._exercise_cache: dict[str, dict] = {}
            self._workout_sets: list[dict] = []
            self._workout_sessions: list[dict] = []
            self._workout_plan_template: dict[str, dict] = {}
            self._device_tokens: dict[str, dict[str, dict]] = {}
            self._notification_prefs: dict[str, dict] = {}
        else:
            from google.cloud import bigquery, firestore

            self._fs = firestore.Client(project=settings.gcp_project)
            self._bq = bigquery.Client(project=settings.gcp_project)

    # ---------- Firestore helpers ----------
    def _user_doc(self, uid: str):
        return self._fs.collection("users").document(uid)

    # ---------- Profile ----------
    def get_profile(self, uid: str) -> Profile | None:
        if self.stub:
            data = self._profiles.get(uid)
            return Profile(**data) if data else None
        snap = self._user_doc(uid).collection("meta").document("profile").get()
        return Profile(**snap.to_dict()) if snap.exists else None

    def set_profile(self, uid: str, profile: Profile) -> None:
        data = profile.model_dump()
        data["updated_at"] = _now().isoformat()
        if self.stub:
            self._profiles[uid] = data
            return
        self._user_doc(uid).collection("meta").document("profile").set(data)

    # ---------- AI prompts (per-category standing note) ----------
    def get_ai_prompts(self, uid: str) -> AiPrompts:
        if self.stub:
            data = self._ai_prompts.get(uid)
            return AiPrompts(**data) if data else AiPrompts()
        snap = self._user_doc(uid).collection("meta").document("ai_prompts").get()
        return AiPrompts(**snap.to_dict()) if snap.exists else AiPrompts()

    def set_ai_prompts(self, uid: str, prompts: AiPrompts) -> None:
        data = prompts.model_dump()
        data["updated_at"] = _now().isoformat()
        if self.stub:
            self._ai_prompts[uid] = data
            return
        self._user_doc(uid).collection("meta").document("ai_prompts").set(data)

    # ---------- AI system prompts (global, admin-editable "generic" override) ----------
    def get_system_prompts(self) -> SystemPrompts:
        if self.stub:
            return SystemPrompts(**self._system_prompts) if self._system_prompts else SystemPrompts()
        snap = self._fs.collection("config").document("ai_system_prompts").get()
        return SystemPrompts(**snap.to_dict()) if snap.exists else SystemPrompts()

    def set_system_prompts(self, prompts: SystemPrompts) -> None:
        data = prompts.model_dump()
        data["updated_at"] = _now().isoformat()
        if self.stub:
            self._system_prompts = data
            return
        self._fs.collection("config").document("ai_system_prompts").set(data)

    # ---------- Admin: allowed-users + roles (config/access doc) ----------
    # Same doc auth.py's allowlist cache reads (60s TTL there) — a write here
    # can take up to a minute to affect sign-in/role checks, same as editing
    # the doc directly via the Firebase Console.
    def _access_doc_data(self) -> dict:
        if self.stub:
            return self._access
        snap = self._fs.collection("config").document("access").get()
        return snap.to_dict() or {}

    def list_allowed_users(self) -> list[AdminUser]:
        data = self._access_doc_data()
        emails = data.get("allowed_emails", [])
        roles = data.get("roles", {})
        return [
            AdminUser(email=e, isAiAdmin=roles.get(e, {}).get("isAiAdmin", False),
                     isAppAdmin=roles.get(e, {}).get("isAppAdmin", False))
            for e in emails
        ]

    def add_allowed_user(self, email: str) -> None:
        if self.stub:
            emails = self._access.setdefault("allowed_emails", [])
            if email not in emails:
                emails.append(email)
            return
        from google.cloud import firestore

        ref = self._fs.collection("config").document("access")
        ref.set({"allowed_emails": firestore.ArrayUnion([email])}, merge=True)

    def set_user_roles(self, email: str, is_ai_admin: bool, is_app_admin: bool) -> None:
        if self.stub:
            self._access.setdefault("roles", {})[email] = {
                "isAiAdmin": is_ai_admin, "isAppAdmin": is_app_admin,
            }
            return
        ref = self._fs.collection("config").document("access")
        ref.set({"roles": {email: {"isAiAdmin": is_ai_admin, "isAppAdmin": is_app_admin}}}, merge=True)

    # ---------- Goals ----------
    def get_goals(self, uid: str) -> Goals | None:
        if self.stub:
            data = self._goals.get(uid)
            return Goals(**data) if data else None
        snap = self._user_doc(uid).collection("goals").document("current").get()
        return Goals(**snap.to_dict()) if snap.exists else None

    def set_goals(self, uid: str, goals: Goals, reason: str = "") -> None:
        data = goals.model_dump()
        created = _now()
        data["created_at"] = created.isoformat()
        if self.stub:
            self._goals[uid] = data
        else:
            self._user_doc(uid).collection("goals").document("current").set(data)
        # Append to BigQuery goal_history.
        self._bq_insert(
            "goal_history",
            [{
                "uid": uid, "created_at": created.isoformat(),
                "calories": goals.calories, "protein_g": goals.protein_g,
                "carbs_g": goals.carbs_g, "fat_g": goals.fat_g,
                "target_weight_lb": goals.target_weight_lb, "phase": goals.phase,
                "reason": reason,
            }],
        )

    # ---------- Inventory ----------
    def list_inventory(self, uid: str) -> list[InventoryItem]:
        if self.stub:
            return [InventoryItem(**v) for v in self._inventory.get(uid, {}).values()]
        docs = self._user_doc(uid).collection("inventory").stream()
        out = []
        for d in docs:
            item = d.to_dict()
            item["item_id"] = d.id
            out.append(InventoryItem(**item))
        return out

    def add_inventory(self, uid: str, item: InventoryItem) -> InventoryItem:
        item.item_id = item.item_id or uuid.uuid4().hex
        if item.initial_qty is None:
            item.initial_qty = item.qty
        data = item.model_dump()
        data["added_at"] = _now().isoformat()
        if self.stub:
            self._inventory.setdefault(uid, {})[item.item_id] = data
            return item
        self._user_doc(uid).collection("inventory").document(item.item_id).set(data)
        return item

    def delete_inventory(self, uid: str, item_id: str) -> None:
        if self.stub:
            self._inventory.get(uid, {}).pop(item_id, None)
            return
        self._user_doc(uid).collection("inventory").document(item_id).delete()

    # ---------- Recipes ----------
    def list_recipes(self, uid: str) -> list[Recipe]:
        if self.stub:
            return [Recipe(**v) for v in self._recipes.get(uid, {}).values()]
        docs = self._user_doc(uid).collection("recipes").stream()
        out = []
        for d in docs:
            r = d.to_dict()
            r["recipe_id"] = d.id
            out.append(Recipe(**r))
        return out

    def save_recipe(self, uid: str, recipe: Recipe) -> Recipe:
        recipe.recipe_id = recipe.recipe_id or uuid.uuid4().hex
        if recipe.created_at is None:
            recipe.created_at = _now()
        data = recipe.model_dump(mode="json")
        if self.stub:
            self._recipes.setdefault(uid, {})[recipe.recipe_id] = data
            return recipe
        self._user_doc(uid).collection("recipes").document(recipe.recipe_id).set(data)
        return recipe

    def delete_recipe(self, uid: str, recipe_id: str) -> None:
        if self.stub:
            self._recipes.get(uid, {}).pop(recipe_id, None)
            return
        self._user_doc(uid).collection("recipes").document(recipe_id).delete()

    # ---------- Grocery lists ----------
    def list_grocery_lists(self, uid: str) -> list[GroceryList]:
        if self.stub:
            return [GroceryList(**v) for v in self._grocery_lists.get(uid, {}).values()]
        docs = self._user_doc(uid).collection("grocery_lists").stream()
        out = []
        for d in docs:
            gl = d.to_dict()
            gl["grocery_list_id"] = d.id
            out.append(GroceryList(**gl))
        return out

    def save_grocery_list(self, uid: str, gl: GroceryList) -> GroceryList:
        gl.grocery_list_id = gl.grocery_list_id or uuid.uuid4().hex
        if gl.created_at is None:
            gl.created_at = _now()
        data = gl.model_dump(mode="json")
        if self.stub:
            self._grocery_lists.setdefault(uid, {})[gl.grocery_list_id] = data
            return gl
        self._user_doc(uid).collection("grocery_lists").document(gl.grocery_list_id).set(data)
        return gl

    def delete_grocery_list(self, uid: str, grocery_list_id: str) -> None:
        if self.stub:
            self._grocery_lists.get(uid, {}).pop(grocery_list_id, None)
            return
        self._user_doc(uid).collection("grocery_lists").document(grocery_list_id).delete()

    def _decrement_inventory(self, uid: str, item_id: str, servings: float) -> None:
        """Best-effort: a missing/invalid item_id is a silent no-op, since meal
        logging must never fail because of a stale inventory reference."""
        if self.stub:
            data = self._inventory.get(uid, {}).get(item_id)
            if data:
                data["qty"] = max(0.0, data["qty"] - servings)
            return
        ref = self._user_doc(uid).collection("inventory").document(item_id)
        snap = ref.get()
        if snap.exists:
            new_qty = max(0.0, snap.to_dict().get("qty", 0) - servings)
            ref.update({"qty": new_qty})

    # ---------- Barcode cache (shared, top-level) ----------
    def cache_get(self, barcode: str) -> dict | None:
        if self.stub:
            return self._barcode_cache.get(barcode)
        snap = self._fs.collection("barcode_cache").document(barcode).get()
        return snap.to_dict() if snap.exists else None

    def cache_put(self, barcode: str, payload: dict) -> None:
        payload = {**payload, "cached_at": _now().isoformat()}
        if self.stub:
            self._barcode_cache[barcode] = payload
            return
        self._fs.collection("barcode_cache").document(barcode).set(payload)

    # ---------- Meal logging ----------
    def log_meal(self, uid: str, req: LogRequest) -> TodaySummary:
        ts = req.ts or _now()
        log_date = req.log_date or ts.date()
        row = {
            "log_id": uuid.uuid4().hex, "uid": uid, "ts": ts.isoformat(),
            "log_date": log_date.isoformat(),
            "meal": req.meal, "meal_instance": req.meal_instance,
            "item_name": req.item_name, "barcode": req.barcode,
            "source": req.source, "servings": req.servings,
            "calories": req.macros.cal * req.servings,
            "protein_g": req.macros.protein * req.servings,
            "carbs_g": req.macros.carbs * req.servings,
            "fat_g": req.macros.fat * req.servings,
            "sugar_g": req.macros.sugar_g * req.servings,
            "fiber_g": req.macros.fiber_g * req.servings,
            "sat_fat_g": req.macros.sat_fat_g * req.servings,
            "sodium_mg": req.macros.sodium_mg * req.servings,
            "from_inventory": req.from_inventory,
            "grams": req.grams,
        }
        self._bq_insert("food_log", [row])
        if self.stub:
            self._food_log.append(row)
        if req.inventory_item_id:
            self._decrement_inventory(uid, req.inventory_item_id, req.servings)
        return self.recompute_today_summary(uid, day=log_date)

    def record_scan(self, uid: str, barcode: str, matched_source: str,
                    product_name: str | None, success: bool) -> None:
        row = {
            "scan_id": uuid.uuid4().hex, "uid": uid, "ts": _now().isoformat(),
            "barcode": barcode, "matched_source": matched_source,
            "product_name": product_name, "success": success,
        }
        self._bq_insert("scans", [row])
        if self.stub:
            self._scans.append(row)

    # ---------- Today summary ----------
    def _today_rows(self, uid: str, day: date) -> list[dict]:
        """Filters by the `log_date` column (client's local calendar day), not
        DATE(ts) — see list_log's docstring for why: `ts` is a UTC instant, so
        bucketing by its date silently disagrees with the user's local "today"
        near a midnight-UTC boundary. This previously used DATE(ts) and was
        the source of a real bug (the Today tab dropping same-local-day
        entries logged before ~7pm CDT, once UTC had already rolled over)."""
        day_iso = day.isoformat()
        if self.stub:
            return [r for r in self._food_log
                    if r["uid"] == uid and r.get("log_date", r["ts"][:10]) == day_iso]
        q = f"""
            SELECT meal, meal_instance, calories, protein_g, carbs_g, fat_g,
                   sugar_g, fiber_g, sat_fat_g, sodium_mg
            FROM `{self.s.gcp_project}.{self.s.bq_dataset}.food_log`
            WHERE uid=@uid AND log_date=@day
        """
        from google.cloud import bigquery
        job = self._bq.query(q, job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("uid", "STRING", uid),
                bigquery.ScalarQueryParameter("day", "STRING", day_iso),
            ]))
        return [dict(r) for r in job.result()]

    def list_log(self, uid: str, day: date) -> list[LogEntry]:
        """Itemized food_log rows for a given date (unlike recompute_today_summary,
        which only returns the aggregate). Powers the Log view's meal groupings.

        Filters by the `log_date` column (the client's local calendar day),
        not DATE(ts) — `ts` is a UTC instant, so bucketing by its date would
        silently disagree with the user's local "today" near a midnight-UTC
        boundary (confirmed live: 7pm CDT is already the next day in UTC)."""
        day_iso = day.isoformat()
        if self.stub:
            rows = [r for r in self._food_log
                    if r["uid"] == uid and r.get("log_date", r["ts"][:10]) == day_iso]
        else:
            q = f"""
                SELECT log_id, item_name, barcode, meal, meal_instance, servings,
                       calories, protein_g, carbs_g, fat_g,
                       sugar_g, fiber_g, sat_fat_g, sodium_mg, grams, ts
                FROM `{self.s.gcp_project}.{self.s.bq_dataset}.food_log`
                WHERE uid=@uid AND log_date=@day
                ORDER BY ts
            """
            from google.cloud import bigquery
            job = self._bq.query(q, job_config=bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("uid", "STRING", uid),
                    bigquery.ScalarQueryParameter("day", "STRING", day_iso),
                ]))
            rows = [dict(r) for r in job.result()]
        return [
            LogEntry(
                log_id=r.get("log_id"),
                item_name=r["item_name"], barcode=r.get("barcode"),
                meal=r["meal"], meal_instance=r.get("meal_instance") or 1,
                servings=r["servings"], grams=r.get("grams"), ts=r["ts"],
                macros=Macros(
                    cal=r["calories"] or 0, protein=r["protein_g"] or 0,
                    carbs=r["carbs_g"] or 0, fat=r["fat_g"] or 0,
                    sugar_g=r.get("sugar_g") or 0, fiber_g=r.get("fiber_g") or 0,
                    sat_fat_g=r.get("sat_fat_g") or 0, sodium_mg=r.get("sodium_mg") or 0,
                ),
            )
            for r in rows
        ]

    def update_log_entry(self, uid: str, log_id: str, log_date: date, req: LogRequest) -> TodaySummary:
        """Edits a food_log row in place (name/meal/servings/macros/grams) — the
        row's `log_id` and `ts` are preserved. Deliberately doesn't touch any
        linked inventory item's qty: this only corrects the log's own data."""
        fields = {
            "meal": req.meal, "meal_instance": req.meal_instance,
            "item_name": req.item_name, "barcode": req.barcode, "source": req.source,
            "servings": req.servings,
            "calories": req.macros.cal * req.servings,
            "protein_g": req.macros.protein * req.servings,
            "carbs_g": req.macros.carbs * req.servings,
            "fat_g": req.macros.fat * req.servings,
            "sugar_g": req.macros.sugar_g * req.servings,
            "fiber_g": req.macros.fiber_g * req.servings,
            "sat_fat_g": req.macros.sat_fat_g * req.servings,
            "sodium_mg": req.macros.sodium_mg * req.servings,
            "grams": req.grams,
        }
        if self.stub:
            for row in self._food_log:
                if row["uid"] == uid and row["log_id"] == log_id:
                    row.update(fields)
                    break
        else:
            from google.cloud import bigquery
            q = f"""
                UPDATE `{self.s.gcp_project}.{self.s.bq_dataset}.food_log`
                SET meal=@meal, meal_instance=@meal_instance, item_name=@item_name,
                    barcode=@barcode, source=@source, servings=@servings,
                    calories=@calories, protein_g=@protein_g, carbs_g=@carbs_g,
                    fat_g=@fat_g, sugar_g=@sugar_g, fiber_g=@fiber_g,
                    sat_fat_g=@sat_fat_g, sodium_mg=@sodium_mg, grams=@grams
                WHERE uid=@uid AND log_id=@log_id
            """
            params = [bigquery.ScalarQueryParameter("uid", "STRING", uid),
                      bigquery.ScalarQueryParameter("log_id", "STRING", log_id)]
            type_map = {"meal_instance": "INT64", "meal": "STRING", "item_name": "STRING",
                        "barcode": "STRING", "source": "STRING"}
            for key, val in fields.items():
                bq_type = type_map.get(key, "FLOAT64")
                params.append(bigquery.ScalarQueryParameter(key, bq_type, val))
            self._bq.query(q, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
        return self.recompute_today_summary(uid, day=log_date)

    def delete_log_entry(self, uid: str, log_id: str, log_date: date) -> TodaySummary:
        """Removes a food_log row outright. Same as update_log_entry, this never
        touches inventory — deleting a mistaken log entry doesn't restock it."""
        if self.stub:
            self._food_log = [r for r in self._food_log
                               if not (r["uid"] == uid and r["log_id"] == log_id)]
        else:
            from google.cloud import bigquery
            q = f"""
                DELETE FROM `{self.s.gcp_project}.{self.s.bq_dataset}.food_log`
                WHERE uid=@uid AND log_id=@log_id
            """
            self._bq.query(q, job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("uid", "STRING", uid),
                bigquery.ScalarQueryParameter("log_id", "STRING", log_id),
            ])).result()
        return self.recompute_today_summary(uid, day=log_date)

    def recompute_today_summary(self, uid: str, day: date | None = None,
                                coach_tip: str | None = None) -> TodaySummary:
        day = day or _now().date()
        rows = self._today_rows(uid, day)
        # Distinct (meal, meal_instance) sittings, not one per logged item —
        # e.g. a lunch with 3 ingredients logged separately is still 1 meal.
        meals_logged = len({(r.get("meal"), r.get("meal_instance") or 1) for r in rows})
        consumed = Macros(
            cal=sum(r["calories"] or 0 for r in rows),
            protein=sum(r["protein_g"] or 0 for r in rows),
            carbs=sum(r["carbs_g"] or 0 for r in rows),
            fat=sum(r["fat_g"] or 0 for r in rows),
            sugar_g=sum(r.get("sugar_g") or 0 for r in rows),
            fiber_g=sum(r.get("fiber_g") or 0 for r in rows),
            sat_fat_g=sum(r.get("sat_fat_g") or 0 for r in rows),
            sodium_mg=sum(r.get("sodium_mg") or 0 for r in rows),
        )
        goals = self.get_goals(uid)
        if goals:
            remaining = Macros(
                cal=max(goals.calories - consumed.cal, 0),
                protein=max(goals.protein_g - consumed.protein, 0),
                carbs=max(goals.carbs_g - consumed.carbs, 0),
                fat=max(goals.fat_g - consumed.fat, 0),
            )
            pct = min(consumed.cal / goals.calories, 1.0) if goals.calories else 0.0
        else:
            remaining = Macros()
            pct = 0.0

        summary = TodaySummary(
            date=day, consumed=consumed, remaining=remaining,
            meals_logged=meals_logged, pct_to_goal=round(pct, 3),
            goals=goals, coach_tip=coach_tip,
        )
        doc = summary.model_dump(mode="json")
        doc["last_updated"] = _now().isoformat()
        if self.stub:
            existing = self._today.get(uid, {})
            if coach_tip is None:
                doc["coach_tip"] = existing.get("coach_tip")
            self._today[uid] = doc
        else:
            ref = self._user_doc(uid).collection("meta").document("today_summary")
            if coach_tip is None:
                prev = ref.get()
                if prev.exists:
                    doc["coach_tip"] = prev.to_dict().get("coach_tip")
            ref.set(doc)
        return TodaySummary(**{k: doc[k] for k in
                               ("date", "consumed", "remaining", "meals_logged",
                                "pct_to_goal", "goals", "coach_tip")})

    def get_today_summary(self, uid: str, day: date | None = None) -> TodaySummary:
        return self.recompute_today_summary(uid, day=day)

    def weekly_macro_history(self, uid: str, end_day: date, days: int = 7) -> list[dict]:
        """Oldest-first daily consumed totals for the AI grocery prompt. Reuses
        `_today_rows` (already bucketed by the client-local `log_date` column)
        once per day — no new BigQuery query shape, no migration. Known
        tradeoff: up to `days` sequential queries per call; acceptable for a
        single-user app."""
        out = []
        for i in range(days - 1, -1, -1):
            day = end_day - timedelta(days=i)
            rows = self._today_rows(uid, day)
            out.append({
                "date": day.isoformat(),
                "consumed": Macros(
                    cal=sum(r["calories"] or 0 for r in rows),
                    protein=sum(r["protein_g"] or 0 for r in rows),
                    carbs=sum(r["carbs_g"] or 0 for r in rows),
                    fat=sum(r["fat_g"] or 0 for r in rows),
                ),
            })
        return out

    # ---------- Coach messages ----------
    def add_coach_message(self, uid: str, text: str, mtype: str) -> None:
        msg = {"text": text, "type": mtype,
               "created_at": _now().isoformat(), "read": False}
        if self.stub:
            self._coach.setdefault(uid, []).insert(0, msg)
            self._today.setdefault(uid, {})["coach_tip"] = text
            return
        self._user_doc(uid).collection("coach_messages").add(msg)
        self._user_doc(uid).collection("meta").document("today_summary").set(
            {"coach_tip": text}, merge=True)

    def list_coach_messages(self, uid: str, limit: int = 10) -> list[dict]:
        if self.stub:
            return self._coach.get(uid, [])[:limit]
        docs = (self._user_doc(uid).collection("coach_messages")
                .order_by("created_at", direction="DESCENDING").limit(limit).stream())
        return [d.to_dict() for d in docs]

    # ---------- Device tokens (web push) ----------
    def add_device_token(self, uid: str, token: str, platform: str = "web") -> None:
        data = {"token": token, "platform": platform, "updated_at": _now().isoformat()}
        if self.stub:
            self._device_tokens.setdefault(uid, {})[token] = data
            return
        self._user_doc(uid).collection("device_tokens").document(token).set(data)

    def list_device_tokens(self, uid: str) -> list[str]:
        if self.stub:
            return list(self._device_tokens.get(uid, {}).keys())
        docs = self._user_doc(uid).collection("device_tokens").stream()
        return [d.id for d in docs]

    def remove_device_token(self, uid: str, token: str) -> None:
        if self.stub:
            self._device_tokens.get(uid, {}).pop(token, None)
            return
        self._user_doc(uid).collection("device_tokens").document(token).delete()

    def remove_all_device_tokens(self, uid: str) -> None:
        if self.stub:
            self._device_tokens.pop(uid, None)
            return
        for d in self._user_doc(uid).collection("device_tokens").stream():
            d.reference.delete()

    # ---------- Notification prefs (per-user opt-in, default all off) ----------
    def get_notification_prefs(self, uid: str) -> NotificationPrefs:
        if self.stub:
            data = self._notification_prefs.get(uid)
            return NotificationPrefs(**data) if data else NotificationPrefs()
        snap = self._user_doc(uid).collection("notification_prefs").document("settings").get()
        return NotificationPrefs(**snap.to_dict()) if snap.exists else NotificationPrefs()

    def set_notification_prefs(self, uid: str, prefs: NotificationPrefs) -> None:
        data = prefs.model_dump()
        if self.stub:
            self._notification_prefs[uid] = data
            return
        self._user_doc(uid).collection("notification_prefs").document("settings").set(data)

    def list_opted_in_uids(self, kind: str, meal: str | None = None) -> list[str]:
        """uids opted into `kind` ("coach" or "meal", with `meal` required for
        the latter) — a single collection-group query across every user's
        notification_prefs/settings doc, so scheduled push jobs don't need
        one Firestore read per user."""
        field = "coach_nudges" if kind == "coach" else f"meals.{meal}"
        if self.stub:
            out = []
            for uid, data in self._notification_prefs.items():
                prefs = NotificationPrefs(**data)
                opted_in = prefs.coach_nudges if kind == "coach" else getattr(prefs.meals, meal or "", False)
                if opted_in:
                    out.append(uid)
            return out
        docs = (self._fs.collection_group("notification_prefs")
                .where(field, "==", True).stream())
        return [d.reference.parent.parent.id for d in docs]

    def uids_with_meal_logged_today(self, meal: str, day: date | None = None) -> set[str]:
        """uids that already have a `food_log` row for `meal` on `day` (default
        today) — one batched BigQuery query, not one lookup per user."""
        day = day or _now().date()
        day_iso = day.isoformat()
        if self.stub:
            return {r["uid"] for r in self._food_log
                    if r.get("log_date", r["ts"][:10]) == day_iso and r.get("meal") == meal}
        q = f"""
            SELECT DISTINCT uid
            FROM `{self.s.gcp_project}.{self.s.bq_dataset}.food_log`
            WHERE log_date=@day AND meal=@meal
        """
        from google.cloud import bigquery
        job = self._bq.query(q, job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("day", "STRING", day_iso),
                bigquery.ScalarQueryParameter("meal", "STRING", meal),
            ]))
        return {r["uid"] for r in job.result()}

    # ---------- BigQuery insert helper ----------
    def _bq_insert(self, table: str, rows: list[dict]) -> None:
        if self.stub:
            return  # stub mirrors are updated by callers where needed
        table_id = f"{self.s.gcp_project}.{self.s.bq_dataset}.{table}"
        errors = self._bq.insert_rows_json(table_id, rows)
        if errors:
            raise RuntimeError(f"BigQuery insert into {table} failed: {errors}")

    # ---------- Workout: config ----------
    def get_workout_config(self, uid: str) -> WorkoutConfig:
        if self.stub:
            data = self._workout_config.get(uid)
            return WorkoutConfig(**data) if data else WorkoutConfig()
        snap = self._user_doc(uid).collection("meta").document("workout_config").get()
        return WorkoutConfig(**snap.to_dict()) if snap.exists else WorkoutConfig()

    def set_workout_current_week(self, uid: str, week: int) -> None:
        if self.stub:
            cfg = self._workout_config.get(uid, {})
            cfg["current_week"] = week
            self._workout_config[uid] = cfg
            return
        self._user_doc(uid).collection("meta").document("workout_config").set(
            {"current_week": week}, merge=True)

    # ---------- Workout: plan (hot, editable state) ----------
    @staticmethod
    def _plan_id(week: int, day: str, section: str, order) -> str:
        """Deterministic key mirroring how the old Apps Script app looked rows
        up by position (week+day+section+order) — needed so a future edit/
        clone endpoint can upsert by this same key instead of a random id."""
        safe_day = re.sub(r"[^a-zA-Z0-9]", "_", str(day))
        safe_section = re.sub(r"[^a-zA-Z0-9]", "_", str(section))
        return f"{week}_{safe_day}_{safe_section}_{order}"

    def _workout_plan_rows(self, uid: str) -> list[dict]:
        """All plan rows for this user across every week — small collection
        (~400 rows total for a 10-week program), so callers filter in Python
        rather than needing a Firestore composite index, matching how
        list_inventory/list_recipes stream a whole collection."""
        if self.stub:
            rows = []
            for plan_id, row in self._workout_plan.get(uid, {}).items():
                rows.append({**row, "plan_id": plan_id})
            return rows
        docs = self._user_doc(uid).collection("workout_plan").stream()
        out = []
        for d in docs:
            row = d.to_dict()
            row["plan_id"] = d.id
            out.append(row)
        return out

    def _get_exercise_cache_entry(self, exercise_id: str) -> dict | None:
        if self.stub:
            return self._exercise_cache.get(exercise_id)
        snap = self._fs.collection("exercise_cache").document(exercise_id).get()
        return snap.to_dict() if snap.exists else None

    def _get_workout_plan_row(self, uid: str, plan_id: str) -> dict | None:
        if self.stub:
            row = self._workout_plan.get(uid, {}).get(plan_id)
            return dict(row) if row else None
        snap = self._user_doc(uid).collection("workout_plan").document(plan_id).get()
        return snap.to_dict() if snap.exists else None

    def _save_workout_plan_row(self, uid: str, plan_id: str, data: dict) -> None:
        if self.stub:
            self._workout_plan.setdefault(uid, {})[plan_id] = data
            return
        self._user_doc(uid).collection("workout_plan").document(plan_id).set(data)

    def _workout_plan_template_rows(self) -> list[dict]:
        """Shared (not per-user) starter plan — seeded once from an existing
        user's workout_plan — that initialize_workout_plan() copies into a
        brand-new user's own collection."""
        if self.stub:
            return [{**row, "plan_id": plan_id}
                    for plan_id, row in self._workout_plan_template.items()]
        docs = self._fs.collection("workout_plan_template").stream()
        return [{**d.to_dict(), "plan_id": d.id} for d in docs]

    def has_workout_plan(self, uid: str) -> bool:
        return bool(self._workout_plan_rows(uid))

    def initialize_workout_plan(self, uid: str) -> bool:
        """Copies the shared template plan into uid's own workout_plan
        collection — only if they don't already have one, so an existing
        plan (including a partially-customized one) is never overwritten.
        Batched (a full program is ~650 rows) — one .set() per row would take
        minutes given per-call network latency; Firestore batches commit in
        one round-trip per chunk of up to 500 writes."""
        if self.has_workout_plan(uid):
            return False
        template_rows = self._workout_plan_template_rows()
        if self.stub:
            for row in template_rows:
                plan_id = row.pop("plan_id")
                self._save_workout_plan_row(uid, plan_id, row)
            return True

        collection = self._user_doc(uid).collection("workout_plan")
        batch = self._fs.batch()
        pending = 0
        for row in template_rows:
            plan_id = row.pop("plan_id")
            batch.set(collection.document(plan_id), row)
            pending += 1
            if pending == 400:  # stay well under Firestore's 500-write batch limit
                batch.commit()
                batch = self._fs.batch()
                pending = 0
        if pending:
            batch.commit()
        return True

    def _plan_exercise_from_row(self, r: dict, cache_entry: dict | None = None) -> PlanExercise:
        eid = r.get("exercise_id")
        c = cache_entry if cache_entry is not None else (
            self._get_exercise_cache_entry(eid) if eid else None)
        c = c or {}
        return PlanExercise(
            plan_id=r.get("plan_id"), week=r["week"], day=r["day"], phase=r.get("phase", ""),
            section=r["section"], order=r["order"], exercise=r["exercise"],
            sets=r.get("sets", ""), reps=r.get("reps", ""), weight=r.get("weight", ""),
            tempo=r.get("tempo", ""), rest=r.get("rest", ""),
            video_url=c.get("video_url") or r.get("video_url", ""), exercise_id=eid,
            notes=r.get("notes", ""), category=r.get("category", ""),
            is_custom=bool(r.get("is_custom")),
            image_url=c.get("image_url"), overview=c.get("overview"),
            instructions=c.get("instructions") or [],
            target_muscles=c.get("target_muscles") or [],
            equipments=c.get("equipments") or [],
            exercise_tips=c.get("exercise_tips") or [],
            variations=c.get("variations") or [],
            related_exercise_ids=c.get("related_exercise_ids") or [],
        )

    def get_week_overview(self, uid: str, week: int) -> WorkoutWeekOverview:
        days: list[str] = []
        seen: set[str] = set()
        for r in self._workout_plan_rows(uid):
            if r["week"] == week and r["day"] not in seen:
                seen.add(r["day"])
                days.append(r["day"])
        completed: set[str] = set()
        for row in self._workout_session_rows(uid, week=week):
            completed.add(row["day_name"])
        for row in self._workout_set_rows(uid, week=week):
            completed.add(row["day"])
        return WorkoutWeekOverview(days=days, completed_days=sorted(completed))

    def get_workout_day(self, uid: str, week: int, day: str) -> WorkoutDay:
        plan_rows = [r for r in self._workout_plan_rows(uid)
                     if r["week"] == week and r["day"] == day]
        plan_rows.sort(key=lambda r: (r["section"], int(r["order"])))

        cache: dict[str, dict] = {}
        for r in plan_rows:
            eid = r.get("exercise_id")
            if eid and eid not in cache:
                cache[eid] = self._get_exercise_cache_entry(eid) or {}

        section_key = {"Warm-Up": "warmup", "Strength": "strength", "Cool-Down": "cooldown"}
        buckets: dict[str, list[PlanExercise]] = {"warmup": [], "strength": [], "cooldown": []}
        phase = ""
        for r in plan_rows:
            ex = self._plan_exercise_from_row(r, cache.get(r.get("exercise_id") or ""))
            key = section_key.get(r["section"])
            if key:
                buckets[key].append(ex)
            phase = phase or r.get("phase", "")
        return WorkoutDay(warmup=buckets["warmup"], strength=buckets["strength"],
                          cooldown=buckets["cooldown"], phase=phase)

    def _exercise_load_index(self, uid: str) -> dict[str, dict]:
        """Per-exercise load-so-far, aggregated from every logged set: best
        weight ever hit, and weight/reps from the most recently logged set
        (ts sorts correctly as an ISO string, matching how it's stored)."""
        idx: dict[str, dict] = {}
        for r in self._workout_set_rows(uid):
            ex = r["exercise"]
            e = idx.setdefault(ex, {
                "sets_logged": 0, "week_min": None, "week_max": None,
                "best_weight": None, "recent_weight": None, "recent_reps": None,
                "_recent_ts": "",
            })
            e["sets_logged"] += 1
            week = int(r["week"])
            e["week_min"] = week if e["week_min"] is None else min(e["week_min"], week)
            e["week_max"] = week if e["week_max"] is None else max(e["week_max"], week)

            weight = _parse_load_number(r.get("weight", ""))
            if weight is not None and (e["best_weight"] is None or weight > e["best_weight"]):
                e["best_weight"] = weight

            ts = r.get("ts", "")
            if ts >= e["_recent_ts"]:
                e["_recent_ts"] = ts
                e["recent_weight"] = weight
                e["recent_reps"] = _parse_load_number(r.get("actual_reps", ""))
        for e in idx.values():
            del e["_recent_ts"]
        return idx

    def get_workout_overview(self, uid: str, week: int) -> WorkoutOverview:
        week_rows = [r for r in self._workout_plan_rows(uid) if r["week"] == week]
        days: list[str] = []
        seen: set[str] = set()
        for r in week_rows:
            if r["day"] not in seen:
                seen.add(r["day"])
                days.append(r["day"])

        load_idx = self._exercise_load_index(uid)
        out_days = []
        for day in days:
            rows = sorted([r for r in week_rows if r["day"] == day],
                          key=lambda r: (r["section"], int(r["order"])))
            exercises = [
                OverviewExercise(
                    order=int(r["order"]), section=r["section"], exercise=r["exercise"],
                    category=r.get("category", ""), sets=r.get("sets", ""),
                    reps=r.get("reps", ""),
                    **load_idx.get(r["exercise"], {}),
                )
                for r in rows
            ]
            out_days.append(OverviewDay(day=day, exercises=exercises))
        return WorkoutOverview(week=week, days=out_days)

    def update_workout_plan_exercise(self, uid: str, plan_id: str,
                                     req: WorkoutPlanUpdateRequest) -> PlanExercise | None:
        row = self._get_workout_plan_row(uid, plan_id)
        if row is None:
            return None
        row.update(req.model_dump(exclude_none=True))
        self._save_workout_plan_row(uid, plan_id, row)
        return self._plan_exercise_from_row({**row, "plan_id": plan_id})

    def clone_workout_day(self, uid: str, req: CloneDayRequest) -> dict:
        new_day_name = req.new_day_name.strip()
        if not new_day_name:
            return {"success": False, "message": "New day name is required."}
        week_rows = [r for r in self._workout_plan_rows(uid) if r["week"] == req.week]
        if any(r["day"] == new_day_name for r in week_rows):
            return {"success": False,
                   "message": f'A day named "{new_day_name}" already exists in Week {req.week}.'}
        source_rows = [r for r in week_rows if r["day"] == req.source_day]
        if not source_rows:
            return {"success": False,
                   "message": f'Source day "{req.source_day}" not found in Week {req.week}.'}
        for r in source_rows:
            new_row = {k: v for k, v in r.items() if k != "plan_id"}
            new_row["day"] = new_day_name
            new_plan_id = self._plan_id(req.week, new_day_name, new_row["section"], new_row["order"])
            self._save_workout_plan_row(uid, new_plan_id, new_row)
        return {"success": True,
               "message": f'Cloned {len(source_rows)} exercises to "{new_day_name}".'}

    def clone_workout_week(self, uid: str, req: CloneWeekRequest) -> dict:
        rows = self._workout_plan_rows(uid)
        source_rows = [r for r in rows if r["week"] == req.source_week]
        if not source_rows:
            return {"success": False, "message": f"No exercises found for Week {req.source_week}."}
        new_week = max((r["week"] for r in rows), default=0) + 1
        for r in source_rows:
            new_row = {k: v for k, v in r.items() if k != "plan_id"}
            new_row["week"] = new_week
            new_plan_id = self._plan_id(new_week, new_row["day"], new_row["section"], new_row["order"])
            self._save_workout_plan_row(uid, new_plan_id, new_row)
        return {"success": True, "new_week": new_week,
               "message": f"Successfully cloned Week {req.source_week} to Week {new_week} "
                          f"({len(source_rows)} exercises)."}

    # ---------- Workout: exercise cache (shared, top-level collection) ----------
    _CACHE_PAGE_SIZE = 10

    def _exercise_cache_rows(self) -> list[dict]:
        """All cached exercises, global (not per-user) — small enough
        (~1,500 rows) to stream + filter in Python, same tradeoff as
        _workout_plan_rows."""
        if self.stub:
            return [{**row, "exercise_id": eid} for eid, row in self._exercise_cache.items()]
        docs = self._fs.collection("exercise_cache").stream()
        out = []
        for d in docs:
            row = d.to_dict()
            row["exercise_id"] = d.id
            out.append(row)
        return out

    def get_exercise_cache_options(self) -> ExerciseCacheOptions:
        equipments: set[str] = set()
        body_parts: set[str] = set()
        exercise_type: set[str] = set()
        target_muscles: set[str] = set()
        secondary_muscles: set[str] = set()
        keywords: set[str] = set()
        total = 0
        for r in self._exercise_cache_rows():
            if not r.get("exercise_id"):
                continue
            total += 1
            equipments.update(x for x in (r.get("equipments") or []) if x)
            body_parts.update(x for x in (r.get("body_parts") or []) if x)
            target_muscles.update(x for x in (r.get("target_muscles") or []) if x)
            secondary_muscles.update(x for x in (r.get("secondary_muscles") or []) if x)
            keywords.update(x for x in (r.get("keywords") or []) if x)
            et = r.get("exercise_type")
            if et:
                exercise_type.add(et)
        return ExerciseCacheOptions(
            equipments=sorted(equipments), body_parts=sorted(body_parts),
            exercise_type=sorted(exercise_type), target_muscles=sorted(target_muscles),
            secondary_muscles=sorted(secondary_muscles), keywords=sorted(keywords), total=total,
        )

    def search_exercise_cache(self, filters: ExerciseCacheFilters) -> ExerciseCacheSearchResult:
        def norm(vals) -> set[str]:
            return {str(v).strip().lower() for v in vals if v}

        f_eq, f_bp, f_et = norm(filters.equipments), norm(filters.body_parts), norm(filters.exercise_type)
        f_tm, f_sm, f_kw = norm(filters.target_muscles), norm(filters.secondary_muscles), norm(filters.keywords)
        search_text = filters.search_text.strip().lower()

        def arr_match(row_vals, filt: set[str]) -> bool:
            if not filt:
                return True
            return bool(filt & {str(v).strip().lower() for v in (row_vals or [])})

        def str_match(val, filt: set[str]) -> bool:
            return not filt or str(val or "").strip().lower() in filt

        matched: list[ExerciseCacheItem] = []
        for r in self._exercise_cache_rows():
            eid = r.get("exercise_id")
            if not eid:
                continue
            name = str(r.get("name") or "")
            if search_text and search_text not in (name + " " + str(r.get("overview") or "")).lower():
                continue
            if not arr_match(r.get("equipments"), f_eq):
                continue
            if not arr_match(r.get("body_parts"), f_bp):
                continue
            if not str_match(r.get("exercise_type"), f_et):
                continue
            if not arr_match(r.get("target_muscles"), f_tm):
                continue
            if not arr_match(r.get("secondary_muscles"), f_sm):
                continue
            if not arr_match(r.get("keywords"), f_kw):
                continue
            matched.append(ExerciseCacheItem(
                exercise_id=eid, name=name, image_url=r.get("image_url") or "",
                equipments=r.get("equipments") or [], body_parts=r.get("body_parts") or [],
                exercise_type=r.get("exercise_type") or "", target_muscles=r.get("target_muscles") or [],
            ))

        total = len(matched)
        page = max(1, filters.page)
        total_pages = -(-total // self._CACHE_PAGE_SIZE) if total else 0
        start = (page - 1) * self._CACHE_PAGE_SIZE
        return ExerciseCacheSearchResult(
            items=matched[start:start + self._CACHE_PAGE_SIZE],
            total=total, page=page, total_pages=total_pages,
        )

    def _exercise_details_from_row(self, exercise_id: str, row: dict) -> ExerciseDetails:
        return ExerciseDetails(
            exercise_id=exercise_id, name=row.get("name", ""), image_url=row.get("image_url", ""),
            video_url=row.get("video_url", ""), overview=row.get("overview", ""),
            instructions=row.get("instructions") or [], exercise_tips=row.get("exercise_tips") or [],
            variations=row.get("variations") or [], target_muscles=row.get("target_muscles") or [],
            secondary_muscles=row.get("secondary_muscles") or [], equipments=row.get("equipments") or [],
            body_parts=row.get("body_parts") or [], exercise_type=row.get("exercise_type", ""),
            keywords=row.get("keywords") or [],
            related_exercise_ids=row.get("related_exercise_ids") or [],
        )

    def get_exercise_details(self, exercise_id: str) -> ExerciseDetails | None:
        """Cache-only lookup. Store has no async HTTP path, so a miss is the
        caller's (route's) job to resolve via a live ExerciseDB call and then
        persist with upsert_exercise_cache()."""
        row = self._get_exercise_cache_entry(exercise_id)
        if not row or not row.get("name"):
            return None
        return self._exercise_details_from_row(exercise_id, row)

    def decorate_search_results(self, items: list[dict]) -> list[dict]:
        """Cross-references live ExerciseDB search hits against the local
        cache (read-only, no live fetch) so a result already seen before
        shows its equipment/body-part/type immediately — a genuinely new
        result just comes back with those fields empty until "Info" is
        tapped. Mirrors the old app's decorateSearchResultsWithCachedInfo_."""
        out = []
        for it in items:
            eid = it.get("exerciseId", "")
            cached = (self._get_exercise_cache_entry(eid) if eid else None) or {}
            out.append({
                "exerciseId": eid, "name": it.get("name", ""), "imageUrl": it.get("imageUrl", ""),
                "equipments": cached.get("equipments") or [],
                "body_parts": cached.get("body_parts") or [],
                "exercise_type": cached.get("exercise_type") or "",
            })
        return out

    def upsert_exercise_cache(self, exercise_id: str, details: dict) -> None:
        """`details` uses the same snake_case keys as ExerciseDetails."""
        doc = {
            "name": details.get("name", ""), "image_url": details.get("image_url", ""),
            "image_urls": details.get("image_urls") or {},
            "equipments": details.get("equipments") or [],
            "body_parts": details.get("body_parts") or [],
            "exercise_type": details.get("exercise_type", ""),
            "target_muscles": details.get("target_muscles") or [],
            "secondary_muscles": details.get("secondary_muscles") or [],
            "video_url": details.get("video_url", ""), "keywords": details.get("keywords") or [],
            "overview": details.get("overview", ""),
            "instructions": details.get("instructions") or [],
            "exercise_tips": details.get("exercise_tips") or [],
            "variations": details.get("variations") or [],
            "related_exercise_ids": details.get("related_exercise_ids") or [],
            "is_custom": bool(details.get("is_custom")), "date_added": _now().isoformat(),
        }
        if self.stub:
            self._exercise_cache[exercise_id] = doc
            return
        self._fs.collection("exercise_cache").document(exercise_id).set(doc)

    def update_exercise_selection(self, uid: str, plan_id: str,
                                  new_exercise_id: str) -> PlanExercise | None:
        """Swap: points the plan row at a different exercise_id. Assumes the
        caller (route) has already ensured new_exercise_id is cached."""
        row = self._get_workout_plan_row(uid, plan_id)
        if row is None:
            return None
        row["exercise_id"] = new_exercise_id
        cache_entry = self._get_exercise_cache_entry(new_exercise_id) or {}
        if cache_entry.get("name"):
            row["exercise"] = cache_entry["name"]
        self._save_workout_plan_row(uid, plan_id, row)
        return self._plan_exercise_from_row({**row, "plan_id": plan_id})

    def save_custom_exercise(self, uid: str, plan_id: str,
                             req: CustomExerciseRequest) -> PlanExercise | None:
        row = self._get_workout_plan_row(uid, plan_id)
        if row is None:
            return None
        custom_id = f"customex_{plan_id}"
        self.upsert_exercise_cache(custom_id, {
            "name": req.name, "image_url": req.image_url, "video_url": req.video_url,
            "overview": req.overview, "instructions": req.instructions,
            "exercise_tips": req.exercise_tips, "variations": req.variations,
            "target_muscles": req.target_muscles, "secondary_muscles": req.secondary_muscles,
            "equipments": req.equipments, "body_parts": req.body_parts,
            "exercise_type": req.exercise_type, "keywords": req.keywords, "is_custom": True,
        })
        row["exercise_id"] = custom_id
        row["exercise"] = req.name
        row["is_custom"] = True
        self._save_workout_plan_row(uid, plan_id, row)
        return self._plan_exercise_from_row({**row, "plan_id": plan_id})

    # ---------- Workout: set + session logging (Firestore, append-mostly) ----------
    def log_workout_set(self, uid: str, req: WorkoutSetLogRequest) -> None:
        ts = req.ts or _now()
        log_date = req.log_date or ts.date()
        row = {
            "set_log_id": uuid.uuid4().hex, "uid": uid, "ts": ts.isoformat(),
            "log_date": log_date.isoformat(), "week": req.week, "day": req.day,
            "exercise": req.exercise, "set_num": req.set_num,
            "planned_reps": req.planned_reps, "actual_reps": req.actual_reps,
            "weight": req.weight, "notes": req.notes,
        }
        if self.stub:
            self._workout_sets.append(row)
        else:
            self._user_doc(uid).collection("workout_set_log").document(row["set_log_id"]).set(row)

    def delete_workout_set(self, uid: str, week: int, day: str, exercise: str,
                           set_num: int) -> None:
        """Removes logged rows for one set, un-checking it."""
        if self.stub:
            self._workout_sets = [
                r for r in self._workout_sets
                if not (r["uid"] == uid and int(r["week"]) == week and r["day"] == day
                        and r["exercise"] == exercise and int(r["set_num"]) == set_num)
            ]
        else:
            from google.cloud.firestore_v1.base_query import FieldFilter
            docs = (self._user_doc(uid).collection("workout_set_log")
                    .where(filter=FieldFilter("week", "==", week)).stream())
            for d in docs:
                r = d.to_dict()
                if (r["day"] == day and r["exercise"] == exercise
                        and int(r["set_num"]) == set_num):
                    d.reference.delete()

    def log_workout_session(self, uid: str, req: WorkoutSessionLogRequest) -> None:
        ts = req.ts or _now()
        log_date = req.log_date or ts.date()
        row = {
            "session_id": uuid.uuid4().hex, "uid": uid, "ts": ts.isoformat(),
            "log_date": log_date.isoformat(), "week": req.week, "day_name": req.day,
            "completed": True, "total_exercises": req.total_exercises,
            "notes": req.notes, "energy_level": req.energy_level,
        }
        if self.stub:
            self._workout_sessions.append(row)
        else:
            self._user_doc(uid).collection("workout_session_log").document(row["session_id"]).set(row)

    def _workout_set_rows(self, uid: str, week: int | None = None) -> list[dict]:
        if self.stub:
            rows = [r for r in self._workout_sets if r["uid"] == uid]
        else:
            q = self._user_doc(uid).collection("workout_set_log")
            if week is not None:
                from google.cloud.firestore_v1.base_query import FieldFilter
                q = q.where(filter=FieldFilter("week", "==", week))
            rows = [d.to_dict() for d in q.stream()]
        if week is not None:
            rows = [r for r in rows if int(r["week"]) == int(week)]
        return rows

    def _workout_session_rows(self, uid: str, week: int | None = None) -> list[dict]:
        if self.stub:
            rows = [r for r in self._workout_sessions if r["uid"] == uid]
        else:
            q = self._user_doc(uid).collection("workout_session_log")
            if week is not None:
                from google.cloud.firestore_v1.base_query import FieldFilter
                q = q.where(filter=FieldFilter("week", "==", week))
            rows = [d.to_dict() for d in q.stream()]
        if week is not None:
            rows = [r for r in rows if int(r["week"]) == int(week)]
        return rows

    def get_workout_log_state(self, uid: str, week: int, day: str) -> list[WorkoutSetEntry]:
        rows = [r for r in self._workout_set_rows(uid, week=week) if r["day"] == day]
        return [
            WorkoutSetEntry(
                exercise=r["exercise"], set_num=int(r["set_num"]),
                planned_reps=r.get("planned_reps") or "", actual_reps=r.get("actual_reps") or "",
                weight=r.get("weight") or "", notes=r.get("notes") or "",
            )
            for r in rows
        ]

    def get_workout_progress(self, uid: str, week_min: int | None = None,
                             week_max: int | None = None) -> WorkoutProgress:
        def in_range(week) -> bool:
            week = int(week)
            if week_min is not None and week < week_min:
                return False
            if week_max is not None and week > week_max:
                return False
            return True

        sessions = [r for r in self._workout_session_rows(uid) if in_range(r["week"])]
        sets = [r for r in self._workout_set_rows(uid) if in_range(r["week"])]

        by_key: dict[str, dict] = {}
        for r in sessions:
            key = f"{r.get('log_date', '')}|{r['week']}|{r['day_name']}"
            by_key[key] = {
                "date": r.get("log_date", ""), "week": str(r["week"]), "day": r["day_name"],
                "energy_level": r.get("energy_level", ""), "notes": r.get("notes", ""),
            }
        set_counts: dict[str, int] = {}
        for r in sets:
            key = f"{r.get('log_date', '')}|{r['week']}|{r['day']}"
            set_counts[key] = set_counts.get(key, 0) + 1
            if key not in by_key:
                by_key[key] = {"date": r.get("log_date", ""), "week": str(r["week"]),
                              "day": r["day"], "energy_level": "", "notes": ""}

        # Distinct planned (week, day) slots with at least one logged session —
        # dedupes repeat sessions on the same slot (e.g. redoing a workout on
        # a different date), so the progress bar reflects unique days done,
        # not raw session count. total_sessions (below) keeps counting every
        # instance, repeats included, for the "Sessions" stat card.
        distinct_days_completed = len({(r["week"], r["day"]) for r in by_key.values()})

        recent = sorted(by_key.values(), key=lambda r: r["date"], reverse=True)
        plan_day_keys = {(r["week"], r["day"]) for r in self._workout_plan_rows(uid)
                         if in_range(r["week"])}
        total_planned_days = len(plan_day_keys) or 40

        return WorkoutProgress(
            total_sessions=len(by_key), total_sets=len(sets),
            distinct_days_completed=distinct_days_completed,
            total_planned_days=total_planned_days,
            recent=[
                WorkoutSession(date=r["date"], week=r["week"], day=r["day"],
                              energy_level=r["energy_level"], notes=r["notes"])
                for r in recent[:5]
            ],
        )

    def get_workout_day_summaries(self, uid: str, date_filter: str | None = None,
                                  limit: int | None = None) -> list[WorkoutDaySummary]:
        """Groups session + set rows by (log_date, week, day) — used for the
        Overview "today's workouts" section (date_filter=today) and as AI
        prompt context (limit=3, most recent first)."""
        sessions = self._workout_session_rows(uid)
        sets = self._workout_set_rows(uid)

        by_key: dict[str, dict] = {}
        for r in sessions:
            key = f"{r.get('log_date', '')}|{r['week']}|{r['day_name']}"
            g = by_key.setdefault(key, {"date": r.get("log_date", ""), "week": str(r["week"]),
                                        "day": r["day_name"], "energy_level": "", "notes": "",
                                        "sets": []})
            g["energy_level"] = r.get("energy_level", "") or g["energy_level"]
            g["notes"] = r.get("notes", "") or g["notes"]
        for r in sets:
            key = f"{r.get('log_date', '')}|{r['week']}|{r['day']}"
            g = by_key.setdefault(key, {"date": r.get("log_date", ""), "week": str(r["week"]),
                                        "day": r["day"], "energy_level": "", "notes": "", "sets": []})
            g["sets"].append(WorkoutSetSummary(
                exercise=r["exercise"], set_num=int(r["set_num"]),
                reps=r.get("actual_reps") or r.get("planned_reps") or "",
                weight=r.get("weight") or "",
            ))

        groups = list(by_key.values())
        if date_filter is not None:
            groups = [g for g in groups if g["date"] == date_filter]
        groups.sort(key=lambda g: g["date"], reverse=True)
        if limit is not None:
            groups = groups[:limit]
        for g in groups:
            g["sets"].sort(key=lambda s: (s.exercise, s.set_num))
        return [WorkoutDaySummary(**g) for g in groups]

    @staticmethod
    def _collapse_sets_to_max(sets: list[WorkoutSetSummary]) -> list[dict]:
        """One entry per exercise with the max reps and max weight logged —
        independently, not necessarily from the same set. Mirrors the
        Overview tab's per-exercise collapsing (today.component.ts), done
        here in Python since this feeds the AI context, not the UI."""
        by_exercise: dict[str, list[WorkoutSetSummary]] = {}
        for s in sets:
            by_exercise.setdefault(s.exercise, []).append(s)

        def max_of(values: list[str]) -> str:
            best = values[0] if values else ""
            best_num = _parse_load_number(best)
            for v in values[1:]:
                n = _parse_load_number(v)
                if n is not None and (best_num is None or n > best_num):
                    best, best_num = v, n
            return best

        return [
            {"exercise": ex, "max_reps": max_of([s.reps for s in lst]),
             "max_weight": max_of([s.weight for s in lst])}
            for ex, lst in by_exercise.items()
        ]

    def _today_workout_status(self, uid: str, today: date) -> dict:
        """Derives "what's happening with today's workout" purely from
        log_date on set/session rows — the app has no other notion of which
        planned (week, day) "is" today, since workouts aren't calendar-bound."""
        today_iso = today.isoformat()
        empty = {"day": None, "week": None, "status": "no_workout_today",
                 "previous_exercise": None, "current_exercise": None, "next_exercise": None}

        sets_today = [r for r in self._workout_set_rows(uid) if r.get("log_date") == today_iso]
        sessions_today = [r for r in self._workout_session_rows(uid) if r.get("log_date") == today_iso]
        if not sets_today and not sessions_today:
            return empty

        candidates = sessions_today or sets_today
        week = int(candidates[0]["week"])
        day = candidates[0].get("day_name") or candidates[0].get("day")

        finished = any(int(r["week"]) == week and r.get("day_name") == day for r in sessions_today)
        if finished:
            return {"day": day, "week": week, "status": "completed",
                    "previous_exercise": None, "current_exercise": None, "next_exercise": None}

        logged_exercises = {r["exercise"] for r in sets_today
                            if r["day"] == day and int(r["week"]) == week}
        plan = self.get_workout_day(uid, week, day)
        order = [e.exercise for e in (plan.warmup + plan.strength + plan.cooldown)]

        current_idx = next((i for i, ex in enumerate(order) if ex not in logged_exercises), None)
        if current_idx is None:
            # every planned exercise has at least one set logged, but no finish yet
            return {"day": day, "week": week, "status": "in_progress",
                    "previous_exercise": order[-2] if len(order) > 1 else None,
                    "current_exercise": order[-1] if order else None, "next_exercise": None}
        return {
            "day": day, "week": week, "status": "in_progress",
            "previous_exercise": order[current_idx - 1] if current_idx > 0 else None,
            "current_exercise": order[current_idx],
            "next_exercise": order[current_idx + 1] if current_idx + 1 < len(order) else None,
        }

    def _upcoming_workouts(self, uid: str, current_week: int, limit: int = 6) -> list[dict]:
        """Next N planned (week, day) slots, in plan order, that have no
        session or set logged yet — each with its full exercise list."""
        plan_rows = self._workout_plan_rows(uid)
        seen_pairs: list[tuple[int, str]] = []
        seen_set: set[tuple[int, str]] = set()
        for r in sorted(plan_rows, key=lambda r: int(r["week"])):
            key = (int(r["week"]), r["day"])
            if key not in seen_set:
                seen_set.add(key)
                seen_pairs.append(key)

        done = {(int(r["week"]), r.get("day_name")) for r in self._workout_session_rows(uid)}
        done |= {(int(r["week"]), r["day"]) for r in self._workout_set_rows(uid)}

        upcoming_pairs = [(w, d) for (w, d) in seen_pairs
                          if w >= current_week and (w, d) not in done][:limit]

        result = []
        for week, day in upcoming_pairs:
            plan = self.get_workout_day(uid, week, day)
            exercises = [
                {"exercise": e.exercise, "sets": e.sets, "reps": e.reps}
                for e in (plan.warmup + plan.strength + plan.cooldown)
            ]
            result.append({"week": week, "day": day, "exercises": exercises})
        return result

    def get_workout_coach_context(self, uid: str, today: date) -> dict:
        """Everything the Workout Coach nudge needs, computed server-side so
        the frontend just triggers the request — no context assembly there."""
        week = self.get_workout_config(uid).current_week
        overview = self.get_week_overview(uid, week)
        current_week_remaining = [d for d in overview.days if d not in overview.completed_days]

        recent = self.get_workout_day_summaries(uid, limit=6)
        recent_workouts = [
            {"date": d.date, "week": d.week, "day": d.day, "felt": d.energy_level or "not rated",
             "exercises": self._collapse_sets_to_max(d.sets)}
            for d in recent
        ]

        return {
            "current_week": week,
            "current_week_completed": overview.completed_days,
            "current_week_remaining": current_week_remaining,
            "today_workout": self._today_workout_status(uid, today),
            "recent_workouts": recent_workouts,
            "upcoming_workouts": self._upcoming_workouts(uid, week, limit=6),
        }

    # ---------- Workout-app summary sync (Sheets) ----------
    def sync_summary_to_sheet(self, uid: str) -> bool:
        """Write today's summary as a row in the workout spreadsheet's
        NutritionSummary tab so the Apps Script app can read it. No-op in stubs
        or when WORKOUT_SHEET_ID is unset. Best-effort: failures are logged,
        not raised, so a broken sheet sync can't take down meal logging."""
        if self.stub or not self.s.workout_sheet_id:
            return False
        summary = self.get_today_summary(uid)
        g = summary.goals
        row = [[
            summary.date.isoformat(),
            summary.consumed.cal, summary.consumed.protein,
            summary.consumed.carbs, summary.consumed.fat,
            g.calories if g else "", g.protein_g if g else "",
            g.carbs_g if g else "", g.fat_g if g else "",
            round(summary.pct_to_goal * 100), summary.coach_tip or "",
        ]]
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
        import google.auth

        try:
            creds, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/spreadsheets"])
            svc = build("sheets", "v4", credentials=creds)
            # Overwrite a single "today" row at A2 (header assumed in row 1).
            svc.spreadsheets().values().update(
                spreadsheetId=self.s.workout_sheet_id,
                range="NutritionSummary!A2:K2",
                valueInputOption="RAW",
                body={"values": row},
            ).execute()
            return True
        except HttpError:
            log.warning("sync_summary_to_sheet failed for uid=%s", uid, exc_info=True)
            return False


_store: Store | None = None


def get_store(settings: Settings) -> Store:
    global _store
    if _store is None:
        _store = Store(settings)
    return _store
