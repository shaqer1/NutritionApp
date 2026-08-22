#!/usr/bin/env bash
# End-to-end smoke test against a locally running server in stub mode
# (DEV_NO_AUTH=true, USE_STUBS=true). Start the server first:
#   uvicorn app.main:app --reload --port 8080
set -euo pipefail
BASE="${BASE:-http://localhost:8080}"
j() { python -c "import sys,json;print(json.dumps(json.load(sys.stdin),indent=2))"; }

echo "== health =="
curl -s "$BASE/health" | j

echo "== set profile (120 lb, 5'10\") =="
curl -s -X PUT "$BASE/profile" -H 'content-type: application/json' -d '{
  "weight_lb":120,"height_in":70,"age":30,"sex":"male",
  "activity_level":"moderate","dietary_prefs":["high-protein"],"allergies":[]
}' | j

echo "== ai-suggest bulking goals =="
curl -s -X POST "$BASE/goals/suggest" -H 'content-type: application/json' \
  -d '{"phase":"bulk"}' | j

echo "== scan a real barcode (Open Food Facts, Nutella) =="
curl -s -X POST "$BASE/scan" -H 'content-type: application/json' \
  -d '{"barcode":"3017620422003"}' | j || true

echo "== log a meal =="
curl -s -X POST "$BASE/log" -H 'content-type: application/json' -d '{
  "meal":"lunch","item_name":"Chicken & rice","servings":1,
  "macros":{"cal":650,"protein":50,"carbs":70,"fat":15}
}' | j

echo "== today summary =="
curl -s "$BASE/today" | j

echo "== coach nudge (dinner check) =="
curl -s -X POST "$BASE/coach" -H 'content-type: application/json' \
  -d '{"meal":"dinner","time_label":"6:30pm"}' | j

echo "== recipes from remaining macros =="
curl -s -X POST "$BASE/recipes" | j

echo "== push notifications: register token, set prefs, test send =="
curl -s -X POST "$BASE/device-tokens" -H 'content-type: application/json' \
  -d '{"token":"smoke-test-token","platform":"web"}' | j
curl -s -X PUT "$BASE/notification-prefs" -H 'content-type: application/json' -d '{
  "coach_nudges": true,
  "meals": {"breakfast": true, "lunch": false, "snack": false, "dinner": false}
}' | j
curl -s -X POST "$BASE/notifications/test" | j
curl -s -X DELETE "$BASE/device-tokens/smoke-test-token" | j

# Scheduled (Cloud Scheduler) endpoints — needs SCHEDULER_SECRET set on both
# the running server and this shell to the same value; skipped otherwise.
if [ -n "${SCHEDULER_SECRET:-}" ]; then
  echo "== push notifications: scheduled meal-check + coach-nudge =="
  curl -s -X POST "$BASE/internal/notifications/meal-check?meal=breakfast" \
    -H "X-Scheduler-Secret: $SCHEDULER_SECRET" | j
  curl -s -X POST "$BASE/internal/notifications/coach-nudge" \
    -H "X-Scheduler-Secret: $SCHEDULER_SECRET" | j
else
  echo "== push notifications: scheduled endpoints skipped (set SCHEDULER_SECRET to test) =="
fi
