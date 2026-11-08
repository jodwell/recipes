// nutrition.js — estimate calories & macros for a recipe, on-device.
// -----------------------------------------------------------------------------
// 1. Each ingredient name is matched against a built-in table of ~200 common
//    ingredients (nutrition-data.js, from USDA FoodData Central).
// 2. The quantity + unit is converted to grams (using density for cups/spoons,
//    and a typical weight per item for things like "2 onions").
// 3. Ingredients not in the table are looked up online in USDA FoodData Central
//    (free; uses the public DEMO_KEY unless you add your own key in Settings),
//    and remembered on this device so the next lookup works offline.
// -----------------------------------------------------------------------------
import { FOODS } from './nutrition-data.js';

const CACHE_KEY = 'nutrition_lookup_cache_v1';

// --- Name matching ---------------------------------------------------------
const DESCRIPTORS = new Set(('fresh chopped diced sliced minced grated finely roughly thinly large small medium ' +
    'ripe peeled crushed boneless skinless trimmed halved quartered cubed shredded beaten softened melted ' +
    'cold warm hot room temperature organic free range raw cooked tinned canned drained rinsed ' +
    'about approx approximately heaped level good quality handful of a an the to taste optional for serving').split(' '));

const normalise = s => (s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')           // drop "(about 200g)"
    .split(/,| - | – /)[0]               // drop ", finely chopped"
    .replace(/[^a-zà-ÿ0-9&' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const singular = w => w.replace(/(oes|ies|es|s)$/, m => (m === 'ies' ? 'y' : m === 'oes' ? 'o' : m === 'es' ? 'e' : ''));

// name -> food, for every name and alias (and their singular forms)
const INDEX = new Map();
for (const food of FOODS) {
    for (const n of [food.n, ...(food.a || [])]) {
        INDEX.set(n, food);
        if (!INDEX.has(singular(n))) INDEX.set(singular(n), food);
    }
}
const INDEX_KEYS = [...INDEX.keys()].sort((a, b) => b.length - a.length); // longest first

// Matching order: exact name -> longest known name inside the full name
// ("tinned chopped tomatoes" -> "chopped tomatoes") -> name without descriptor words.
function findBuiltIn(rawName) {
    const name = normalise(rawName);
    if (!name) return null;
    if (INDEX.has(name)) return INDEX.get(name);
    const whole = longestMatch(name);
    if (whole) return whole;
    const stripped = name.split(' ').filter(w => !DESCRIPTORS.has(w)).join(' ');
    for (const candidate of [stripped, singular(stripped), stripped.split(' ').map(singular).join(' ')]) {
        if (candidate && INDEX.has(candidate)) return INDEX.get(candidate);
    }
    // Longest known name inside the descriptor-free name ("smoked streaky bacon" -> "bacon")
    return longestMatch(stripped);
}

function longestMatch(text) {
    const padded = ` ${text} `;
    const paddedSing = ` ${text.split(' ').map(singular).join(' ')} `;
    for (const key of INDEX_KEYS) {
        if (padded.includes(` ${key} `) || paddedSing.includes(` ${key} `)) return INDEX.get(key);
    }
    return null;
}

// --- Units -------------------------------------------------------------------
const MASS = { g: 1, gram: 1, gr: 1, kg: 1000, kilo: 1000, mg: 0.001, oz: 28.35, ounce: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6 };
const VOLUME_ML = {
    ml: 1, millilitre: 1, milliliter: 1, cl: 10, dl: 100, l: 1000, litre: 1000, liter: 1000,
    tsp: 4.93, teaspoon: 4.93, t: 4.93, tbsp: 14.79, tablespoon: 14.79, tbs: 14.79, tbl: 14.79, T: 14.79,
    cup: 240, 'fl oz': 29.57, floz: 29.57, pint: 568, pt: 568, dash: 0.6, splash: 5, drizzle: 5,
};
const FIXED_GRAMS = { pinch: 0.3, handful: 30, bunch: 25, sprig: 1, knob: 15, can: 400, tin: 400, jar: 300, packet: 200, pack: 200, bag: 200 };
const COUNT = new Set(['', 'x', 'pc', 'pcs', 'piece', 'whole', 'each', 'item', 'clove', 'slice', 'rasher', 'stick',
    'fillet', 'breast', 'thigh', 'leg', 'head', 'bulb', 'stalk', 'sheet', 'medium', 'large', 'small', 'egg']);
const SIZE = { small: 0.75, medium: 1, large: 1.25 };

function normUnit(u) {
    const raw = (u || '').trim().replace(/\s+of$/i, '').replace(/\.$/, '');   // "bag of" -> "bag"
    if (raw === 'T') return 'T';                          // capital T = tablespoon
    const s = raw.toLowerCase();
    if (s === 'fl oz' || s === 'fl. oz') return 'fl oz';
    return s.length > 2 ? singular(s) : s;
}

// Returns grams, or null if the amount can't be converted for this food
function toGrams(quantity, unit, food) {
    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) return null;
    const u = normUnit(unit);
    if (u in MASS) return q * MASS[u];
    if (u in VOLUME_ML) return q * VOLUME_ML[u] * (food.d || 1);
    if (u in FIXED_GRAMS) return q * FIXED_GRAMS[u];
    if (COUNT.has(u)) return food.w ? q * food.w * (SIZE[u] || 1) : null;
    return null;
}

// --- Online fallback (USDA FoodData Central) --------------------------------
function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function writeCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full: skip caching */ }
}

