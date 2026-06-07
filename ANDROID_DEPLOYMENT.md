# Android Deployment Plan 📱

Plan for turning **My Recipe Book** (a hosted PWA) into a real installable Android APK.

> Status: **Planned, not started.** Several app improvements / new features to add *before* deploying.

## Context / current state

- App is a single self-contained `index.html` (vanilla JS + Tailwind CDN) talking to Supabase.
- Already a valid PWA: `manifest.json`, service worker (`sw.js`), and 192/512 icons.
- Hosted on GitHub Pages at **https://jodwell.github.io/recipes/** (repo `jodwell/recipes`).
- Supabase URL + anon key are entered via the in-app Settings UI (stored client-side) — **no secrets baked into the build**.

## Chosen approach

**PWABuilder (cloud TWA packaging)** — no Android Studio or JDK needed. Wraps the live PWA into a signed APK/AAB.
Goal: a real installable APK now, with a path to the Play Store later.

## Manifest changes already made (not yet committed/pushed)

In `manifest.json`:
- Added `"id": "/recipes/"` (stable app identity).
- Added `"scope": "./"`.
- Added explicit `"purpose": "any"` to both icons.

⚠️ These must be **committed and pushed** so the live manifest reflects them before running PWABuilder.

## Deployment steps (when ready)

### Step 1 — Push the updated manifest
PWABuilder reads the *live* manifest from GitHub Pages, so deploy the changes first.

### Step 2 — Run through PWABuilder
1. Go to https://www.pwabuilder.com
2. Enter `https://jodwell.github.io/recipes/` → Start.
3. Fix any red items it flags. **Let it generate a proper maskable icon set** (we deliberately did NOT mark the full-bleed `icon-512.png` as maskable, since Android's circle mask would crop it).
4. Package For Stores → **Android**.
5. Choose **Signed APK** (sideload) or **AAB** (Play Store). Let PWABuilder generate a new signing key and download the `.zip`.

   ⚠️ **Back up the signing key + passwords.** The same key is required to ship updates. Losing it = can't update the app.

### Step 3 — Install on phone
Transfer the `.apk` to the phone, tap it, allow "install from unknown sources."

### Step 4 — Remove the browser address bar (GitHub Pages gotcha) ⚠️
A PWABuilder Android app is a **TWA**. To run fullscreen (no URL bar), Chrome verifies it via **Digital Asset Links**, which must be served from the **origin root**:

```
https://jodwell.github.io/.well-known/assetlinks.json
```

NOT under `/recipes/`. Because `/recipes/` is a *project* page, the root is a separate repo. To fix:
1. Create a repo named exactly **`jodwell.github.io`** (user site, served at root).
2. Enable GitHub Pages on it.
3. Put PWABuilder's `assetlinks.json` at `/.well-known/assetlinks.json` in that repo.

Until live, the app works but shows a URL bar. Once verified → fully fullscreen.

**Cleaner alternative:** point a **custom domain** (e.g. `recipes.example.com`) at the Pages site — then `/.well-known/assetlinks.json` lives in *this* repo's root and just works.

## Pre-deployment TODO (app improvements / features)

### Built (code complete — needs Supabase setup + testing)

- [x] **Shopping list reorder** — up/down arrows on each item, order saved to `shopping_list.position`.
- [x] **Auto nutrition** — "Calculate ✨" button in add/edit recipe; macros shown per-serving on cards + view modal. Uses a Supabase Edge Function (`supabase/functions/nutrition`) calling the Edamam Nutrition Analysis API.
- [x] **Folders** — "All Recipes" renamed to "Recipes"; folder filter chips; multi-folder assignment per recipe (`folders` + `recipe_folders` tables).
- [x] **Search** — searches recipe names *and* ingredients.

### Required Supabase setup before this works (do once)

1. **Run the DB migration:** Supabase → SQL Editor → paste `supabase_migration.sql` → Run.
   (Adds `shopping_list.position`, recipe nutrition columns, and the `folders` / `recipe_folders` tables.)
   ⚠️ Until this is run, adding/editing recipes and the shopping list will error, because the new columns won't exist.
2. **Deploy the nutrition Edge Function** (only needed for auto nutrition):
   - Sign up free at https://developer.edamam.com and create a **Nutrition Analysis API** app to get an `app_id` + `app_key`.
   - `supabase functions deploy nutrition`
   - `supabase secrets set EDAMAM_APP_ID=xxxx EDAMAM_APP_KEY=yyyy`
   - (Manual macro entry works even without this; only the "Calculate ✨" button needs it.)
3. **Bump cache:** `sw.js` cache name bumped to `v11` so the PWA picks up the new code.

### Still to do

- [ ] Run the steps above against the live Supabase project.
- [ ] Manual test of all four features in the browser, then on the phone.
