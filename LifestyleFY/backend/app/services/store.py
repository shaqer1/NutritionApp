"""Persistence layer: Firestore (hot state) + BigQuery (append-only history).

Every meal log writes to BOTH: BigQuery `food_log` (history) and Firestore
`today_summary` (recomputed). When USE_STUBS is set, everything is held in
process memory so the API runs offline with no GCP calls.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from ..config import Settings
from ..models import (
    AiPrompts, Goals, GroceryList, InventoryItem, LogEntry, LogRequest, Macros, Profile,
    Recipe, TodaySummary,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


log = logging.getLogger(__name__)


class Store:
    def __init__(self, settings: Settings):
        self.s = settings
        self.stub = settings.use_stubs
        if self.stub:
            # In-memory mirrors of Firestore docs + BigQuery rows.
            self._profiles: dict[str, dict] = {}
            self._ai_prompts: dict[str, dict] = {}
            self._goals: dict[str, dict] = {}
            self._inventory: dict[str, dict[str, dict]] = {}
            self._recipes: dict[str, dict[str, dict]] = {}
            self._grocery_lists: dict[str, dict[str, dict]] = {}
            self._today: dict[str, dict] = {}
            self._coach: dict[str, list[dict]] = {}
            self._barcode_cache: dict[str, dict] = {}
            self._food_log: list[dict] = []
            self._scans: list[dict] = []
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

    # ---------- BigQuery insert helper ----------
    def _bq_insert(self, table: str, rows: list[dict]) -> None:
        if self.stub:
            return  # stub mirrors are updated by callers where needed
        table_id = f"{self.s.gcp_project}.{self.s.bq_dataset}.{table}"
        errors = self._bq.insert_rows_json(table_id, rows)
        if errors:
            raise RuntimeError(f"BigQuery insert into {table} failed: {errors}")

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
