# LifestyleFY — Nutrition App

A personal nutrition system: scan a barcode to look up (and stock) groceries, log
meals against macro goals, get AI-generated goal suggestions and recipe ideas, and
receive Gemini-powered coaching nudges when you're behind pace for the day.

## What it does

- **Scan** — point your phone camera at a barcode; resolves via a layered lookup
  (local cache → Open Food Facts → Chomp → manual entry) and adds it to your pantry
  or logs it straight to a meal.
- **Manual entry** — a third Add/Scan tab for hand-entering an ingredient from
  scratch: name, category, location, servings, all 8 macros, image URL, and a
  free-text ingredients list — no barcode/AI match required.
- **Log** — record meals with macros, either from a scan, your pantry, or manual entry.
- **Today** — consumed-vs-goal macro bars for the day, plus an itemized table of
  everything logged that day, with inline edit/delete per entry (and a quick
  delete from the Inventory tab's Log view too) — corrects the log's own data
  only, it never re-adjusts a linked pantry item's quantity.
- **Goals** — set targets manually, or ask Gemini to suggest a bulk/cut/maintain
  macro split from your profile.
- **Pantry** — track what's in stock, grouped by Pantry/Fridge/Freezer or all
  together in one "All" tab, with a toggle to hide anything you've run out of.
- **Recipes** — ask Gemini to draft one from what's actually in your pantry, or
  build one manually from scratch; every ingredient added to a recipe is picked
  from your pantry (never free text), so it always links back to real inventory.
  Recipes can carry an image URL and are saved with an Active/Archived lifecycle
  (archive to hide, restore, or delete permanently). Check "I just cooked this"
  when saving a manual recipe and it uses up the linked pantry ingredients by the
  servings picked, then adds the finished meal itself as a new fridge item
  (category "Takeout & Prepared Meals") — per-serving macros and grams are
  computed by summing the ingredients used, one serving per container, servings
  per container = however many the recipe makes.
- **Groceries** — Gemini returns a structured, editable list (items grouped by
  store section, plus a numbered list of swap/substitution suggestions based on
  your recent macro history) instead of a one-off block of text. Save it, edit it
  later, and archive/restore/delete it the same way as recipes.
- **Coach** — Gemini checks your pace against your goals at meal checkpoints and
  nudges you if you're off track. Your profile (including sex, dietary
  preferences, and allergies — the AI avoids listed allergens when suggesting
  recipes/groceries) is editable right on the Coach tab.
