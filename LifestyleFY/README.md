# LifestyleFY — Nutrition App

A personal nutrition system: barcode-scan groceries into an inventory, log meals, track macros against goals, and get AI (Gemini) coaching nudges. Backend is FastAPI on Cloud Run with Firestore (hot state) + BigQuery (history). Frontend is an Angular PWA with in-browser camera scanning. Integrates a live daily summary back into the existing Google Apps Script workout app (`CodeBck` in Google Drive).

This repo lives **outside Google Drive** (in `_NeverBackup`) on purpose — `node_modules`, build output, and `.venv` should not sync to Drive. The planning doc and the existing workout app remain in `G:\My Drive\WorkoutPlan`.

```
LifestyleFY/
├── backend/            FastAPI service (buildable core, runs offline in stub mode)
│   ├── app/
│   │   ├── main.py             FastAPI app + route registration
│   │   ├── config.py           Settings from env / Secret Manager
│   │   ├── auth.py             Firebase ID-token verification dependency
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
└── README.md
```

## Run both locally (backend stub mode + Angular)

```bash
# Terminal 1 — backend (offline stubs, no GCP needed)
cd backend && uvicorn app.main:app --reload --port 8080
# Terminal 2 — frontend
cd frontend && npm install && npm start        # http://localhost:4200
```

## Quick start (local dev)

```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cp .env.example .env                                     # then fill in values
uvicorn app.main:app --reload --port 8080
# In another shell:
./smoke_test.sh
```

With `DEV_NO_AUTH=true` and `USE_EMULATORS=true` (see `.env.example`) the service runs without real GCP — Firestore/BigQuery/Gemini calls are stubbed so you can exercise the API offline.

## Deploy order (see `infra/00_setup.sh`)

1. **Phase 0** — run `infra/00_setup.sh` once to create the GCP project resources, BigQuery dataset/tables, service account, and secrets.
2. **Phase 1** — deploy backend to Cloud Run (`gcloud run deploy`, command at the bottom of `00_setup.sh`).
3. **Phase 2+** — build the Angular PWA, wire scanning, then the coach crons and the workout-app summary sync.

Everything here targets the free tiers; expected cost ~$0–3/mo (Gemini pennies; Chomp only if you enable paid search). Full cost table is in the planning doc.
