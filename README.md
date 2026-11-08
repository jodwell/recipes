# My Recipe Book 🍳

A personal recipe manager and meal planner that runs entirely in your browser — on desktop or as an installable app on your phone. All data is stored **on your device** (IndexedDB), so it works offline and needs no account or server.

## Features

*   **Recipe Management**: Add, edit, and delete recipes, with photos (automatically resized to save space).
*   **Card or list view**: Swipe through recipe cards (with a fast-scroll bar) or switch to a compact list.
*   **Folders & Search**: Organise recipes into folders; search by name or ingredient.
*   **Scale servings**: Adjust the servings when viewing a recipe and the ingredient amounts update.
*   **Auto nutrition**: Calories and macros (whole recipe and per serving) estimated on-device from a built-in USDA ingredient table, for one recipe or all at once.
*   **Meal Planner**: Drag-and-drop weekly meal planning, with a 🎲 Surprise me pick.
*   **Shopping List**: Generated from your meal plan, adding up amounts across recipes (500 g + 1 kg → 1.5 kg). Sort it your way or group it by supermarket aisle, and share it to a message or note.
*   **Offline & private**: Everything lives on your device. No login. A reminder pops up if you haven't backed up for two weeks.

## Running it

The app needs to be served over http(s) (not opened as a `file://`), because it uses ES modules and a service worker.

*   **Locally:** `python3 -m http.server 8000` in this folder, then open http://localhost:8000
*   **Hosted:** GitHub Pages (Settings → Pages → `main` branch). On your phone, open the site and use **Add to Home screen** / **Install app**. After the first visit it works offline.
*   **Updates:** the app shows its cached copy instantly and fetches any new version in the background, so changes appear the next time you open it.

## Developing

Styles are plain Tailwind CSS classes compiled into `styles.css` (no CDN at runtime). After adding or changing classes in `index.html`, rebuild it:

```
npm install        # once
npm run build:css
```

## Your data

Open **Settings (⚙)**:

*   **Download backup** saves everything (recipes, images, meal plan, shopping list, folders) to a `.json` file.
*   **Restore from file…** replaces this device's data with a backup. Use this to copy recipes from your computer to your phone (or vice versa).
*   Each device (and each browser) keeps its **own copy**; changes don't sync automatically, so re-export/restore when you want to move data across.
*   Browsers can clear site data (e.g. "Clear browsing data"), so keep a recent backup.

### Migrating from Supabase (one-time)

Older versions stored data in Supabase. To bring it across: restore the project in the Supabase dashboard if it's paused, then in the app open **Settings → Import from Supabase**, enter the project URL, anon key, and your login email/password, and press **Import**. Then press **Download backup** to keep a copy. `supabase_migration.sql` and `supabase/functions/` are only kept for reference.

### Auto nutrition

**Calculate ✨** works offline for ~200 common ingredients (data from USDA FoodData Central, public domain), converting g/kg/oz/ml/tsp/tbsp/cups and items like "2 onions" to grams. It shows what each ingredient matched so you can sanity-check it. Ingredients not in the table are looked up online in USDA FoodData Central and remembered on the device. That uses a shared demo key with a low hourly limit; for more, get a free key at https://fdc.nal.usda.gov/api-key-signup and add it in Settings.

To add ingredients or aliases, edit `tools/nutrition_curated.py` and regenerate with `tools/build_nutrition_data.py` (instructions at the top of that file).