- Optionally syncs a live daily summary into an existing Google Apps Script workout
  app (`CodeBck`) — active in this deployment, see [Workout-sheet sync](#workout-sheet-sync).

Sign-in is Google (Firebase Auth), gated to an email allowlist you manage from the
Firebase Console — see [Managing access](DEPLOYMENT.md#managing-access).

## Current status

This isn't a prototype — it's a working, deployed app with real auth, real data,
and a real AI backend, and it's built to be forked and self-hosted by anyone:

- **Live right now**: backend on Cloud Run, frontend on Firebase Hosting, both
  reachable and serving real traffic behind Google Sign-In + an email allowlist.
- **Yes, you can clone this repo, stand up your own GCP/Firebase project, and run
  your own independent copy** — nothing here is hardcoded to this deployment
  except the placeholder project ID/URLs in the docs below, which you swap for
  your own. The one-time setup script (`infra/00_setup.sh`) provisions Firestore,
  BigQuery, IAM, and secrets for you; [DEPLOYMENT.md](DEPLOYMENT.md) walks through
  every step end-to-end, from "no GCP account yet" to a deployed instance only you
  (or whoever you allowlist) can sign into.
- **Not yet done**: proactive/scheduled coach nudges (Cloud Scheduler + push),
  and the workout-app dashboard integration described below. Neither blocks
  self-hosting — see [NEXT_STEPS.md](NEXT_STEPS.md) for the full snapshot of
  what's done vs. outstanding.

### Screenshots

<!-- TODO: add screenshots — Today, Scan, Goals, Coach tabs -->
| Today | Scan | Coach |
|---|---|---|
| _placeholder_ | _placeholder_ | _placeholder_ |

## Architecture

Backend is FastAPI on Cloud Run with Firestore (hot state, per-user) + BigQuery
(append-only history). Frontend is an Angular 19 PWA with in-browser camera scanning.

```
LifestyleFY/
├── backend/            FastAPI service (buildable core, runs offline in stub mode)
│   ├── app/
│   │   ├── main.py             FastAPI app + route registration
│   │   ├── config.py           Settings from env / Secret Manager
│   │   ├── auth.py             Firebase ID-token verification + email allowlist
│   │   ├── models.py           Pydantic request/response models
│   │   ├── routes/             HTTP endpoints
│   │   └── services/
│   │       ├── store.py        Firestore + BigQuery writes, today_summary, Sheets sync
│   │       ├── food.py         Layered resolver: cache → OFF → Chomp → manual
│   │       └── coach.py        Gemini: nudges, goal-setting, recipes, grocery
│   ├── requirements.txt · Dockerfile · .env.example · smoke_test.sh
├── frontend/           Angular 19 PWA (Today, Inventory, Groceries, Recipes,
│                       Coach) — see frontend/README.md
├── infra/
│   ├── 00_setup.sh             gcloud: enable APIs, create resources, secrets
│   ├── bigquery_schema.sql     Dataset + 4 partitioned tables
│   └── firestore_structure.md  Firestore collection/doc layout
├── DEPLOYMENT.md       Full local-testing + deploy guide (start here to run your own)
├── NEXT_STEPS.md       Current status + what's left to build
└── README.md
```

## Running your own instance

This app is designed to be forked and self-hosted — everything targets GCP/Firebase
free tiers (expected cost ~$0–3/mo; Gemini is pennies, Chomp only if you enable its
paid search tier).

1. **Get API keys**: a free [Gemini API key](https://aistudio.google.com/apikey) is
   required; Chomp is optional (barcode scanning works without it via Open Food
   Facts). See [DEPLOYMENT.md](DEPLOYMENT.md#getting-api-keys) for details.
2. **Run the one-time GCP + Firebase setup** (`infra/00_setup.sh`, registering
   Firebase, enabling Google Sign-In) — see
   [DEPLOYMENT.md](DEPLOYMENT.md#one-time-gcp--firebase-project-setup).
3. **Test locally** — both backend and frontend run fully offline against stub
   data with no GCP account needed, so you can try it before deploying anything —
   see [DEPLOYMENT.md](DEPLOYMENT.md#local-testing--backend).
4. **Deploy** — backend to Cloud Run, frontend to Firebase Hosting — see
   [DEPLOYMENT.md](DEPLOYMENT.md#deploying--backend-cloud-run).

Quick local smoke test, no GCP/Firebase account needed:

```bash
# Terminal 1 — backend (offline stubs)
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env
uvicorn app.main:app --reload --port 8080
# Terminal 2 — smoke test
./smoke_test.sh
# Terminal 3 — frontend
cd frontend && npm install && npm start        # http://localhost:4200
```

Full instructions, troubleshooting, and the deploy commands are in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Workout-sheet sync

Yes — still active. `WORKOUT_SHEET_ID` is set (in `backend/.env` locally and as a
Cloud Run env var in production) to a real Google Sheet ID, and
`Store.sync_summary_to_sheet()` (`backend/app/services/store.py`) writes a
`NutritionSummary!A2:K2` row with today's consumed/goal macros + latest coach tip
after every `/log` and `/coach` call (`backend/app/routes/api.py`). It's a
best-effort, non-blocking write: it silently no-ops in stub mode or if
`WORKOUT_SHEET_ID` is unset, so it never breaks logging/coaching if the sheet
becomes unreachable. The write side is done; the workout app's own UI hasn't been
updated to *read* that tab yet — that's the deferred integration tracked in
[NEXT_STEPS.md](NEXT_STEPS.md#1-phase-5-workout-app-overview-integration-deferred-by-choice).
