# LifestyleFY — Next Steps

Snapshot of where the build stands and what's left. Full architecture/cost is in
the planning doc at `G:\My Drive\WorkoutPlan` (plan file
`codebck-this-is-my-glittery-donut.md`).

## Where things stand (done)

- **Repo moved** off Google Drive to `C:\Users\shafay\Documents\_NeverBackup\LifestyleFY`.
- **Backend** (`backend/`): FastAPI service with every planned endpoint wired —
  `/scan /search /inventory /log /today /goals /goals/suggest /goals/next /recipes
  /grocery /coach /coach/messages /summary`. Layered food resolver
  (cache → Open Food Facts → Chomp → manual), Firestore + BigQuery dual-write,
  deterministic goal math + Gemini coaching. Runs **offline** with
  `USE_STUBS=true` + `DEV_NO_AUTH=true` (already the `.env.example` defaults).
- **Frontend** (`frontend/`): Angular 19 PWA, 6 tabs (Today, Scan, Log, Pantry,
  Goals, Coach), in-browser camera scanning via `@zxing/browser`, typed API client.
- **Infra** (`infra/`): `00_setup.sh` (gcloud), `bigquery_schema.sql`,
  `firestore_structure.md`.

## Not started / to do

### 0. Local verification (do first, ~30 min)
- Install **Python 3.12** and **Node 20+** (neither is on this machine yet).
- Backend: `cd backend && python -m venv .venv && source .venv/Scripts/activate &&
  pip install -r requirements.txt && cp .env.example .env && uvicorn app.main:app --reload --port 8080`
- Run `bash smoke_test.sh` — exercises profile → goal-suggest → real barcode scan →
  log → coach nudge, all offline.
- Frontend: `cd frontend && npm install && npm start` → http://localhost:4200.
  If `npm install` complains about versions, nudge the `@zxing/*` or Angular pins.

### 1. Phase 0 — GCP resources (when moving off stubs)
- Run `infra/00_setup.sh` (edit `PROJECT_ID`, `WORKOUT_SHEET_ID` at top first).
- Put the **Gemini API key** in Secret Manager (script prompts). Chomp key optional
  — leave stubbed until you want name/ingredient *search* ($25/mo tier).
- Flip backend `.env`: `USE_STUBS=false`. Deploy with the `gcloud run deploy`
  command the script prints.

### 2. Phase 5 — Workout-app overview integration (deferred by choice)
- Backend already has `store.sync_summary_to_sheet()` — it writes a
  `NutritionSummary` tab row to the workout spreadsheet. Share that sheet with the
  Cloud Run service account (Editor) so it can write.
- Edit `CodeBck/Code.gs`: replace `getNutritionForDay()` (line ~421) with
  `getNutritionOverview()` reading the `NutritionSummary` tab; keep the old static
  version as fallback if the tab is empty.
- Edit `CodeBck/index.html.html`: update `renderNutrition(n)` (line ~898) to draw a
  live consumed-vs-goal card + latest coach tip. Reuse existing `.nutrition-card`
  CSS and the `google.script.run.withSuccessHandler` pattern.

### 3. Auth (before using on phone with real data)
- Wire **Firebase Auth**: set `environment.useAuth=true`, add an Angular
  HttpInterceptor that attaches `Authorization: Bearer <firebase-id-token>`, and set
  backend `DEV_NO_AUTH=false`.

### 4. Phase 4 polish — proactive coach nudges
- Add **Cloud Scheduler** jobs hitting `/coach` at meal checkpoints (e.g. 14:00,
  18:30). Endpoint already computes behind-pace and generates a Gemini suggestion.
- Add **Web Push** delivery: service-worker `push` listener + VAPID keys (store in
  Secret Manager) so nudges pop on the phone. (Optional: email via Gmail API —
  requires authorizing the Gmail connector in an interactive session.)

### 5. Ship the PWA
- Add real icons under `frontend/src/assets/icons/` (192 + 512 px).
- Set `environment.prod.ts` `apiBase` to the Cloud Run URL.
- `npm run build` → deploy `dist/lifestylefy/browser` to Firebase Hosting (HTTPS,
  which the camera scanner requires on mobile).

### 6. Optional
- **Looker Studio** dashboard on BigQuery for weight/intake/adherence trends (free).
- **Prepared-food scanning** (lower priority) already flows through `/scan`.

## Known integration risks to confirm on first real call
- **Chomp** JSON parsing (`backend/app/services/food.py: _parse_chomp`) is written
  against their documented shape but unverified without a live key.
- **Gemini SDK** version pin (`google-genai`) — bump if the `Client` API has moved.
- **Angular / @zxing** version pins — confirmed only at `npm install` time.

## Cost reminder
Everything targets free tiers: ~**$0–3/mo** total (Gemini pennies; Chomp only if you
enable paid search at $25/mo). Cloud Run scales to zero when idle.
