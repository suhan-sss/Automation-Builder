/* ============================================================
   store.js — localStorage persistence + hydration for the
   automation builder.

   Mirrors the per-org root key pattern used by Connect360's
   plugins.js: c360.<thing>.<orgId>. Falls back to a single
   "default" org when no org switcher is wired yet.

   Browser-only — the Node smoke test stubs localStorage.
   ============================================================ */

import { nowIso } from './ids.js';
import { SAMPLE_RUNS } from '../data/sample-runs.js';

const ROOT_PREFIX = 'c360.auto';
const RUNS_CAP    = 200;
const AUDIT_CAP   = 500;

let _activeOrgId = null;

function _storage() {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
    /* In-memory shim for Node smoke test */
    if (!globalThis.__inMemoryStore) globalThis.__inMemoryStore = new Map();
    return {
        getItem(k) { return globalThis.__inMemoryStore.has(k) ? globalThis.__inMemoryStore.get(k) : null; },
        setItem(k, v) { globalThis.__inMemoryStore.set(k, v); },
        removeItem(k) { globalThis.__inMemoryStore.delete(k); }
    };
}

export function setStoreOrg(orgId) {
    _activeOrgId = orgId || 'default';
}

export function activeOrgId() {
    if (_activeOrgId) return _activeOrgId;
    try {
        const raw = _storage().getItem('c360.activeOrgId');
        if (raw) return JSON.parse(raw) || 'default';
    } catch (_) {}
    return 'default';
}

function rootKey() {
    return `${ROOT_PREFIX}.${activeOrgId()}`;
}

function emptyState() {
    return {
        version: 1,
        automations: [],
        runs: [],
        audit: []
    };
}

/* ------------------------------------------------------------
   Load state — return emptyState if nothing persisted, OR if the
   on-disk seed is missing fields (forward-compat).
   ------------------------------------------------------------ */
export function load() {
    const ls = _storage();
    try {
        const raw = ls.getItem(rootKey());
        if (!raw) return emptyState();
        const parsed = JSON.parse(raw);
        return {
            version: 1,
            automations: Array.isArray(parsed.automations) ? parsed.automations : [],
            runs:       Array.isArray(parsed.runs)       ? parsed.runs       : [],
            audit:      Array.isArray(parsed.audit)      ? parsed.audit      : []
        };
    } catch (e) {
        return emptyState();
    }
}

/**
 * First-load seed: if the on-disk state has no runs and no
 * `seeded` marker, populate with the sample run history.
 * Returns the (possibly augmented) state and writes it back.
 *
 * The `seeded` flag prevents re-seeding on every load. Once the
 * user clears their data or starts generating real runs, the
 * samples won't re-appear.
 */
export function loadWithSeed() {
    const state = load();
    const ls = _storage();
    const seededFlag = ls.getItem(rootKey() + '.seeded.v1');
    if (!seededFlag && state.runs.length === 0 && state.automations.length === 0) {
        const next = {
            ...state,
            runs: SAMPLE_RUNS.slice(0, RUNS_CAP),
            automations: [],
            audit: [{ at: nowIso(), actor: 'system', action: 'seeded-sample-runs' }]
        };
        save(next);
        try { ls.setItem(rootKey() + '.seeded.v1', nowIso()); } catch (_) {}
        return next;
    }
    return state;
}

/** Replace the runs list with `newRuns` and persist. Returns the new state. */
export function setRuns(state, newRuns) {
    const next = { ...state, runs: newRuns || [] };
    save(next);
    return next;
}

export function save(state) {
    const ls = _storage();
    const payload = {
        version: 1,
        automations: state.automations || [],
        runs:        (state.runs || []).slice(0, RUNS_CAP),
        audit:       (state.audit || []).slice(0, AUDIT_CAP)
    };
    try { ls.setItem(rootKey(), JSON.stringify(payload)); }
    catch (e) { console.warn('[store] save failed', e); }
}

export function clear() {
    _storage().removeItem(rootKey());
}

/* ------------------------------------------------------------
   Higher-level mutators — each returns a new state object so the
   UI can re-render predictably.
   ------------------------------------------------------------ */
export function addAutomation(state, automation) {
    const next = { ...state, automations: [...state.automations, automation] };
    save(next);
    return next;
}

export function updateAutomation(state, automation) {
    const next = { ...state, automations: state.automations.map(a => a.id === automation.id ? automation : a) };
    save(next);
    return next;
}

export function deleteAutomation(state, automationId) {
    const next = { ...state, automations: state.automations.filter(a => a.id !== automationId) };
    save(next);
    return next;
}

export function duplicateAutomation(state, automationId) {
    const src = state.automations.find(a => a.id === automationId);
    if (!src) return state;
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = src.id;  // overwritten below
    const newId = 'auto-' + Math.random().toString(36).slice(2, 10);
    clone.id = newId;
    clone.name = (src.name || 'Automation') + ' (copy)';
    clone.status = 'draft';
    clone.version = 1;
    clone.createdAt = nowIso();
    clone.updatedAt = clone.createdAt;
    clone.runCount = 0;
    clone.successCount = 0;
    clone.failCount = 0;
    clone.lastRunAt = null;
    const all = { ...state, automations: [...state.automations, clone] };
    save(all);
    return all;
}

export function addRun(state, run) {
    const runs = [run, ...(state.runs || [])].slice(0, RUNS_CAP);
    const next = { ...state, runs };
    save(next);
    return next;
}

/** Update run stats on the parent automation. */
export function bumpAutomationStats(state, automationId, success) {
    const next = {
        ...state,
        automations: state.automations.map(a => {
            if (a.id !== automationId) return a;
            return {
                ...a,
                runCount:    (a.runCount || 0) + 1,
                successCount:(a.successCount || 0) + (success ? 1 : 0),
                failCount:   (a.failCount    || 0) + (success ? 0 : 1),
                lastRunAt:   nowIso()
            };
        })
    };
    save(next);
    return next;
}

export function appendAudit(state, entry) {
    const audit = [{ at: nowIso(), ...entry }, ...(state.audit || [])].slice(0, AUDIT_CAP);
    const next = { ...state, audit };
    save(next);
    return next;
}