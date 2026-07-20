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

### 3. Ship the PWA (icons)
- Add real icons under `frontend/src/assets/icons/` (192 + 512 px) — currently just
  `.gitkeep`, no icons yet, so "Add to Home Screen" will use a default icon.

### 4. Optional
- **Looker Studio** dashboard on BigQuery for weight/intake/adherence trends (free).
- **Prepared-food scanning** (lower priority) already flows through `/scan`.

## Known integration risks to confirm on first real call
- **Chomp** JSON parsing (`backend/app/services/food.py: _parse_chomp`) is written
  against their documented shape but unverified without a live key — currently
  stubbed/unused since no Chomp key is active.
- **Gemini SDK** version pin (`google-genai`) — bump if the `Client` API has moved.
- **Angular / @zxing** version pins — confirmed only at `npm install` time.

## Security note
`backend/.env` (containing the original Gemini/Chomp keys) was committed to git and
pushed to `origin/main` before this was caught. It's now untracked going forward
(`.gitignore` fixed), but **the old keys are still visible in git history** on
GitHub until that history is rewritten. Rotating both keys is recommended regardless
of history cleanup, since committed secrets should be treated as compromised.

## Cost reminder
Everything targets free tiers: ~**$0–3/mo** total (Gemini pennies; Chomp only if you
enable paid search at $25/mo). Cloud Run scales to zero when idle.
