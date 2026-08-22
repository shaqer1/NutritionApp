#!/usr/bin/env bash
# Phase 2 — push notifications: shared-secret + Cloud Scheduler jobs.
# Run after 00_setup.sh and after the backend has been deployed at least once.
#
#   bash infra/02_notifications_setup.sh
#
# Idempotent-ish: creating things that already exist will warn, not fail hard.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0347523959}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-nutrition-api}"
# IANA name (not a fixed UTC offset) so CST/CDT daylight-saving shift is handled automatically.
TIME_ZONE="${TIME_ZONE:-America/Chicago}"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Scheduler shared-secret (compared against SCHEDULER_SECRET env var on the backend)"
if gcloud secrets describe SCHEDULER_SECRET >/dev/null 2>&1; then
  echo "   secret SCHEDULER_SECRET exists — add a new version? (Ctrl-C to skip)"
else
  gcloud secrets create SCHEDULER_SECRET --replication-policy=automatic
fi
echo "   Enter value for SCHEDULER_SECRET (input hidden):"
read -rs SCHEDULER_SECRET
printf '%s' "$SCHEDULER_SECRET" | gcloud secrets versions add SCHEDULER_SECRET --data-file=-

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)')"
echo "==> Backend URL: $SERVICE_URL"

echo "==> Remember to redeploy with the secret wired in, e.g.:"
cat <<EOF
  gcloud run deploy ${SERVICE_NAME} --source backend --region ${REGION} \\
    --update-secrets "SCHEDULER_SECRET=SCHEDULER_SECRET:latest"
EOF

create_job () {
  local name="$1" path="$2" schedule="$3"
  gcloud scheduler jobs create http "$name" \
    --location="$REGION" \
    --schedule="$schedule" \
    --time-zone="$TIME_ZONE" \
    --uri="${SERVICE_URL}${path}" \
    --http-method=POST \
    --headers="X-Scheduler-Secret=${SCHEDULER_SECRET}" \
    2>/dev/null || echo "   (job $name may already exist — edit it manually if the secret rotated)"
}

echo "==> Meal reminder jobs (deterministic, no AI — midpoint of each window)"
create_job meal-check-breakfast "/internal/notifications/meal-check?meal=breakfast" "0 11 * * *"
create_job meal-check-lunch     "/internal/notifications/meal-check?meal=lunch"     "0 14 * * *"
create_job meal-check-snack     "/internal/notifications/meal-check?meal=snack"     "0 17 * * *"
create_job meal-check-dinner    "/internal/notifications/meal-check?meal=dinner"    "0 21 * * *"

echo "==> Coach nudge jobs (AI-generated, twice a day)"
create_job coach-nudge-afternoon "/internal/notifications/coach-nudge" "0 17 * * *"
create_job coach-nudge-night     "/internal/notifications/coach-nudge" "0 22 * * *"

echo "==> DONE. 6 Cloud Scheduler jobs created in ${REGION} (times are project default timezone — use --time-zone if needed)."
