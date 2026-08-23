-- BigQuery schema for the nutrition app (dataset: nutrition)
-- Run with: bq query --use_legacy_sql=false < bigquery_schema.sql
-- (or paste into the BigQuery console). Replace @PROJECT if your tooling
-- does not set a default project.
--
-- All history tables are append-only and date-partitioned so per-query
-- bytes-scanned stays tiny (well within the 1 TB/month free tier).

-- Append-only meal log. One row per logged food item.
CREATE TABLE IF NOT EXISTS nutrition.food_log (
  log_id        STRING    NOT NULL,   -- uuid
  uid           STRING    NOT NULL,   -- Firebase user id
  ts            TIMESTAMP NOT NULL,   -- when it was consumed/logged (UTC instant)
  log_date      DATE,                 -- client's local calendar day at write time;
                                       -- use this for "today" filtering, not DATE(ts)
  meal          STRING,               -- breakfast | lunch | dinner | snack
  meal_instance INT64,                -- distinguishes separate sittings, e.g. "Lunch 2"
  item_name     STRING,
  barcode       STRING,
  source        STRING,               -- off | chomp | manual | inventory
  servings      FLOAT64,
  calories      FLOAT64,
  protein_g     FLOAT64,
  carbs_g       FLOAT64,
  fat_g         FLOAT64,
  sugar_g       FLOAT64,
  fiber_g       FLOAT64,
  sat_fat_g     FLOAT64,
  sodium_mg     FLOAT64,
  from_inventory BOOL,
  grams         FLOAT64             -- actual grams consumed, when derivable
)
PARTITION BY log_date   -- all read paths filter on log_date, not ts; see store.py
CLUSTER BY uid, meal    -- narrows per-user/per-meal lookups within a day's partition
OPTIONS (description = 'Append-only meal log, one row per food item');

-- Migration: run these if `food_log` was created before the sugar/fiber/
-- sat-fat/sodium columns existed. Safe to re-run (IF NOT EXISTS).
ALTER TABLE nutrition.food_log ADD COLUMN IF NOT EXISTS sugar_g FLOAT64;
ALTER TABLE nutrition.food_log ADD COLUMN IF NOT EXISTS fiber_g FLOAT64;
ALTER TABLE nutrition.food_log ADD COLUMN IF NOT EXISTS sat_fat_g FLOAT64;
ALTER TABLE nutrition.food_log ADD COLUMN IF NOT EXISTS sodium_mg FLOAT64;
ALTER TABLE nutrition.food_log ADD COLUMN IF NOT EXISTS meal_instance INT64;
ALTER TABLE nutrition.food_log ADD COLUMN IF NOT EXISTS grams FLOAT64;
-- log_date was originally added as STRING then migrated to DATE (repartitioned
-- table by log_date instead of DATE(ts) — partitioning can't be changed via
-- ALTER TABLE, so this required a CTAS + rename, done directly against the
-- live table rather than via this idempotent-migration list).

-- Every barcode scan attempt (for coverage analytics + dedupe).
CREATE TABLE IF NOT EXISTS nutrition.scans (
  scan_id        STRING    NOT NULL,
  uid            STRING    NOT NULL,
  ts             TIMESTAMP NOT NULL,
  barcode        STRING,
  matched_source STRING,              -- off | chomp | cache | none
  product_name   STRING,
  success        BOOL
)
PARTITION BY DATE(ts)
OPTIONS (description = 'Barcode scan history');

-- Body-weight tracking for goal progression.
CREATE TABLE IF NOT EXISTS nutrition.weight_log (
  uid       STRING NOT NULL,
  date      DATE   NOT NULL,
  weight_lb FLOAT64,
  note      STRING
)
PARTITION BY date
OPTIONS (description = 'Body weight over time');

-- History of goal changes (audit + "next goal" chain).
CREATE TABLE IF NOT EXISTS nutrition.goal_history (
  uid             STRING    NOT NULL,
  created_at      TIMESTAMP NOT NULL,
  calories        FLOAT64,
  protein_g       FLOAT64,
  carbs_g         FLOAT64,
  fat_g           FLOAT64,
  target_weight_lb FLOAT64,
  phase           STRING,             -- e.g. 'bulk', 'lean-gain'
  reason          STRING
)
PARTITION BY DATE(created_at)
OPTIONS (description = 'Goal change history');

-- Append-only workout set log. One row per logged set (reps/weight actually
-- performed). Migrated from the old Google Sheets WorkoutLog tab.
CREATE TABLE IF NOT EXISTS nutrition.workout_set_log (
  set_log_id   STRING    NOT NULL,   -- uuid
  uid          STRING    NOT NULL,
  ts           TIMESTAMP NOT NULL,
  log_date     STRING,               -- client's local calendar day (YYYY-MM-DD)
  week         INT64,
  day          STRING,               -- e.g. "Day 1 - Upper Body A"
  exercise     STRING,
  set_num      INT64,
  planned_reps STRING,
  actual_reps  STRING,
  weight       STRING,
  notes        STRING
)
PARTITION BY DATE(ts)
OPTIONS (description = 'Append-only workout set log, one row per logged set');

-- Completed workout sessions (energy level + notes). Migrated from the old
-- Google Sheets Progress tab.
CREATE TABLE IF NOT EXISTS nutrition.workout_session_log (
  session_id      STRING    NOT NULL, -- uuid
  uid             STRING    NOT NULL,
  ts              TIMESTAMP NOT NULL,
  log_date        STRING,
  week            INT64,
  day_name        STRING,
  completed       BOOL,
  total_exercises INT64,
  notes           STRING,
  energy_level    STRING              -- high | medium | low
)
PARTITION BY DATE(ts)
OPTIONS (description = 'Completed workout sessions with energy level + notes');
