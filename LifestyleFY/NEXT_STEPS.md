# LifestyleFY — Next Steps

Snapshot of where the build stands and what's left. Full architecture/cost is in
the planning doc at `G:\My Drive\WorkoutPlan` (plan file
`codebck-this-is-my-glittery-donut.md`). For how to actually run/deploy any of this,
see [DEPLOYMENT.md](DEPLOYMENT.md).

## Where things stand (done)

- **Backend** (`backend/`): FastAPI service with every planned endpoint wired —
  `/scan /search /inventory /log /today /goals /goals/suggest /goals/next /recipes
  /grocery /coach /coach/messages /summary`. Layered food resolver
  (cache → Open Food Facts → Chomp → manual), Firestore + BigQuery dual-write,
  deterministic goal math + Gemini coaching. Runs **offline** with
  `USE_STUBS=true` + `DEV_NO_AUTH=true` for local dev.
- **Frontend** (`frontend/`): Angular 19 PWA, 6 tabs (Today, Scan, Log, Pantry,
  Goals, Coach), in-browser camera scanning via `@zxing/browser`, typed API client.
- **Infra** (`infra/`): `00_setup.sh` (gcloud), `bigquery_schema.sql`,
  `firestore_structure.md`. Phase 0 has been run — GCP project has Firestore,
  BigQuery dataset/tables, the `nutrition-run` service account + IAM roles, and
  `GEMINI_API_KEY`/`CHOMP_API_KEY` in Secret Manager.
- **Backend deployed** to Cloud Run:
  `https://nutrition-api-311101817139.us-central1.run.app` (`USE_STUBS=false`,
  `DEV_NO_AUTH=false` — real Firestore/BigQuery/Gemini, real auth enforced).
- **Frontend deployed** to Firebase Hosting:
  `https://gen-lang-client-0347523959.web.app`.
- **Auth wired up end-to-end**: Firebase project registered, Google Sign-In enabled,
  Angular `AuthService` + `HttpInterceptor` attach the ID token to every API call,
  and the backend verifies it (`app/auth.py`).
- **Access control**: beyond a valid token, the caller's email must be in the
  `config/access` Firestore doc (`allowed_emails` array) — manage who can use the
  app from the Firebase Console's Firestore Data tab, no redeploy needed.
- **Pantry/recipe/grocery feature batch** (latest): recipe ingredients can now only
  be added from the pantry (never free text), so every recipe line links back to a
  real `InventoryItem`; Pantry gained an "All" location tab and a hide-out-of-stock
  toggle; a third "Manual entry" Add/Scan tab creates a full ingredient (macros,
  image, ingredients text) without a barcode/AI match; Recipes support fully manual
  creation, an image URL, and an Active/Archived lifecycle (archive/restore/delete
  permanently); Grocery lists are now structured JSON (items grouped by section +
  a swaps/substitutions list) instead of prose, and persist/save/edit/archive the
  same way recipes do; the Coach profile card exposes Sex, Dietary prefs, and
  Allergies (fields already existed in `Profile`, just had no UI before); Today now
  shows an itemized table of everything logged that day.
- **"Cooked recipe" checkbox** (latest): saving a manual recipe with "I just
  cooked this" checked decrements the linked pantry ingredients by the servings
  picked and adds the finished meal as a new fridge `InventoryItem` — per-serving
  macros/grams summed from the ingredients used, servings-per-container from the
  recipe's servings field, filed under the new "Takeout & Prepared Meals" pantry
  category (`categories.ts` / `categories.py`).
- **Edit/delete a logged entry** (latest): `LogEntry` now carries its `log_id`;
  `PUT /log/{log_id}` and `DELETE /log/{log_id}` (`store.update_log_entry` /
  `delete_log_entry`) correct or remove that food_log row directly — full inline
  edit form on the Today tab, quick delete from the Inventory tab's Log view.
  Deliberately data-only: neither touches a linked inventory item's qty. Note
  for the real (non-stub) deployment: these run as BigQuery UPDATE/DELETE DML,
  which BigQuery rejects for rows still in the streaming buffer (recently
  inserted, ~up to 90 min) — editing/deleting something logged moments ago can
  fail until the buffer flushes. Not an issue in `USE_STUBS=true` local dev.
