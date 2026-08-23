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
TARGET="${1:-all}"

gcloud config set project "$PROJECT_ID" >/dev/null

if [[ "$TARGET" != "all" ]]; then
  echo "Usage: $0 [all]" >&2
  exit 1
fi

echo "==> Scheduler shared-secret (compared against SCHEDULER_SECRET env var on the backend)"
# No Firestore indexes needed: the sweep does one unfiltered
# collection-group scan of notification_prefs instead of per-field queries.
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

echo "==> Notification sweep job (meal reminders + coach nudges, every 4 hours)"
create_job notification-sweep "/internal/notifications/sweep" "0 */4 * * *"

echo "==> DONE. 1 Cloud Scheduler job created in ${REGION} (runs 6x/day: 00:00/04:00/08:00/12:00/16:00/20:00 ${TIME_ZONE})."
echo "==> If migrating from the old 6-job setup, delete them once the new job is verified, e.g.:"
echo "    gcloud scheduler jobs delete meal-check-breakfast meal-check-lunch meal-check-snack meal-check-dinner coach-nudge-afternoon coach-nudge-night --location=${REGION}"
