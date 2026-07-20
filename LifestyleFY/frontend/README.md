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

Point it at the backend: `src/environments/environment.ts` → `apiBase`
(default `http://localhost:8080`). Start the backend first (stub mode is fine):

```bash
cd ../backend && uvicorn app.main:app --reload --port 8080
```

Then open http://localhost:4200. In dev, no login is required (backend runs with
`DEV_NO_AUTH=true`).

## Camera / scanning note

The barcode scanner needs a **secure context** — it works on `localhost` and on
any HTTPS host, but not plain-HTTP LAN IPs. To test scanning on your phone during
dev, either deploy to Firebase Hosting (HTTPS) or use an HTTPS tunnel. Manual
barcode/name entry works everywhere.

## Structure

```
src/app/
├── app.component.ts        bottom-tab shell
├── app.routes.ts           lazy-loaded routes
├── app.config.ts           router + HttpClient + service worker
├── core/
│   ├── models.ts           mirrors backend Pydantic models
│   └── api.service.ts      typed client for every backend endpoint
└── pages/
    ├── today.component.ts      macro rings vs goal + coach tip
    ├── scan.component.ts       @zxing camera + manual lookup
    ├── log.component.ts        manual / from-pantry meal logging
    ├── inventory.component.ts  pantry CRUD
    ├── goals.component.ts      profile + AI goal suggestion + next-goal
    └── coach.component.ts      on-track check, recipes, grocery list
```

## Build for deploy (Firebase Hosting)

```bash
npm run build                                  # -> dist/lifestylefy
# set environment.prod.ts apiBase to your Cloud Run URL first
firebase init hosting                           # public dir: dist/lifestylefy/browser
firebase deploy --only hosting
```

## TODO before shipping
- Add real PWA icons under `src/assets/icons/` (192 + 512 px).
- Wire Firebase Auth: set `environment.useAuth=true`, add an HttpInterceptor that
  attaches the Firebase ID token as `Authorization: Bearer <token>`, and flip the
  backend `DEV_NO_AUTH=false`.
- Add Web Push (service-worker `push` listener + VAPID) for coach nudges.
