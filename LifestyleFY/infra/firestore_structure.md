# Firestore structure (Native mode)

Hot / current state read by the app on every open. One `users/{uid}` root per person
(single user today, but scoped for multi-user later). Money-quote doc is
`today_summary` — that's what the workout app mirrors.

```
users/{uid}
├── profile                (doc)   { weight_lb, height_in, age, sex, activity_level,
│                                     dietary_prefs[], allergies[], updated_at }
├── goals/current          (doc)   { calories, protein_g, carbs_g, fat_g,
│                                     target_weight_lb, weekly_gain_lb, phase,
│                                     set_by: 'ai'|'manual', created_at }
├── today_summary          (doc)   { date, consumed:{cal,protein,carbs,fat},
│                                     remaining:{cal,protein,carbs,fat},
│                                     meals_logged, pct_to_goal, last_updated }
├── inventory/{itemId}     (docs)  { name, barcode, qty, unit,
│                                     per_serving:{cal,protein,carbs,fat,
│                                       sugar_g,fiber_g,sat_fat_g,sodium_mg},
│                                     category (see services/categories.py),
│                                     location:'pantry'|'fridge'|'freezer',
│                                     source:'off'|'chomp'|'manual',
│                                     brand, serving_size, serving_qty_g,
│                                     image_url, nutrition_grade, added_at }
├── coach_messages/{msgId} (docs)  { text, type:'nudge'|'goal'|'recipe',
│                                     created_at, read }
├── ai_prompts             (doc)   { nudge, recipe, grocery, updated_at } —
│                                     per-category standing note the user can edit,
│                                     appended to that category's AI prompt on every
│                                     future generate call
├── recipes/{recipeId}     (docs)  { name, servings, instructions,
│                                     ingredients:[{item_id, name, quantity,
│                                       unit, macros:{...}}] — snapshotted,
│                                       not a live join, so past recipes don't
│                                       change if a pantry ingredient is edited
│                                       later, source:'ai'|'manual', created_at }
├── workout_set_log/{setLogId}  (docs)  { uid, ts, log_date, week, day, exercise,
│                                     set_num, planned_reps, actual_reps, weight,
│                                     notes } — one doc per logged set; doc ID is
│                                     the set_log_id, so unchecking a set is a
│                                     direct doc delete (was BigQuery before,
│                                     moved here to avoid the streaming-buffer
│                                     delete lock)
└── workout_session_log/{sessionId} (docs) { uid, ts, log_date, week, day_name,
                                      completed, total_exercises, notes,
                                      energy_level } — one doc per completed
                                      session, never mutated

barcode_cache/{barcode}    (doc)   { name, per_serving:{...}, source,
                                      brand, serving_size, serving_qty_g,
                                      image_url, nutrition_grade, cached_at }
```

Notes:
- `barcode_cache` is top-level (shared across users) so a scan resolved once is
  never re-fetched from OFF/Chomp again. Chomp's terms permit caching.
- `today_summary` is recomputed on every meal log by the backend
  (`services/store.py: recompute_today_summary`).
- No composite indexes needed for v1 (all reads are by document path or a single
  `where(date == today)` on inventory, which uses the automatic single-field index).
