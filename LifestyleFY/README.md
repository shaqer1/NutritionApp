# LifestyleFY — Nutrition App

A personal nutrition system: scan a barcode to look up (and stock) groceries, log
meals against macro goals, get AI-generated goal suggestions and recipe ideas, and
receive Gemini-powered coaching nudges when you're behind pace for the day.

## What it does

- **Scan** — point your phone camera at a barcode; resolves via a layered lookup
  (local cache → Open Food Facts → Chomp → manual entry) and adds it to your pantry
  or logs it straight to a meal.
- **Log** — record meals with macros, either from a scan, your pantry, or manual entry.
- **Today** — consumed-vs-goal macro bars for the day, updated live.
- **Goals** — set targets manually, or ask Gemini to suggest a bulk/cut/maintain
  macro split from your profile.
- **Pantry** — track what's in stock from past scans.
- **Coach** — Gemini checks your pace against your goals at meal checkpoints and
  nudges you if you're off track; also generates recipe/grocery suggestions from
  your remaining macros for the day.
- Optionally syncs a live daily summary into an existing Google Apps Script workout
  app (`CodeBck`).

Sign-in is Google (Firebase Auth), gated to an email allowlist you manage from the
Firebase Console — see [Managing access](DEPLOYMENT.md#managing-access).

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
├── frontend/           Angular 19 PWA (scan, log, goals, coach) — see frontend/README.md
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
