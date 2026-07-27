# LifestyleFY — Frontend (Angular PWA)

Nutrition app UI: scan groceries, log meals, track macros vs goals, AI coach.
Standalone Angular 19, installable PWA, in-browser barcode scanning via
`@zxing/browser`.

## Run locally

```bash
cd frontend
npm install
npm start            # ng serve on http://localhost:4200
```

`src/environments/environment.ts` (the dev config) currently points `apiBase` at
the **deployed** Cloud Run backend with `useAuth: true` — so out of the box you'll
need to sign in with an allowlisted Google account (see
[DEPLOYMENT.md](../DEPLOYMENT.md#managing-access)), even against your local `ng serve`.

To develop against a local backend instead, start it in stub mode and point
`apiBase` at it:

```bash
cd ../backend && cp .env.example .env && uvicorn app.main:app --reload --port 8080
```

then temporarily set `apiBase: 'http://localhost:8080'` and `useAuth: false` in
`environment.ts` — with `DEV_NO_AUTH=true` (the `.env.example` default) the backend
skips token verification, so no login is required. Revert both before committing;
the checked-in `environment.ts` is meant to point at the real deployment.

## Camera / scanning note

The barcode scanner needs a **secure context** — it works on `localhost` and on
any HTTPS host, but not plain-HTTP LAN IPs. To test scanning on your phone during
dev, either deploy to Firebase Hosting (HTTPS) or use an HTTPS tunnel. Manual
barcode/name entry works everywhere.

## Structure

```
src/app/
├── app.component.ts        bottom-tab shell (Today / Inventory / Groceries / Recipes / Coach)
├── app.routes.ts           lazy-loaded routes
├── app.config.ts           router + HttpClient + service worker
├── core/
│   ├── models.ts            mirrors backend Pydantic models
│   ├── api.service.ts       typed client for every backend endpoint
│   ├── auth.service.ts      Firebase Google Sign-In
│   ├── auth.interceptor.ts  attaches the Firebase ID token to every request
│   ├── categories.ts        pantry category taxonomy (mirrors services/categories.py)
│   └── meal-picker.ts       shared meal/instance-picker helpers
└── pages/
    ├── today.component.ts           macro bars vs goal, coach tip, today's log table
    ├── inventory.component.ts       @zxing scan / search / manual-entry, Pantry+Log views
    ├── inventory-item.component.ts  ingredient detail: log, edit, delete
    ├── recipes.component.ts         AI/manual recipes, pantry-only ingredients, archive lifecycle
    ├── groceries.component.ts       AI/manual grocery lists, save/edit, archive lifecycle
    └── coach.component.ts           profile (incl. allergies/prefs), goals, on-track check
```

## Build for deploy (Firebase Hosting)

```bash
npm run build                                  # -> dist/lifestylefy
# set environment.prod.ts apiBase to your Cloud Run URL first
firebase init hosting                           # public dir: dist/lifestylefy/browser
firebase deploy --only hosting
```

## TODO before shipping
- Add Web Push (service-worker `push` listener + VAPID) for coach nudges.

PWA icons are in place: `src/assets/icons/icon-192.png` and `icon-512.png`,
cropped from the `LifestyleFY/NutriBear-Lifestyle4U.svg` badge mark (the
"LifestyleFY / Nutrition App" text banner in that file is deliberately excluded).

Firebase Auth itself is already wired up: `useAuth: true`, `auth.interceptor.ts`
attaches the ID token to every request, and the backend verifies it with
`DEV_NO_AUTH=false` in production (`app/auth.py`).
