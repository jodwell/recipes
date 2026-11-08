// localdb.js — on-device database for the Recipe Book.
// -----------------------------------------------------------------------------
// Replaces Supabase. Data lives in the browser's IndexedDB, so the app works
// fully offline (desktop or phone) with no account, server, or sleeping DB.
//
// It exposes a small subset of the supabase-js query API — exactly what
// index.html uses — so the app code reads the same as before:
//   db.from('recipes').select('*, folders(name)').eq('id', 3).single()
//   db.from('meal_plan').insert({...}).select().single()
//   db.from('shopping_list').update({...}).eq(...).or('unit.is.null,unit.eq.')
//
// Plus helpers to back up / restore everything as a JSON file, and a one-time
// importer that copies all data out of an existing Supabase project.
// -----------------------------------------------------------------------------

const DB_NAME = 'recipe-book';
const DB_VERSION = 1;

export const TABLES = [
    'recipes', 'ingredients', 'recipe_ingredients', 'meal_plan',
    'shopping_list', 'folders', 'recipe_folders',
];

// Embedded relation name -> foreign-key column (e.g. select('*, recipes(name)'))
const RELATION_FK = { recipes: 'recipe_id', ingredients: 'ingredient_id', folders: 'folder_id' };

// ON DELETE CASCADE rules: parent table -> [[child table, fk column]]
const CASCADES = {
    recipes: [['recipe_ingredients', 'recipe_id'], ['meal_plan', 'recipe_id'], ['recipe_folders', 'recipe_id']],
    folders: [['recipe_folders', 'folder_id']],
    ingredients: [['recipe_ingredients', 'ingredient_id']],
};

// Unique constraints: table -> list of column sets
const UNIQUE = {
    ingredients: [['name']],
    recipe_folders: [['recipe_id', 'folder_id']],
};