- **Workout tab — Phase 1 (latest)**: the old Google Sheets/Apps Script workout
  app (`GDrive/WorkoutPlan/CodeBck`) is being migrated into this codebase as a
  6th 🏋️ Workout bottom-nav tab, to fix its Apps Script/Sheets latency and
  consolidate onto one stack. Phase 1 (core loop — the stuff used every
  session) is done and the data is live:
  - **Backend**: `PlanExercise`/`WorkoutConfig`/`WorkoutDay`/`WorkoutProgress`
    etc. in `app/models.py`; workout methods on `Store` in
    `app/services/store.py` (`get_workout_day`, `log_workout_set`,
    `get_workout_progress`, etc.); 7 routes under `# ---------- Workout ----------`
    in `app/routes/api.py` (`/workout/config`, `/workout/weeks/{week}/overview`,
    `/workout/weeks/{week}/days/{day}`, `/workout/sets` GET+POST,
    `/workout/sessions`, `/workout/progress`).
  - **Data model**: Firestore `users/{uid}/workout_plan/{planId}` (hot,
    editable plan — `planId` is a deterministic `week_day_section_order` key)
    + top-level `exercise_cache/{exerciseId}` (shared reference data, like
    `barcode_cache`) + `users/{uid}/meta/workout_config`. BigQuery
    `nutrition.workout_set_log` / `nutrition.workout_session_log`
    (append-only, added to `infra/bigquery_schema.sql`, same
    `PARTITION BY DATE(ts)` convention as `food_log`/`scans`).
  - **Migration**: `backend/scripts/import_workout_xlsx.py` (one-off,
    `pip install openpyxl` locally, not a runtime dependency) reads the
    Sheets xlsx export and writes Firestore + BigQuery batch-load jobs. **Already
    run for real** against uid `VfitOACrGQZEenfWJMhpLWvOMQH2`: 409
    `workout_plan` docs, 1,520 `exercise_cache` docs, 528 `workout_set_log`
    rows, 28 `workout_session_log` rows, `workout_config.current_week=9`.
  - **Frontend**: `frontend/src/app/pages/workout.component.ts` (Workout/
    Progress toggle in one page, matching Inventory's segmented-control
    pattern), `core/workout-categories.ts`, wired into `app.routes.ts` /
    `app.component.ts` nav.
  - **Deployed**: backend on Cloud Run (revision `nutrition-api-00028-hms`),
    frontend on Firebase Hosting — both live with the new Workout tab.
  - **Post-migration bug fixes** (found by eyeballing the real deployed data):
    exercise videos weren't showing — the live spreadsheet's per-row
    `Video_URL` column was empty for all 409 rows, but every row has an
    `Exercise_ID`, and the joined `exercise_cache` doc has a real ExerciseDB
    video for all 1,520 exercises; `get_workout_day` now prefers the cache's
    `video_url`, falling back to the plan row's own (mirrors the old app's
    `detailVideoUrl || video`). Also restored the "TARGET" reps column in the
    set tracker (dropped by mistake when porting from the old app's SET/
    TARGET/ACTUAL REPS/WEIGHT layout). And fixed a misleading progress
    percentage: `total_sessions` counts every logged session instance
    (repeats included, e.g. redoing a day on a different date), which for
    this real data happened to numerically equal `total_planned_days`,
    showing "32/32 days complete (100%)" even though week 10 hadn't started.
    Added `distinct_days_completed` (unique planned week+day slots with
    at least one session) as the progress-bar numerator instead — correctly
    shows 28/32 (88%). `total_sessions` still drives the "Sessions" stat card
    unchanged (total workout instances, repeats intentionally included there).
  - Removed the redundant Nutrition tab from
    `GDrive/WorkoutPlan/CodeBck/index.html.html` (superseded by this app's own
    Today/Coach tabs) — the Sheets/Apps Script Workout + Progress tabs
    otherwise still work as-is, since Phase 2 (below) hasn't shipped yet.
  - Full plan: `.claude/plans/i-made-some-updates-jaunty-scott.md` in this
    checkout's Claude Code history (cost analysis, architecture rationale,
    verification steps).

## Not started / to do

