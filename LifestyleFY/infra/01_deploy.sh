#!/usr/bin/env bash
# Deploy the backend (Cloud Run) and frontend (Firebase Hosting), plus any
# pending BigQuery schema migration. Assumes 00_setup.sh has already run once.
#
#   bash infra/01_deploy.sh            # deploy everything
#   bash infra/01_deploy.sh backend    # backend + migration only
#   bash infra/01_deploy.sh frontend   # frontend only
#
# Re-run after any backend/frontend code change — there's no CI/CD wired up.
set -euo pipefail

# ----- EDIT THESE (same values as infra/00_setup.sh) -----
PROJECT_ID="${PROJECT_ID:-gen-lang-client-0347523959}"
REGION="${REGION:-us-central1}"
DATASET="nutrition"
SA_NAME="nutrition-run"
WORKOUT_SHEET_ID="${WORKOUT_SHEET_ID:-1E7FIHlr2-_KCVCSOBqnTr6v3ymhlJ9RXnYkm5loXjww}"
CORS_ORIGINS="http://localhost:4200,https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
# -----------------------------------------------------------
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/nutrition-api"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

TARGET="${1:-all}"

migrate_bigquery () {
  echo "==> BigQuery: applying food_log schema migration (additive, safe to re-run)"
  bq query --project_id="$PROJECT_ID" --use_legacy_sql=false <<SQL
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS sugar_g FLOAT64;
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS fiber_g FLOAT64;
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS sat_fat_g FLOAT64;
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS sodium_mg FLOAT64;
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS meal_instance INT64;
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS grams FLOAT64;
ALTER TABLE ${DATASET}.food_log ADD COLUMN IF NOT EXISTS log_date STRING;
SQL
}

deploy_backend () {
  echo "==> Backend: building image via Cloud Build"
  gcloud builds submit "$ROOT_DIR/backend" \
    --project "$PROJECT_ID" \
    --tag "$IMAGE"

  echo "==> Backend: deploying to Cloud Run"
  gcloud run deploy nutrition-api \
    --project "$PROJECT_ID" \
    --image "$IMAGE" \
    --region "$REGION" \
    --service-account "$SA_EMAIL" \
    --set-env-vars "^;^GCP_PROJECT=${PROJECT_ID};BQ_DATASET=${DATASET};WORKOUT_SHEET_ID=${WORKOUT_SHEET_ID};CORS_ORIGINS=${CORS_ORIGINS}" \
    --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,CHOMP_API_KEY=CHOMP_API_KEY:latest" \
    --allow-unauthenticated

  echo "==> Backend: smoke test"
  SERVICE_URL="$(gcloud run services describe nutrition-api --project "$PROJECT_ID" \
    --region "$REGION" --format='value(status.url)')"
  curl -sf "${SERVICE_URL}/health" && echo " <- /health OK (${SERVICE_URL})"
}

deploy_frontend () {
  echo "==> Frontend: production build"
  (cd "$ROOT_DIR/frontend" && npm run build -- --configuration production)

  echo "==> Frontend: deploying to Firebase Hosting"
  (cd "$ROOT_DIR/frontend" && firebase deploy --only hosting --project "$PROJECT_ID")
}

case "$TARGET" in
  all)
    migrate_bigquery
    deploy_backend
    deploy_frontend
    ;;
  backend)
    migrate_bigquery
    deploy_backend
    ;;
  frontend)
    deploy_frontend
    ;;
  *)
    echo "Usage: $0 [all|backend|frontend]" >&2
    exit 1
    ;;
esac

echo "==> Done."