const DEFAULTS = {
    recipes: () => ({ created_at: new Date().toISOString() }),
    folders: () => ({ created_at: new Date().toISOString() }),
    shopping_list: () => ({ is_checked: false, is_manual: false, position: null, unit: null }),
};

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------
function openIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const idb = req.result;
            for (const t of TABLES) {
                if (!idb.objectStoreNames.contains(t)) idb.createObjectStore(t, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

function readAll(idb, table) {
    return new Promise((resolve, reject) => {
        const req = idb.transaction(table).objectStore(table).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ---------------------------------------------------------------------------
// The store: in-memory mirror of every table, written through to IndexedDB
// ---------------------------------------------------------------------------
class Store {
    constructor(idb) {
        this.idb = idb;
        this.tables = {};   // table -> Map(id -> row)
        this.nextId = {};   // table -> next auto-increment id
    }

    async load() {
        for (const t of TABLES) {
            const rows = await readAll(this.idb, t);
            this.tables[t] = new Map(rows.map(r => [r.id, r]));
            this.nextId[t] = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
        }
    }

    rows(table) {
        const t = this.tables[table];
        if (!t) throw dbError(`Unknown table "${table}"`, 'PGRST205');
        return [...t.values()];
    }

    // Persist a set of changes: { table: { put: [rows], del: [ids] } }
    async commit(changes) {
        const names = Object.keys(changes);
        if (names.length === 0) return;
        const tx = this.idb.transaction(names, 'readwrite');
        for (const t of names) {
            const store = tx.objectStore(t);
            for (const row of changes[t].put || []) store.put(row);
            for (const id of changes[t].del || []) store.delete(id);
        }
        await txDone(tx);
    }

    async replaceAll(data) {
        const tx = this.idb.transaction(TABLES, 'readwrite');
        for (const t of TABLES) {
            const store = tx.objectStore(t);
            store.clear();
            for (const row of data[t] || []) store.put(row);
        }
        await txDone(tx);
        await this.load();
    }
}

function dbError(message, code) {
    const e = new Error(message);
    e.code = code;
    return e;
}

const clone = (v) => (v === undefined ? v : structuredClone(v));

// ---------------------------------------------------------------------------
// select() column parsing: "id, quantity, ingredients(name)" ->
//   [{col:'id'}, {col:'quantity'}, {rel:'ingredients', cols:[{col:'name'}]}]
// ---------------------------------------------------------------------------
function parseColumns(str) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of (str || '*')) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map(p => p.trim()).filter(Boolean).map(p => {
        const m = p.match(/^([\w]+)\s*\((.*)\)$/s);
        if (m) return { rel: m[1], cols: parseColumns(m[2]) };
        return { col: p };
    });
}

function project(store, table, row, cols) {
    const out = {};
    for (const c of cols) {
        if (c.col === '*') Object.assign(out, clone(row));
        else if (c.col) out[c.col] = clone(row[c.col] ?? null);
        else if (c.rel) {
            const fk = RELATION_FK[c.rel];
            const parent = fk != null ? store.tables[c.rel]?.get(row[fk]) : undefined;
            out[c.rel] = parent ? project(store, c.rel, parent, c.cols) : null;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Filters (PostgREST semantics: comparisons against NULL never match)
// ---------------------------------------------------------------------------
const same = (a, b) => a !== null && a !== undefined && String(a) === String(b);

function parseOrFilter(expr) {
    // e.g. "unit.is.null,unit.eq." -> predicates OR'd together
    return expr.split(',').map(cond => {
        const [col, op, ...rest] = cond.split('.');
        const val = rest.join('.');
        if (op === 'eq') return r => same(r[col], val);
        if (op === 'neq') return r => r[col] != null && !same(r[col], val);
        if (op === 'is') {
            if (val === 'null') return r => r[col] === null || r[col] === undefined;
            if (val === 'true') return r => r[col] === true;
            if (val === 'false') return r => r[col] === false;
        }
        throw dbError(`Unsupported filter "${cond}"`);
    });
}

// ---------------------------------------------------------------------------
// Query builder (thenable, like supabase-js)
// ---------------------------------------------------------------------------
class Query {
    constructor(store, table) {
        this.store = store;
        this.table = table;
        this.action = 'select';
        this.columns = '*';
        this.returning = null;   // columns to return after a write, or null
        this.filters = [];
        this.orders = [];
        this.mode = 'many';      // 'many' | 'single' | 'maybeSingle'
        this.payload = null;
    }

    select(columns = '*') {
        if (this.action === 'select') this.columns = columns;
        else this.returning = columns;
        return this;
    }
    insert(values) { this.action = 'insert'; this.payload = values; return this; }
    upsert(values) { this.action = 'upsert'; this.payload = values; return this; }
    update(values) { this.action = 'update'; this.payload = values; return this; }
    delete() { this.action = 'delete'; return this; }

    eq(col, val) { this.filters.push(r => same(r[col], val)); return this; }
    neq(col, val) { this.filters.push(r => r[col] != null && !same(r[col], val)); return this; }
    is(col, val) { this.filters.push(r => (val === null ? r[col] == null : r[col] === val)); return this; }
    in(col, vals) { this.filters.push(r => vals.some(v => same(r[col], v))); return this; }
    or(expr) { const preds = parseOrFilter(expr); this.filters.push(r => preds.some(p => p(r))); return this; }
    order(col, { ascending = true } = {}) { this.orders.push({ col, ascending }); return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybeSingle'; return this; }

    then(resolve, reject) { return this.run().then(resolve, reject); }

    async run() {
        try {
            let rows = await this.execute();
            if (rows === null) return { data: null, error: null };
            for (const { col, ascending } of [...this.orders].reverse()) {
                rows.sort((a, b) => {
                    const x = a[col], y = b[col];
                    if (x == null && y == null) return 0;
                    if (x == null) return 1;
                    if (y == null) return -1;
                    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
                    return ascending ? c : -c;
                });
            }
            if (this.mode === 'single') {
                if (rows.length !== 1) {
                    return { data: null, error: dbError(`Expected 1 row, found ${rows.length}`, 'PGRST116') };
                }
                return { data: rows[0], error: null };
            }
            if (this.mode === 'maybeSingle') {
                if (rows.length > 1) return { data: null, error: dbError(`Expected 0 or 1 rows, found ${rows.length}`, 'PGRST116') };
                return { data: rows[0] ?? null, error: null };
            }
            return { data: rows, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    matching() {
        return this.store.rows(this.table).filter(r => this.filters.every(f => f(r)));
    }

    out(rows, cols) {
        return rows.map(r => project(this.store, this.table, r, parseColumns(cols)));
    }

    checkUnique(row, ignoreId) {
        for (const cols of UNIQUE[this.table] || []) {
            const clash = this.store.rows(this.table).some(r =>
                r.id !== ignoreId && cols.every(c => same(r[c], row[c])));
            if (clash) throw dbError(`Duplicate value for ${cols.join(', ')} in ${this.table}`, '23505');
        }
    }

    async execute() {
        const { store, table } = this;
        const map = store.tables[table];
        if (!map) throw dbError(`Unknown table "${table}"`, 'PGRST205');

        if (this.action === 'select') return this.out(this.matching(), this.columns);

        const changes = {};
        const put = (t, row) => ((changes[t] ??= { put: [], del: [] }).put.push(row));
        const del = (t, id) => ((changes[t] ??= { put: [], del: [] }).del.push(id));
        let affected = [];

        if (this.action === 'insert' || this.action === 'upsert') {
            const list = Array.isArray(this.payload) ? this.payload : [this.payload];
            for (const values of list) {
                const existing = this.action === 'upsert' && values.id != null ? map.get(values.id) : null;
                let row;
                if (existing) {
                    row = { ...existing, ...clone(values) };
                    this.checkUnique(row, row.id);
                } else {
                    row = { ...(DEFAULTS[table]?.() || {}), ...clone(values) };
                    if (row.id == null) row.id = store.nextId[table]++;
                    else store.nextId[table] = Math.max(store.nextId[table], Number(row.id) + 1);
                    this.checkUnique(row, row.id);
                }
                map.set(row.id, row);
                put(table, row);
                affected.push(row);
            }
        } else if (this.action === 'update') {
            for (const r of this.matching()) {
                const row = { ...r, ...clone(this.payload) };
                this.checkUnique(row, row.id);
                map.set(row.id, row);
                put(table, row);
                affected.push(row);
            }
        } else if (this.action === 'delete') {
            const removeRow = (t, row) => {
                store.tables[t].delete(row.id);
                del(t, row.id);
                for (const [child, fk] of CASCADES[t] || []) {
                    for (const c of store.rows(child)) if (c[fk] === row.id) removeRow(child, c);
                }
            };
            affected = this.matching();
            for (const r of affected) removeRow(table, r);
        }

        await store.commit(changes);
        return this.returning === null ? null : this.out(affected, this.returning);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
let storePromise = null;
function getStore() {
    storePromise ??= openIDB().then(async idb => {
        const s = new Store(idb);
        await s.load();
        return s;
    });
    return storePromise;
}

export async function createLocalClient() {
    const store = await getStore();
    // Ask the browser not to evict our data under storage pressure (important on phones)
    navigator.storage?.persist?.().catch(() => {});
    return {
        from: (table) => new Query(store, table),
    };
}

export async function isEmpty() {
    const store = await getStore();
    return TABLES.every(t => store.tables[t].size === 0);
}

export async function exportAll() {
    const store = await getStore();
    const tables = {};
    for (const t of TABLES) tables[t] = store.rows(t).sort((a, b) => a.id - b.id);
    return { app: 'recipe-book', version: 1, exported_at: new Date().toISOString(), tables };
}

export async function importAll(backup) {
    if (!backup || backup.app !== 'recipe-book' || typeof backup.tables !== 'object') {
        throw new Error("This doesn't look like a Recipe Book backup file.");
    }
    const data = {};
    for (const t of TABLES) {
        const rows = Array.isArray(backup.tables[t]) ? backup.tables[t] : [];
        let next = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
        // Rows without an id (shouldn't happen, but be safe) get fresh ones
        data[t] = rows.map(r => (r.id == null ? { ...r, id: next++ } : r));
    }
    const store = await getStore();
    await store.replaceAll(data);
}

// One-time migration: copy every table out of a Supabase project.
export async function fetchFromSupabase({ url, key, email, password }) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { error: authError } = await sb.auth.signInWithPassword({ email, password });
    if (authError) throw new Error('Supabase login failed: ' + authError.message);

    const tables = {};
    const PAGE = 1000;
    for (const t of TABLES) {
        tables[t] = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await sb.from(t).select('*').order('id').range(from, from + PAGE - 1);
            if (error) {
                // Table not created (e.g. migration never run) -> treat as empty
                if (['PGRST205', '42P01'].includes(error.code)) break;
                throw new Error(`Could not read "${t}": ${error.message}`);
            }
            tables[t].push(...data);
            if (data.length < PAGE) break;
        }
    }
    await sb.auth.signOut().catch(() => {});
    return { app: 'recipe-book', version: 1, exported_at: new Date().toISOString(), source: 'supabase', tables };
}
