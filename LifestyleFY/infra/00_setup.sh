#!/usr/bin/env bash
# Phase 0 — one-time GCP + Firebase foundation for the nutrition app.
# Run interactively (it needs your gcloud auth). Review before running.
#
#   gcloud auth login
#   bash infra/00_setup.sh
#
# Idempotent-ish: creating things that already exist will warn, not fail hard.
set -euo pipefail

# ----- EDIT THESE -----
PROJECT_ID="${PROJECT_ID:-gen-lang-client-0347523959}"
REGION="${REGION:-us-central1}"
DATASET="nutrition"
SA_NAME="nutrition-run"                       # Cloud Run service account
WORKOUT_SHEET_ID="${WORKOUT_SHEET_ID:-1E7FIHlr2-_KCVCSOBqnTr6v3ymhlJ9RXnYkm5loXjww}"  # for summary sync
# ----------------------
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Set project"
gcloud config set project "$PROJECT_ID"

echo "==> Enable APIs"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  bigquery.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  sheets.googleapis.com \
  aiplatform.googleapis.com \
  generativelanguage.googleapis.com

echo "==> Firestore (Native mode)"
gcloud firestore databases create --location="$REGION" 2>/dev/null || \
  echo "   (Firestore db may already exist — continuing)"

echo "==> BigQuery dataset + tables"
bq --location="$REGION" mk --dataset "${PROJECT_ID}:${DATASET}" 2>/dev/null || \
  echo "   (dataset may already exist — continuing)"
bq query --use_legacy_sql=false < "$(dirname "$0")/bigquery_schema.sql"

echo "==> Service account for Cloud Run"
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Nutrition Cloud Run" 2>/dev/null || echo "   (SA may already exist)"

for ROLE in roles/datastore.user roles/bigquery.dataEditor roles/bigquery.jobUser \
            roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" >/dev/null
done
echo "   Roles granted to ${SA_EMAIL}"

echo "==> Secrets (paste values when prompted; leave Chomp empty for now if unused)"
create_secret () {
  local name="$1"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    echo "   secret $name exists — add a new version? (Ctrl-C to skip)"
  else
    gcloud secrets create "$name" --replication-policy=automatic
  fi
  echo "   Enter value for $name (input hidden):"
  read -rs VALUE
  printf '%s' "$VALUE" | gcloud secrets versions add "$name" --data-file=-
}
create_secret GEMINI_API_KEY
create_secret CHOMP_API_KEY   || true

echo
echo "==> Grant the Cloud Run SA access to the workout spreadsheet:"
echo "    Share ${WORKOUT_SHEET_ID} with ${SA_EMAIL} (Editor) in Google Sheets UI"
echo "    so the summary-sync can write the NutritionSummary tab."
echo
cat <<EOF
==> DONE. Deploy the backend with:

  gcloud run deploy nutrition-api \\
    --source backend \\
    --region ${REGION} \\
    --service-account ${SA_EMAIL} \\
    --set-env-vars "GCP_PROJECT=${PROJECT_ID},BQ_DATASET=${DATASET},WORKOUT_SHEET_ID=${WORKOUT_SHEET_ID}" \\
    --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,CHOMP_API_KEY=CHOMP_API_KEY:latest" \\
    --allow-unauthenticated

(Auth is enforced in-app via Firebase ID tokens, so --allow-unauthenticated is fine:
 the app rejects requests without a valid token. Lock down later with IAM if desired.)
EOF
