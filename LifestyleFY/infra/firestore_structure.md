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
│                                     per_serving:{cal,protein,carbs,fat},
│                                     category, source:'off'|'chomp'|'manual', added_at }
└── coach_messages/{msgId} (docs)  { text, type:'nudge'|'goal'|'recipe',
                                      created_at, read }

barcode_cache/{barcode}    (doc)   { name, per_serving:{...}, source, cached_at }
```

Notes:
- `barcode_cache` is top-level (shared across users) so a scan resolved once is
  never re-fetched from OFF/Chomp again. Chomp's terms permit caching.
- `today_summary` is recomputed on every meal log by the backend
  (`services/store.py: recompute_today_summary`).
- No composite indexes needed for v1 (all reads are by document path or a single
  `where(date == today)` on inventory, which uses the automatic single-field index).
