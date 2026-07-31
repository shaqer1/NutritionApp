#!/usr/bin/env python3
"""One-off: migrate the Google Sheets workout app's data into this backend's
Firestore/BigQuery, replacing GDrive/WorkoutPlan/CodeBck (Code.gs + Sheets).

Reads the xlsx export of that spreadsheet (Google Sheets > File > Download >
Microsoft Excel) and writes:
  - WorkoutPlan   -> Firestore users/{uid}/workout_plan/{planId}
  - ExerciseCache -> Firestore exercise_cache/{exerciseId} (shared, not per-user)
  - Config        -> Firestore users/{uid}/meta/workout_config
  - WorkoutLog    -> BigQuery nutrition.workout_set_log (batch load job, not a
                      streaming insert, so imported rows aren't stuck in the
                      streaming buffer / immune to UPDATE-DELETE for ~90 min)
  - Progress      -> BigQuery nutrition.workout_session_log (batch load job)

Requires `pip install openpyxl` — one-off, intentionally not added to
requirements.txt since this script never runs as part of the deployed
service.

Find your Firebase uid: sign into the deployed app once, then check the
Firebase Console > Authentication > Users tab, or Firestore's `users`
collection (whichever document id shows up there after you've logged in).

Usage (from LifestyleFY/backend/):
    python scripts/import_workout_xlsx.py --uid <firebase-uid> \\
        --xlsx "/path/to/Shafay Workout Plan.xlsx"
    # prints row counts only (dry run) -- re-run with --yes to actually write:
    python scripts/import_workout_xlsx.py --uid <firebase-uid> \\
        --xlsx "/path/to/Shafay Workout Plan.xlsx" --yes
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402


def _sanitize(value) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "_", str(value or ""))


def _plan_id(week, day, section, order) -> str:
    return f"{week}_{_sanitize(day)}_{_sanitize(section)}_{order}"


def _row_dicts(ws) -> list[dict]:
    """openpyxl worksheet -> list[dict] keyed by its header row, skipping
    fully-blank rows."""
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h or "").strip() for h in rows[0]]
    out = []
    for row in rows[1:]:
        if all(v is None or str(v).strip() == "" for v in row):
            continue
        out.append({headers[i]: row[i] for i in range(len(headers)) if i < len(row)})
    return out


def _json_list(value) -> list:
    raw = str(value or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _json_dict(value) -> dict:
    raw = str(value or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _iso_date(value) -> str:
    return value.date().isoformat() if hasattr(value, "date") else str(value or "")


def _iso_ts(value) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value) if value else datetime.now(timezone.utc).isoformat()


def _load_json_rows(bq, settings, table: str, rows: list[dict]) -> None:
    if not rows:
        return
    from google.cloud import bigquery
    table_id = f"{settings.gcp_project}.{settings.bq_dataset}.{table}"
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
    )
    bq.load_table_from_json(rows, table_id, job_config=job_config).result()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--uid", required=True, help="Firebase uid to import per-user data under")
    parser.add_argument("--xlsx", required=True, help="Path to the exported workout plan .xlsx")
    parser.add_argument("--yes", action="store_true",
                        help="Actually write. Without this, dry-run only (prints counts).")
    args = parser.parse_args()

    try:
        import openpyxl
    except ImportError:
        print("Missing dependency — run: pip install openpyxl", file=sys.stderr)
        sys.exit(1)

    xlsx_path = Path(args.xlsx).expanduser()
    if not xlsx_path.exists():
        print(f"File not found: {xlsx_path}", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    plan_rows = _row_dicts(wb["WorkoutPlan"])
    cache_rows = _row_dicts(wb["ExerciseCache"])
    log_rows = _row_dicts(wb["WorkoutLog"])
    progress_rows = _row_dicts(wb["Progress"])
    config_rows = _row_dicts(wb["Config"])

    print(f"Parsed: {len(plan_rows)} plan rows, {len(cache_rows)} cache rows, "
          f"{len(log_rows)} set-log rows, {len(progress_rows)} session rows, "
          f"{len(config_rows)} config rows.")

    if not args.yes:
        print("Dry run only — re-run with --yes to write to Firestore/BigQuery.")
        return

    settings = get_settings()
    if settings.use_stubs:
        print("USE_STUBS=true in this environment's .env — unset it (or export "
              "USE_STUBS=false) to write to real Firestore/BigQuery.", file=sys.stderr)
        sys.exit(1)

    from google.cloud import bigquery, firestore
    fs = firestore.Client(project=settings.gcp_project)
    bq = bigquery.Client(project=settings.gcp_project)

    # --- WorkoutPlan -> Firestore users/{uid}/workout_plan/{planId} ---
    batch = fs.batch()
    plan_count = 0
    for row in plan_rows:
        week = row.get("Week")
        day = str(row.get("Day") or "").strip()
        section = str(row.get("Section") or "").strip()
        order = row.get("Order")
        if not (week and day and section and order is not None):
            continue
        week = int(week)
        plan_id = _plan_id(week, day, section, order)
        doc = {
            "week": week, "day": day, "phase": str(row.get("Phase") or ""),
            "section": section, "order": int(order),
            "exercise": str(row.get("Exercise") or ""),
            "sets": str(row.get("Sets") or ""), "reps": str(row.get("Reps") or ""),
            "weight": str(row.get("Weight") or ""), "tempo": str(row.get("Tempo") or ""),
            "rest": str(row.get("Rest") or ""), "video_url": str(row.get("Video_URL") or ""),
            "exercise_id": str(row.get("Exercise_ID") or "").strip() or None,
            "notes": str(row.get("Notes") or ""), "category": str(row.get("Category") or ""),
            "is_custom": bool(row.get("IsCustom")),
        }
        ref = (fs.collection("users").document(args.uid)
               .collection("workout_plan").document(plan_id))
        batch.set(ref, doc)
        plan_count += 1
        if plan_count % 400 == 0:  # Firestore batch limit is 500
            batch.commit()
            batch = fs.batch()
    batch.commit()
    print(f"Wrote {plan_count} workout_plan docs.")

    # --- ExerciseCache -> Firestore exercise_cache/{exerciseId} (shared) ---
    batch = fs.batch()
    cache_count = 0
    for row in cache_rows:
        exercise_id = str(row.get("exerciseId") or "").strip()
        if not exercise_id:
            continue
        doc = {
            "name": str(row.get("name") or ""), "image_url": str(row.get("imageUrl") or ""),
            "image_urls": _json_dict(row.get("imageUrls")),
            "equipments": _json_list(row.get("equipments")),
            "body_parts": _json_list(row.get("bodyParts")),
            "exercise_type": str(row.get("exerciseType") or ""),
            "target_muscles": _json_list(row.get("targetMuscles")),
            "secondary_muscles": _json_list(row.get("secondaryMuscles")),
            "video_url": str(row.get("videoUrl") or ""),
            "keywords": _json_list(row.get("keywords")),
            "overview": str(row.get("overview") or ""),
            "instructions": _json_list(row.get("instructions")),
            "exercise_tips": _json_list(row.get("exerciseTips")),
            "variations": _json_list(row.get("variations")),
            "related_exercise_ids": _json_list(row.get("relatedExerciseIds")),
            "is_custom": bool(row.get("isCustom")),
            "date_added": str(row.get("dateAdded") or ""),
        }
        batch.set(fs.collection("exercise_cache").document(exercise_id), doc)
        cache_count += 1
        if cache_count % 400 == 0:
            batch.commit()
            batch = fs.batch()
    batch.commit()
    print(f"Wrote {cache_count} exercise_cache docs.")

    # --- Config -> Firestore users/{uid}/meta/workout_config ---
    config = {row.get("Key"): row.get("Value") for row in config_rows if row.get("Key")}
    current_week = int(config.get("current_week") or 1)
    (fs.collection("users").document(args.uid).collection("meta")
     .document("workout_config").set({"current_week": current_week}))
    print(f"Wrote workout_config (current_week={current_week}).")

    # --- WorkoutLog -> BigQuery workout_set_log (batch load) ---
    set_log_rows = [{
        "set_log_id": uuid.uuid4().hex, "uid": args.uid,
        "ts": _iso_ts(row.get("Timestamp")), "log_date": _iso_date(row.get("Date")),
        "week": int(row.get("Week") or 0), "day": str(row.get("Day") or ""),
        "exercise": str(row.get("Exercise") or ""), "set_num": int(row.get("Set") or 0),
        "planned_reps": str(row.get("Planned_Reps") or ""),
        "actual_reps": str(row.get("Actual_Reps") or ""),
        "weight": str(row.get("Weight_lbs") or ""), "notes": str(row.get("Notes") or ""),
    } for row in log_rows]
    _load_json_rows(bq, settings, "workout_set_log", set_log_rows)
    print(f"Loaded {len(set_log_rows)} rows into workout_set_log.")

    # --- Progress -> BigQuery workout_session_log (batch load) ---
    session_rows = [{
        "session_id": uuid.uuid4().hex, "uid": args.uid,
        "ts": _iso_ts(row.get("Timestamp")), "log_date": _iso_date(row.get("Date")),
        "week": int(row.get("Week") or 0), "day_name": str(row.get("Day_Name") or ""),
        "completed": bool(row.get("Completed")),
        "total_exercises": int(row.get("Total_Exercises") or 0),
        "notes": str(row.get("Notes") or ""), "energy_level": str(row.get("Energy_Level") or ""),
    } for row in progress_rows]
    _load_json_rows(bq, settings, "workout_session_log", session_rows)
    print(f"Loaded {len(session_rows)} rows into workout_session_log.")

    print("Done.")


if __name__ == "__main__":
    main()
