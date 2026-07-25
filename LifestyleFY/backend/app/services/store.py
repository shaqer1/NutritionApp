"""Persistence layer: Firestore (hot state) + BigQuery (append-only history).

Every meal log writes to BOTH: BigQuery `food_log` (history) and Firestore
`today_summary` (recomputed). When USE_STUBS is set, everything is held in
process memory so the API runs offline with no GCP calls.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone

from ..config import Settings
from ..models import Goals, InventoryItem, LogRequest, Macros, Profile, TodaySummary


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
            self._goals: dict[str, dict] = {}
            self._inventory: dict[str, dict[str, dict]] = {}
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
        row = {
            "log_id": uuid.uuid4().hex, "uid": uid, "ts": ts.isoformat(),
            "meal": req.meal, "item_name": req.item_name, "barcode": req.barcode,
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
        }
        self._bq_insert("food_log", [row])
        if self.stub:
            self._food_log.append(row)
        if req.inventory_item_id:
            self._decrement_inventory(uid, req.inventory_item_id, req.servings)
        return self.recompute_today_summary(uid, day=ts.date())

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
        day_iso = day.isoformat()
        if self.stub:
            return [r for r in self._food_log
                    if r["uid"] == uid and r["ts"][:10] == day_iso]
        q = f"""
            SELECT calories, protein_g, carbs_g, fat_g,
                   sugar_g, fiber_g, sat_fat_g, sodium_mg
            FROM `{self.s.gcp_project}.{self.s.bq_dataset}.food_log`
            WHERE uid=@uid AND DATE(ts)=@day
        """
        from google.cloud import bigquery
        job = self._bq.query(q, job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("uid", "STRING", uid),
                bigquery.ScalarQueryParameter("day", "DATE", day_iso),
            ]))
        return [dict(r) for r in job.result()]

    def recompute_today_summary(self, uid: str, day: date | None = None,
                                coach_tip: str | None = None) -> TodaySummary:
        day = day or _now().date()
        rows = self._today_rows(uid, day)
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
            meals_logged=len(rows), pct_to_goal=round(pct, 3),
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

    def get_today_summary(self, uid: str) -> TodaySummary:
        return self.recompute_today_summary(uid)

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