### 1. Phase 2 — Workout tab: editing & program management (deferred by choice)
Everything used to *adjust* the program rather than run a session — kept on
the old Sheets/Apps Script app for now, ported here next:
- **Edit exercise fields** — new `PUT /workout/plan/{plan_id}` endpoint
  (mirrors Code.gs's `updateWorkoutPlanRow`) + an inline edit form on each
  exercise card in `workout.component.ts` (sets/reps/weight/tempo/rest/notes/
  category), using the same draft-object-then-Save pattern as
  `inventory-item.component.ts`.
- **Clone day / clone week** — `POST /workout/plan/clone-day` and
  `.../clone-week` (mirror `cloneWorkoutDay`/`cloneWeekToEnd`), duplicating
  Firestore `workout_plan` docs with new deterministic ids.
- **Exercise cache browser** — filterable/paginated list over the (already
  migrated) 1,520-doc `exercise_cache` collection, mirroring
  `getExerciseCacheOptions`/`searchExerciseCache`.
- **Exercise search + swap** — live ExerciseDB RapidAPI calls
  (`searchExercisesForUi`/`getExerciseDetailsForId` equivalents). New backend
  service (`app/services/exercisedb.py`, `httpx` async, mirrors
  `food.py`'s Chomp-call pattern) + a new `EXERCISEDB_API_KEY` setting,
  moved into Secret Manager (`create_secret EXERCISEDB_API_KEY` in
  `infra/00_setup.sh`) instead of the hardcoded key currently sitting in
  `Code.gs`'s source.
- **Custom exercise creation** — mirrors `saveCustomExerciseCache`, writes a
  `customex_...` doc into `exercise_cache` and points the plan row at it.
- **Decommission the Sheets/Apps Script app** once the above has parity —
  stop directing use to that URL; at that point `WORKOUT_SHEET_ID` and
  `sync_summary_to_sheet()` (see below) can also be retired since nothing
  will read the Sheet anymore.

### 2. Phase 5 — Workout-app overview integration (superseded, don't build)
This was the *other* direction of integration (workout app reading a
nutrition summary written into the Sheet) — planned back when the workout
app still lived in Sheets. Now that the workout app itself is moving into
this codebase (Phase 2 above), this whole approach is moot: `getNutritionForDay`
in `Code.gs` and `store.sync_summary_to_sheet()` become dead code once Phase 2
ships and the Sheets app is retired. Left here only as a historical note —
do not implement this.

### 3. Phase 4 polish — proactive coach nudges
- Add **Cloud Scheduler** jobs hitting `/coach` at meal checkpoints (e.g. 14:00,
  18:30). Endpoint already computes behind-pace and generates a Gemini suggestion.
  Since the API now requires auth, the Scheduler job needs a way to call it — either
  a dedicated service-to-service OIDC token (Scheduler → Cloud Run with
  `--oidc-service-account-email`) with a small backend carve-out, or a scheduled
  Cloud Function using the Admin SDK to mint a token for your uid.
- Add **Web Push** delivery: service-worker `push` listener + VAPID keys (store in
  Secret Manager) so nudges pop on the phone. (Optional: email via Gmail API —
  requires authorizing the Gmail connector in an interactive session.)

### 4. ~~Ship the PWA (icons)~~ — done
- `frontend/src/assets/icons/icon-192.png` and `icon-512.png` now exist (cropped
  from `LifestyleFY/NutriBear-Lifestyle4U.svg` — the badge mark only, the
  "LifestyleFY / Nutrition App" text banner at the bottom of that file is
  excluded). Referenced by `manifest.webmanifest`; confirmed present in
  `ng build` output at `dist/lifestylefy/browser/assets/icons/`.

### 5. Optional
- **Looker Studio** dashboard on BigQuery for weight/intake/adherence trends (free).
- **Prepared-food scanning** (lower priority) already flows through `/scan`.

## Known integration risks to confirm on first real call
- **Chomp** JSON parsing (`backend/app/services/food.py: _parse_chomp`) is written
  against their documented shape but unverified without a live key — currently
  stubbed/unused since no Chomp key is active.
- **Gemini SDK** version pin (`google-genai`) — bump if the `Client` API has moved.
- **Angular / @zxing** version pins — confirmed only at `npm install` time.

## Cost reminder
Everything targets free tiers: ~**$0–3/mo** total (Gemini pennies; Chomp only if you
enable paid search at $25/mo). Cloud Run scales to zero when idle.
