# Deployment & Local Testing Guide

Covers running the backend and frontend locally, and deploying both to GCP/Firebase.
For a project overview see [README.md](README.md); for what's left to build see
[NEXT_STEPS.md](NEXT_STEPS.md).

## Prerequisites

- **Python 3.12+** and **Node 20+**
- **gcloud CLI** — [install](https://cloud.google.com/sdk/docs/install), then `gcloud auth login`
- **firebase-tools** — `npm install -g firebase-tools`, then `firebase login`
- A **Google Cloud project** with billing enabled (Cloud Run/BigQuery/Firestore all have
  generous free tiers — see the cost note in the README)

## Getting API keys

| Key | Where to get it | Required? |
|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) → Create API key | Yes, for AI coaching/goal-suggest/recipes |
| `CHOMP_API_KEY` | [Chomp](https://chompthis.com/api/) (paid, ~$25/mo tier) | No — only needed for name/ingredient *search*; barcode scanning works via Open Food Facts (free, public) without it |

Both go into Secret Manager during Phase 0 below, and into `backend/.env` for local dev.

## One-time GCP + Firebase project setup

1. **Create/select a GCP project** and note its project ID.
2. **Run Phase 0**: edit the `PROJECT_ID`, `WORKOUT_SHEET_ID` variables at the top of
   `infra/00_setup.sh`, then:
   ```bash
   cd LifestyleFY
   bash infra/00_setup.sh
   ```
   This enables the required APIs, creates the Firestore database, BigQuery dataset +
   tables, a `nutrition-run` service account with the right IAM roles, and prompts you
   to paste in the Gemini/Chomp keys (stored in Secret Manager).
3. **Register Firebase on the project** (needed for Auth + Hosting):
   - Go to the [Firebase Console](https://console.firebase.google.com/), click
     **Add project**, and select your existing GCP project (don't create a new one).
   - Add a **Web app** to the Firebase project (</> icon) — this gives you the
     `firebaseConfig` object (`apiKey`, `authDomain`, `appId`, etc.). Firebase web API
     keys are meant to be public/client-embedded, unlike the Gemini/Chomp keys above.
   - Go to **Authentication → Sign-in method → Google**, toggle **Enable**, pick a
     support email, save. This auto-provisions the OAuth client Google Sign-In needs.
4. **Paste the `firebaseConfig` values** into
   `frontend/src/environments/environment.ts` and `environment.prod.ts`.
5. **Seed the access allowlist** (see [Managing access](#managing-access) below) with
   your own email so you're not locked out once auth is enforced.

## Local testing — backend

```bash
cd LifestyleFY/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # fill in GEMINI_API_KEY at minimum
uvicorn app.main:app --reload --port 8080
```

With the `.env.example` defaults (`DEV_NO_AUTH=true`, `USE_STUBS=true`) the API runs
fully offline — no GCP calls, no auth required, in-memory data. Exercise it end-to-end
with:

```bash
./smoke_test.sh          # hits /health /profile /goals/suggest /scan /log /today /coach /recipes
```

To test against **real** Firestore/BigQuery/Gemini locally, set `USE_STUBS=false` in
`.env` (keep `DEV_NO_AUTH=true` unless you also want to test real Firebase tokens
locally) and make sure you're `gcloud auth application-default login`'d with access to
the project.

## Local testing — frontend

```bash
cd LifestyleFY/frontend
npm install
npm start                  # http://localhost:4200
```

`environment.ts` (the dev config) currently points `apiBase` at the deployed Cloud Run
URL rather than `localhost:8080` — change it if you want the local Angular dev server
talking to your local backend instead. Since `useAuth: true`, you'll need to sign in
with an allowlisted Google account either way (see below) — the deployed backend
enforces auth regardless of which frontend is calling it.

## Deploying — backend (Cloud Run)

`gcloud run deploy --source` occasionally falls back to Buildpacks instead of honoring
`backend/Dockerfile`, which fails (buildpacks expect `main.py`/`app.py` at the root,
not `app.main:app`). Build and deploy as two explicit steps instead, which always
honors the Dockerfile:

```bash
cd LifestyleFY

# 1. Build the image (always uses backend/Dockerfile)
gcloud builds submit backend \
  --tag us-central1-docker.pkg.dev/YOUR_PROJECT_ID/cloud-run-source-deploy/nutrition-api

# 2. Deploy it
gcloud run deploy nutrition-api \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/cloud-run-source-deploy/nutrition-api \
  --region us-central1 \
  --service-account nutrition-run@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars "^;^GCP_PROJECT=YOUR_PROJECT_ID;BQ_DATASET=nutrition;WORKOUT_SHEET_ID=YOUR_SHEET_ID;CORS_ORIGINS=http://localhost:4200,https://YOUR_PROJECT_ID.web.app,https://YOUR_PROJECT_ID.firebaseapp.com" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,CHOMP_API_KEY=CHOMP_API_KEY:latest" \
  --allow-unauthenticated
```

Notes:
- `CORS_ORIGINS` contains commas (it's itself a comma-separated list), which conflicts
  with `--set-env-vars`'s own comma delimiter — the `^;^` prefix switches the
  delimiter to `;` so the value passes through intact.
- `--allow-unauthenticated` is safe here: it only controls whether Cloud Run's
  infrastructure layer requires an IAM-level token. The app itself still rejects every
  request without a valid Firebase ID token from an allowlisted email (`app/auth.py`).
  Don't deploy without also enforcing that allowlist (see below), or any Google
  account can use the API.
- Re-run both steps after any backend code change; there's no CI/CD wired up.

## Deploying — frontend (Firebase Hosting)

One-time setup (already done in this repo — `frontend/firebase.json` and
`frontend/.firebaserc` are checked in):

```json
// firebase.json
{ "hosting": { "public": "dist/lifestylefy/browser",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }] } }
```

```json
// .firebaserc
{ "projects": { "default": "YOUR_PROJECT_ID" } }
```

Build and deploy:

```bash
cd LifestyleFY/frontend
npm run build -- --configuration production   # uses environment.prod.ts
firebase deploy --only hosting
```

The Angular `production` build config (`angular.json`) swaps in
`environment.prod.ts` automatically via `fileReplacements` — make sure its `apiBase`
points at your deployed Cloud Run URL before building.

## Managing access

The backend requires a valid Firebase ID token **and** the token's email must be in
the `config/access` Firestore document (`allowed_emails` array, `(default)`
database) — see `app/auth.py`. This is deliberately editable without a redeploy:

1. Open [Firestore Data](https://console.firebase.google.com/project/_/firestore/data)
   in the Firebase Console → `config` → `access`.
2. Edit the `allowed_emails` array — add or remove emails directly.

Changes take effect within 60 seconds (in-process cache TTL in `auth.py`). Seed the
document once via the console UI, or with:

```bash
PROJECT=YOUR_PROJECT_ID
TOKEN=$(gcloud auth print-access-token)
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"allowed_emails": {"arrayValue": {"values": [{"stringValue": "you@example.com"}]}}}}' \
  "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/config/access"
```

## Troubleshooting

- **`bad substitution` running `00_setup.sh`** — `PROJECT_ID` at the top must be a
  literal value or `"${PROJECT_ID:-default-value}"`, not `"${your-project-id:-...}"`
  (bash reads what's between `${` and `:-` as a variable *name*, not a value).
- **Cloud Run build fails with "provide a main.py or app.py"** — Buildpacks ran
  instead of the Dockerfile. Use the two-step `gcloud builds submit` +
  `gcloud run deploy --image` flow above instead of `--source`.
- **`{"detail":"Missing bearer token"}` when calling the deployed API directly** —
  expected. `smoke_test.sh` assumes `DEV_NO_AUTH=true` (local stub mode); the deployed
  backend enforces real Firebase auth. Test the deployed API through the signed-in
  frontend, or run the backend locally in stub mode instead.
- **`{"detail":"Not authorized"}` after signing in** — your email isn't in the
  `config/access` allowlist yet (see above).
- **CORS errors in the browser console** — the frontend's origin isn't in the
  backend's `CORS_ORIGINS` env var; redeploy the backend with it added.
