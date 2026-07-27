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

## Not started / to do

### 1. Phase 5 — Workout-app overview integration (deferred by choice)
- Backend already has `store.sync_summary_to_sheet()` — it writes a
  `NutritionSummary` tab row to the workout spreadsheet. Share that sheet with the
  Cloud Run service account (`nutrition-run@...`, Editor) so it can write. Note this
  write is **not** scoped per-user (fixed cell range `A2:K2`) — fine for a single
  user, but a second signed-in account would overwrite it.
- Edit `CodeBck/Code.gs`: replace `getNutritionForDay()` (line ~421) with
  `getNutritionOverview()` reading the `NutritionSummary` tab; keep the old static
  version as fallback if the tab is empty.
- Edit `CodeBck/index.html.html`: update `renderNutrition(n)` (line ~898) to draw a
  live consumed-vs-goal card + latest coach tip. Reuse existing `.nutrition-card`
  CSS and the `google.script.run.withSuccessHandler` pattern.

### 2. Phase 4 polish — proactive coach nudges
- Add **Cloud Scheduler** jobs hitting `/coach` at meal checkpoints (e.g. 14:00,
  18:30). Endpoint already computes behind-pace and generates a Gemini suggestion.
  Since the API now requires auth, the Scheduler job needs a way to call it — either
  a dedicated service-to-service OIDC token (Scheduler → Cloud Run with
  `--oidc-service-account-email`) with a small backend carve-out, or a scheduled
  Cloud Function using the Admin SDK to mint a token for your uid.
- Add **Web Push** delivery: service-worker `push` listener + VAPID keys (store in
  Secret Manager) so nudges pop on the phone. (Optional: email via Gmail API —
  requires authorizing the Gmail connector in an interactive session.)

### 3. ~~Ship the PWA (icons)~~ — done
- `frontend/src/assets/icons/icon-192.png` and `icon-512.png` now exist (cropped
  from `LifestyleFY/NutriBear-Lifestyle4U.svg` — the badge mark only, the
  "LifestyleFY / Nutrition App" text banner at the bottom of that file is
  excluded). Referenced by `manifest.webmanifest`; confirmed present in
  `ng build` output at `dist/lifestylefy/browser/assets/icons/`.

### 4. Optional
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
