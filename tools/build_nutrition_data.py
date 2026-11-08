"""Build nutrition-data.js from the USDA FoodData Central SR Legacy CSV download.

Usage:
  1. Download and unzip https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
  2. python3 tools/build_nutrition_data.py <unzipped folder> nutrition-data.js

Edit tools/nutrition_curated.py to add ingredients/aliases. Each entry is
(name, [aliases], exact USDA description or {kcal, protein, carbs, fat, density}, grams per item or None).
"""
import csv, sys, json, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nutrition_curated import C as RAW, AISLE_OVERRIDES

# Split '@Aisle' markers out of the list
C, AISLE, _aisle = [], {}, 'Other'
for row in RAW:
    if isinstance(row, str):
        _aisle = row[1:]
        continue
    C.append(row)
    AISLE[row[0]] = _aisle
for _aisle, names in AISLE_OVERRIDES.items():
    for n in names:
        assert n in AISLE, f'unknown ingredient in AISLE_OVERRIDES: {n}'
        AISLE[n] = _aisle
D = sys.argv[1]
foods = {r['description']: r['fdc_id'] for r in csv.DictReader(open(D + '/food.csv'))}
need = {foods[c[2]] for c in C if isinstance(c[2], str)}
NUT = {'1008': 'k', '1003': 'p', '1005': 'c', '1004': 'f'}
nut = {}
for r in csv.DictReader(open(D + '/food_nutrient.csv')):
    if r['fdc_id'] in need and r['nutrient_id'] in NUT:
        nut.setdefault(r['fdc_id'], {})[NUT[r['nutrient_id']]] = float(r['amount'])
ML = {'cup': 236.6, 'tbsp': 14.79, 'tsp': 4.93, 'fl oz': 29.57}
dens = {}
for r in csv.DictReader(open(D + '/food_portion.csv')):
    if r['fdc_id'] not in need: continue
    m = r['modifier'].strip().lower()
    for unit, ml in ML.items():
        if re.match(rf'^{unit}\b', m) and 'cup (' not in m:
            g = float(r['gram_weight']) / float(r['amount'] or 1)
            # prefer plain "cup", then the first listed portion of that unit
            rank = (0 if m == unit else 1, list(ML).index(unit))
            cur = dens.get(r['fdc_id'])
            if cur is None or rank < cur[0]:
                dens[r['fdc_id']] = (rank, g / ml)
            break
out = []
for name, aliases, desc, *rest in C:
    piece = rest[0] if rest else None
    if isinstance(desc, dict):
        e = {'n': name, 'k': desc['kcal'], 'p': desc['protein'], 'c': desc['carbs'], 'f': desc['fat'], 'd': desc['density'], 's': 'typical values'}
    else:
        fid = foods[desc]; v = nut[fid]
        e = {'n': name, 'k': v.get('k', 0), 'p': v.get('p', 0), 'c': v.get('c', 0), 'f': v.get('f', 0), 's': desc.replace(" (Includes foods for USDA's Food Distribution Program)", '')}
        if fid in dens: e['d'] = round(dens[fid][1], 3)
    e['g'] = AISLE[name]
    if aliases: e['a'] = aliases
    if piece: e['w'] = piece
    out.append(e)
DENS = {'parmesan': 0.42, 'desiccated coconut': 0.34, 'cashews': 0.58, 'chia seeds': 0.68, 'greek yogurt': 1.05, 'yogurt': 1.04, 'dark chocolate': 0.7, 'kidney beans': 0.72, 'goats cheese': 0.95, 'prawns': 0.6}
for e in out:
    if 'd' not in e and e['n'] in DENS: e['d'] = DENS[e['n']]
missing_d = [e['n'] for e in out if 'd' not in e]
print('no density (defaults to 1 g/ml):', missing_d, file=sys.stderr)
js = ("// Nutrition per 100 g for common ingredients.\n"
      "// Generated from USDA FoodData Central, SR Legacy (April 2018), public domain (CC0).\n"
      "// n = name, a = aliases, k = kcal, p = protein g, c = carbs g, f = fat g,\n"
      "// d = density g/ml (for cups/spoons), w = grams per item (for '2 onions'), s = USDA source food,\n"
      "// g = shopping-list aisle.\n"
      "export const FOODS = [\n" + ",\n".join(json.dumps(e, ensure_ascii=False) for e in out) + "\n];\n")
open(sys.argv[2], 'w').write(js)
print(len(out), 'foods written', file=sys.stderr)
