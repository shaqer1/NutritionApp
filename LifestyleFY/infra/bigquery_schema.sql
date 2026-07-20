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
  ts            TIMESTAMP NOT NULL,   -- when it was consumed/logged
  meal          STRING,               -- breakfast | lunch | dinner | snack
  item_name     STRING,
  barcode       STRING,
  source        STRING,               -- off | chomp | manual | inventory
  servings      FLOAT64,
  calories      FLOAT64,
  protein_g     FLOAT64,
  carbs_g       FLOAT64,
  fat_g         FLOAT64,
  from_inventory BOOL
)
PARTITION BY DATE(ts)
OPTIONS (description = 'Append-only meal log, one row per food item');

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
