#!/usr/bin/env python3
"""Seed the reviewed Strength Building plan (Weeks 17–22) from the HTML draft.

Dry-run by default. Run from LifestyleFY/backend:
    python scripts/seed_strength_building_phase.py
    python scripts/seed_strength_building_phase.py --yes
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402


class _ScriptReader(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_script = False
        self.current: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "script":
            self.in_script = True
            self.current = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.in_script:
            self.scripts.append("".join(self.current))
            self.in_script = False

    def handle_data(self, data: str) -> None:
        if self.in_script:
            self.current.append(data)


def _read_plan() -> tuple[list[dict], list[dict], dict[str, dict]]:
    html_path = Path(__file__).resolve().parents[3] / "Strength Building — Draft Phase Plan.html"
    reader = _ScriptReader()
    reader.feed(html_path.read_text(encoding="utf-8"))
    if not reader.scripts:
        raise RuntimeError(f"No inline plan data found in {html_path}.")

    script = reader.scripts[0]
    marker = "function weeklySets"
    marker_index = script.find(marker)
    if marker_index < 0:
        raise RuntimeError("Could not locate plan-data boundary in the review HTML.")
    data_script = script[:marker_index] + "\nglobalThis.seedData = { weeks, days, mobility };"
    node_script = """
const fs = require('fs');
const vm = require('vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(0, 'utf8'), context);
process.stdout.write(JSON.stringify(context.seedData));
"""
    try:
        result = subprocess.run(
            ["node", "-e", node_script], input=data_script, text=True,
            capture_output=True, check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Node.js is required to read the reviewed HTML plan.") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Could not parse reviewed HTML plan: {exc.stderr.strip()}") from exc

    data = json.loads(result.stdout)
    weeks = data["weeks"]
    days = data["days"]
    mobility = data["mobility"]
    if [week["number"] for week in weeks] != list(range(17, 23)):
        raise ValueError("The HTML must contain the reviewed Weeks 17–22.")
    if [day["name"] for day in days] != [
        "Day 1 Upper Body A", "Day 2 Lower Body A",
        "Day 3 Upper Body B", "Day 4 Lower Body B",
    ]:
        raise ValueError("Workout day order/labels do not match the approved plan.")
    expected_strength_counts = [6, 6, 7, 7]
    for day, expected_count in zip(days, expected_strength_counts, strict=True):
        if len(day["exercises"]) != expected_count:
            raise ValueError(f"{day['name']} must have {expected_count} strength exercises.")
        if not day["exercises"][-1].get("core"):
            raise ValueError(f"{day['name']} must end with its core exercise.")
    return weeks, days, mobility


def _category(section: str, exercise: dict) -> str:
    if section == "Warm-Up":
        return "warmup"
    if section == "Cool-Down":
        return "stretch"
    if exercise.get("core"):
        return "core"
    name = exercise["name"].casefold()
    if any(word in name for word in ("curl", "tricep")):
        return "arms"
    if any(word in name for word in ("press", "bench")):
        return "push"
    if any(word in name for word in ("row", "pulldown")):
        return "pull"
    return "legs"


def _plan_id(week: int, day: str, section: str, order: int) -> str:
    safe_day = re.sub(r"[^a-zA-Z0-9]", "_", day)
    safe_section = re.sub(r"[^a-zA-Z0-9]", "_", section)
    return f"{week}_{safe_day}_{safe_section}_{order}"


def _build_rows(
    weeks: list[dict], days: list[dict], mobility: dict[str, dict], uid: str,
) -> list[tuple[str, dict]]:
    output = []
    for week_index, week in enumerate(weeks):
        week_number = week["number"]
        for day_index, day in enumerate(days, start=1):
            day_name = re.sub(r"^Day \d+ ", f"Day {day_index} - ", day["name"])
            day_mobility = mobility[day["kind"]]
            for section, exercises in (
                ("Warm-Up", day_mobility["warmup"]),
                ("Strength", day["exercises"]),
                ("Cool-Down", day_mobility["cooldown"]),
            ):
                for order, exercise in enumerate(exercises, start=1):
                    if section == "Strength":
                        sets = 2 if week_number == 22 else exercise["sets"]
                        reps = exercise["reps"]
                        if isinstance(reps, list):
                            reps = reps[week_index]
                        if exercise.get("core"):
                            weight = "BW"
                        elif exercise.get("bodyweight"):
                            weight = "BW"
                        else:
                            increase = 2.5 if week_index in (2, 3) else 5 if week_index == 4 else 0
                            load = exercise["base"] + increase
                            weight = f"{load:g} lbs"
                    else:
                        sets = 1
                        reps = exercise["reps"]
                        weight = "BW"

                    row = {
                        "week": week_number,
                        "day": day_name,
                        "phase": "Phase 5: Strength Building",
                        "section": section,
                        "order": order,
                        "exercise": exercise["name"],
                        "sets": str(sets),
                        "reps": str(reps),
                        "weight": weight,
                        "tempo": "",
                        "rest": "2-3 min" if section == "Strength" and order == 1 else "",
                        "video_url": exercise["url"],
                        "exercise_id": exercise["id"],
                        "notes": "",
                        "category": _category(section, exercise),
                        "is_custom": False,
                    }
                    output.append((_plan_id(week_number, day_name, section, order), row))
    if len(output) != 252:
        raise ValueError(f"Expected 252 plan rows, generated {len(output)}.")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="Write the reviewed plan to Firestore.")
    parser.add_argument(
        "--template", action="store_true",
        help="Seed the shared workout_plan_template collection instead of the user plan.",
    )
    args = parser.parse_args()

    settings = get_settings()
    if settings.use_stubs:
        raise RuntimeError("USE_STUBS=true; refusing to seed a non-live store.")

    weeks, days, mobility = _read_plan()
    from google.cloud import bigquery, firestore

    bq = bigquery.Client(project=settings.gcp_project)
    fs = firestore.Client(project=settings.gcp_project)
    set_table = f"`{settings.gcp_project}.{settings.bq_dataset}.workout_set_log`"
    uids = [row.uid for row in bq.query(f"SELECT DISTINCT uid FROM {set_table}").result()]
    if len(uids) != 1:
        raise RuntimeError(f"Expected exactly one workout-log account; found {len(uids)}.")
    uid = uids[0]

    rows = _build_rows(weeks, days, mobility, uid)
    expected_ids = {plan_id for plan_id, _ in rows}
    missing = []
    for _, row in rows:
        cache_ref = fs.collection("exercise_cache").document(row["exercise_id"])
        cached = cache_ref.get()
        if not cached.exists or not (
            (cached.to_dict() or {}).get("video_url")
            or (cached.to_dict() or {}).get("videoUrl")
            or (cached.to_dict() or {}).get("demo_url")
            or (cached.to_dict() or {}).get("gif_url")
        ):
            missing.append(row["exercise_id"])
    if missing:
        raise RuntimeError(f"Exercise catalog records or demo URLs are missing: {sorted(set(missing))}")

    plan_collection = (
        fs.collection("workout_plan_template") if args.template
        else fs.collection("users").document(uid).collection("workout_plan")
    )
    existing = [doc for doc in plan_collection.stream()
                if 17 <= int((doc.to_dict() or {}).get("week", 0)) <= 22]
    if existing:
        actual_ids = {doc.id for doc in existing}
        if actual_ids == expected_ids:
            actual_rows = {doc.id: doc.to_dict() or {} for doc in existing}
            expected_rows = dict(rows)
            if actual_rows == expected_rows:
                target = "shared template" if args.template else "user workout plan"
                print(f"Weeks 17–22 already match the {target} ({len(existing)} rows); no writes made.")
                return
            raise RuntimeError(
                "Weeks 17–22 have the expected row IDs but their contents differ. "
                "Refusing to overwrite."
            )
        raise RuntimeError(
            f"Found {len(existing)} existing rows in the target collection for Weeks 17–22. "
            "Refusing to overwrite or mix plans."
        )

    target = "shared workout_plan_template" if args.template else "user workout plan"
    print(
        f"Validated Strength Building {target}: Weeks 17–22, 4 days/week, "
        f"{len(rows)} workout plan rows, {len(expected_ids)} distinct row IDs."
    )
    if not args.yes:
        target_flag = " --template" if args.template else ""
        print(f"Dry run only. Re-run with{target_flag} --yes to write these rows to Firestore.")
        return

    batch = fs.batch()
    for plan_id, row in rows:
        batch.set(plan_collection.document(plan_id), row)
    batch.commit()
    print(f"Seeded {len(rows)} rows to Firestore {target}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Seed failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
