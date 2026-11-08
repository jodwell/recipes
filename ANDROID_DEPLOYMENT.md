# Android Deployment Plan 📱

Plan for turning **My Recipe Book** (a hosted PWA) into a real installable Android APK.

> Status: **Planned, not started.** Several app improvements / new features to add *before* deploying.

## Context / current state

- App is `index.html` (vanilla JS, Tailwind compiled to `styles.css`) + `localdb.js`. **Data is stored on-device in IndexedDB** (no Supabase any more), so it works fully offline.
- Already a valid PWA: `manifest.json`, service worker (`sw.js`), and 192/512 icons.
- Hosted on GitHub Pages at **https://jodwell.github.io/recipes/** (repo `jodwell/recipes`).
- No backend or secrets. An optional USDA API key (for nutrition lookups of unusual ingredients) is entered in Settings and stored on the device.
- Each device has its own copy of the data; move data between devices with Settings → Download backup / Restore from file.

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

### Built

- [x] **Shopping list reorder** — up/down arrows on each item.
- [x] **Auto nutrition** — "Calculate ✨" estimates on-device from a built-in USDA ingredient table (`nutrition.js`, `nutrition-data.js`), with an online USDA fallback.
- [x] **Recipe list view** — toggle between card carousel (with fast-scroll bar) and compact list.
- [x] **Shopping list** — amounts merged across units, group by aisle, share button.
- [x] **Recipe view** — servings scaler; nutrition per serving in add/edit forms; bulk "Calculate nutrition for all recipes" tool.
- [x] **Meal planner** — 🎲 Surprise me.
- [x] **Photos** — resized on upload; "Shrink existing photos" tool.
- [x] **Backup reminder** banner after 14 days.
- [x] **Tech** — HTML escaping of user text, Tailwind built locally (no CDN), stale-while-revalidate service worker.
- [x] **Folders** — folder filter chips; multi-folder assignment per recipe.
- [x] **Search** — searches recipe names *and* ingredients.
- [x] **Local storage** — moved off Supabase to on-device IndexedDB (`localdb.js`), with JSON backup/restore and a one-time "Import from Supabase".

### Still to do

- [ ] Import data from Supabase once (Settings → Import from Supabase), then Download backup.
- [ ] Manual test of all four features in the browser, then on the phone.