async function searchUSDA(query) {
    const key = localStorage.getItem('usda_api_key') || 'DEMO_KEY';
    const pick = n => (f) => f.foodNutrients.find(x => x.nutrientId === n)?.value;
    for (const dataType of ['Foundation,SR Legacy', 'Branded']) {
        const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}` +
            `&query=${encodeURIComponent(query)}&dataType=${encodeURIComponent(dataType)}&pageSize=5&requireAllWords=true`;
        const res = await fetch(url);
        if (res.status === 429) throw new Error('USDA lookup limit reached — add your own free USDA API key in Settings.');
        if (res.status === 401 || res.status === 403) throw new Error('USDA lookup failed — check the USDA API key in Settings.');
        if (!res.ok) throw new Error(`USDA lookup failed (${res.status})`);
        const { foods = [] } = await res.json();
        const f = foods.find(x => pick(1008)(x) != null || pick(2047)(x) != null);
        if (f) {
            return {
                n: query,
                k: pick(1008)(f) ?? pick(2047)(f) ?? pick(2048)(f) ?? 0,
                p: pick(1003)(f) ?? 0, c: pick(1005)(f) ?? 0, f: pick(1004)(f) ?? 0,
                s: f.description + (f.brandOwner ? ` (${f.brandOwner})` : '') + ' — USDA online',
            };
        }
    }
    return null;
}

// --- Public ------------------------------------------------------------------
/**
 * @param {{name: string, quantity: number|string, unit?: string}[]} ingredients
 * @param {{online?: boolean}} options  online: false = built-in table + cached lookups only
 * @returns {Promise<{totals: {calories, protein, carbs, fat}, items: object[], onlineError: string|null}>}
 *   items[i].status: 'ok' | 'unknown-food' | 'unknown-amount'
 */
export async function estimateNutrition(ingredients, { online = true } = {}) {
    const cache = readCache();
    let cacheChanged = false, onlineError = null;
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const items = [];

    for (const ing of ingredients) {
        const item = { name: ing.name, quantity: ing.quantity, unit: ing.unit || '' };
        let food = findBuiltIn(ing.name);
        const cacheKey = normalise(ing.name);
        if (!food && cacheKey && cache[cacheKey] !== undefined) food = cache[cacheKey];
        if (!food && cacheKey && online && !onlineError && navigator.onLine !== false) {
            try {
                food = await searchUSDA(cacheKey);
                cache[cacheKey] = food; // remember misses too (null) so we don't re-query
                cacheChanged = true;
            } catch (e) {
                onlineError = e.message;
            }
        }
        if (!food) { items.push({ ...item, status: 'unknown-food' }); continue; }

        item.matched = food.n;
        item.source = food.s;
        const grams = toGrams(ing.quantity, ing.unit, food);
        if (grams == null) { items.push({ ...item, status: 'unknown-amount' }); continue; }

        const f = grams / 100;
        item.grams = Math.round(grams);
        item.calories = Math.round(food.k * f);
        totals.calories += food.k * f;
        totals.protein += food.p * f;
        totals.carbs += food.c * f;
        totals.fat += food.f * f;
        items.push({ ...item, status: 'ok' });
    }

    if (cacheChanged) writeCache(cache);
    for (const k in totals) totals[k] = Math.round(totals[k]);
    return { totals, items, onlineError };
}

// --- Shopping list helpers --------------------------------------------------
export const AISLE_ORDER = ['Fruit & veg', 'Bakery', 'Meat, fish & alternatives', 'Dairy & eggs', 'Pasta, rice & grains',
    'Tins, jars & dried', 'Baking', 'Herbs & spices', 'Oils, sauces & condiments', 'Frozen', 'Drinks', 'Other'];

export function aisleOf(name) {
    return findBuiltIn(name)?.g || 'Other';
}

// Convert to a base unit so amounts from different recipes can be added up:
// any weight -> g, any measured volume -> ml. Other units are left as they are.
export function toShoppingUnit(quantity, unit) {
    const q = Number(quantity) || 0;
    const u = normUnit(unit);
    if (u in MASS) return { quantity: q * MASS[u], unit: 'g' };
    if (u in VOLUME_ML && !['dash', 'splash', 'drizzle'].includes(u)) return { quantity: q * VOLUME_ML[u], unit: 'ml' };
    return { quantity: q, unit: (unit || '').trim() };
}

// 2 -> "2", 0.3333 -> "0.33", 12.46 -> "12.5", 245.2 -> "245"
export function formatNumber(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '';
    const dp = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
    return String(Number(x.toFixed(dp)));
}

// Human-friendly amount for g / ml totals (other units pass through)
export function formatAmount(quantity, unit) {
    const q = Number(quantity) || 0;
    const half = v => Math.max(0.5, Math.round(v * 2) / 2);
    if (unit === 'g') return q >= 1000 ? `${formatNumber(q / 1000)} kg` : `${Math.round(q)} g`;
    if (unit === 'ml') {
        if (q >= 1000) return `${formatNumber(q / 1000)} l`;
        if (q < 14) return `${formatNumber(half(q / 4.93))} tsp`;
        if (q < 75) return `${formatNumber(half(q / 14.79))} tbsp`;
        return `${Math.round(q / 5) * 5} ml`;
    }
    if (!q) return unit || '';
    return `${formatNumber(q)}${unit ? ' ' + unit : ''}`;
}

// Exposed for tests
export const _internal = { findBuiltIn, toGrams, normalise };
