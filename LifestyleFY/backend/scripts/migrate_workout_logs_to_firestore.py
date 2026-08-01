#!/usr/bin/env python3
"""One-off: copy existing rows from BigQuery's workout_set_log and
workout_session_log tables into Firestore users/{uid}/workout_set_log and
users/{uid}/workout_session_log.

The app's Store now reads/writes workout set + session logs from Firestore
instead of BigQuery (BigQuery's streaming-buffer lock blocked DELETE on
recently-inserted rows for up to ~90 min, which broke un-checking a set right
after logging it). This script backfills history logged before that switch so
it isn't invisible to the app going forward. Idempotent (uses the same doc IDs
as the source rows, so re-running just overwrites with identical data).

Usage (from LifestyleFY/backend/):
    python scripts/migrate_workout_logs_to_firestore.py
    # prints row counts only (dry run) -- re-run with --yes to actually write:
    python scripts/migrate_workout_logs_to_firestore.py --yes
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402


def _iso(value) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _write_batched(fs, rows: list[dict], collection: str, id_field: str) -> int:
    batch = fs.batch()
    count = 0
    for row in rows:
        uid = row["uid"]
        doc_id = row[id_field]
        ref = fs.collection("users").document(uid).collection(collection).document(doc_id)
        batch.set(ref, row)
        count += 1
        if count % 400 == 0:  # Firestore batch limit is 500
            batch.commit()
            batch = fs.batch()
    batch.commit()
    return count


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true",
                        help="Actually write. Without this, dry-run only (prints counts).")
    args = parser.parse_args()

    settings = get_settings()
    if settings.use_stubs:
        print("USE_STUBS=true in this environment's .env — unset it (or export "
              "USE_STUBS=false) to read/write real BigQuery/Firestore.", file=sys.stderr)
        sys.exit(1)

    from google.cloud import bigquery, firestore
    bq = bigquery.Client(project=settings.gcp_project)
    fs = firestore.Client(project=settings.gcp_project)

    set_rows = [dict(r) for r in bq.query(
        f"SELECT * FROM `{settings.gcp_project}.{settings.bq_dataset}.workout_set_log`"
    ).result()]
    for r in set_rows:
        r["ts"] = _iso(r["ts"])

    session_rows = [dict(r) for r in bq.query(
        f"SELECT * FROM `{settings.gcp_project}.{settings.bq_dataset}.workout_session_log`"
    ).result()]
    for r in session_rows:
        r["ts"] = _iso(r["ts"])

    print(f"Read {len(set_rows)} workout_set_log rows, "
          f"{len(session_rows)} workout_session_log rows from BigQuery.")

    if not args.yes:
        print("Dry run only — re-run with --yes to write to Firestore.")
        return

    set_count = _write_batched(fs, set_rows, "workout_set_log", "set_log_id")
    print(f"Wrote {set_count} workout_set_log docs to Firestore.")

    session_count = _write_batched(fs, session_rows, "workout_session_log", "session_id")
    print(f"Wrote {session_count} workout_session_log docs to Firestore.")

    print("Done.")


if __name__ == "__main__":
    main()
