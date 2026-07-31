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
    Today/Coach tabs) — the rest of the Sheets/Apps Script app stayed
    untouched at the time, since Phase 2 (edit/clone/swap) hadn't shipped
    yet. It has now (see the Phase 2 bullet below) — see "Not started / to
    do" for the decommission step.
  - Full plan: `.claude/plans/i-made-some-updates-jaunty-scott.md` in this
    checkout's Claude Code history (cost analysis, architecture rationale,
    verification steps).

- **Workout tab — Phase 2 (latest)**: plan editing & program management,
  everything that was deferred when Phase 1 shipped. Built, verified end-to-end
  over real HTTP (edit/clone/cache-search/custom-exercise/swap, plus the
  live→cache round trip against the real RapidAPI key) and against real
  migrated data (1,519 cached exercises), and **deployed**: backend on Cloud
  Run (revision `nutrition-api-00030-ftg`, `EXERCISEDB_API_KEY` created in
  Secret Manager and wired into `--set-secrets`), frontend on Firebase
  Hosting. Sheets/Apps Script decommission intentionally deferred — revisit
  once Phase 2 has had some real use (see "Not started / to do" below).
  - **Edit exercise fields** — `PUT /workout/plan/{plan_id}`
    (`store.update_workout_plan_exercise`, mirrors Code.gs's
    `updateWorkoutPlanRow`) + an inline edit form (pencil icon) on each
    exercise card in `workout.component.ts`.
  - **Clone day / clone week** — `POST /workout/plan/clone-day` /
    `.../clone-week` (`store.clone_workout_day`/`clone_workout_week`), "+
    Clone" button per day card (uses `window.prompt` for the new name,
    matching the old app exactly) and a "Clone a week" panel by the week
    selector.
  - **Exercise cache browser** — `GET /workout/exercise-cache/options` +
    `POST /workout/exercise-cache/search` (paginated, all 6 filters —
    equipment/body part/type/target muscle/secondary muscle/keyword — as
    compact toggle-button dropdowns with an in-dropdown text filter, since
    `keywords` alone has ~7,800 distinct values), inline under each
    exercise's "🔁 Swap exercise" panel. Every result card (live search,
    cache browse, and related exercises) shows the same equipment +
    type/body-part label and has its own "Info" preview (image, overview,
    equipment, target muscles, instructions) before you commit to "Use".
  - **Exercise search + swap** — new `app/services/exercisedb.py` (httpx
    async, mirrors `food.py`'s Chomp-call pattern exactly) backing
    `GET /workout/exercises/search` (live RapidAPI, results decorated with
    cached equipment/body-part/type via `store.decorate_search_results` when
    already seen before) and `GET /workout/exercises/{id}` /
    `PUT /workout/plan/{plan_id}/exercise-selection` (cache-aside:
    `_ensure_exercise_cached` in `api.py` checks `exercise_cache` first, only
    calls RapidAPI on a miss, then persists the result — verified this
    round-trip works with a real API key). The RapidAPI key moved to a new
    `EXERCISEDB_API_KEY` setting/secret (`.env.example`, `infra/00_setup.sh`,
    `DEPLOYMENT.md` all updated) instead of staying hardcoded in `Code.gs`'s
    source — created in Secret Manager and live on Cloud Run's
    `--set-secrets`.
  - **Full exercise detail on the card itself** — `PlanExercise` now also
    carries `equipments`/`exercise_tips`/`variations`/`related_exercise_ids`
    (joined from `exercise_cache`, same as image/overview/instructions).
    Equipment shows inline; tips, variations, and related exercises are
    expandable accordions to keep the card from getting cluttered — related
    exercises lazily fetch their own details (cache-aside, `forkJoin` over
    `getWorkoutExerciseDetails`) only when that accordion is opened, each
    shown with the same equipment/label treatment and its own Info/Use.
  - **Custom exercise creation** — `POST /workout/plan/{plan_id}/custom-exercise`
    (`store.save_custom_exercise`, mirrors `saveCustomExerciseCache`), writes
    a `customex_{plan_id}` doc into `exercise_cache` and points the plan row
    at it.

## Not started / to do

### 1. Decommission the Sheets/Apps Script workout app
Now that Phase 2 gives this app full parity with `CodeBck` (view, log, edit,
clone, swap, custom exercises), the old Google Sheets/Apps Script app has no
remaining reason to be used — stop directing use to that URL once you've
spot-checked Phase 2 for a session or two. At that point `WORKOUT_SHEET_ID`
and `sync_summary_to_sheet()` in `store.py` can also be retired, since
nothing will read the Sheet anymore (that was always the *other* direction
of integration anyway — see Phase 5 below).

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
