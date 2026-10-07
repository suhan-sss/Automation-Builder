/* ============================================================
   variables.js — {{var}} interpolation engine
   Framework-free. Works in browser AND Node.

   Variable paths supported:
     {{trigger.x.y}}            — trigger payload
     {{steps.<nodeId>.x.y}}     — previous step output
     {{vars.<name>}}            — setVariable slots
     {{run.id}}, {{run.startedAt}}
     {{now}}                   — system clock (ISO)
     {{env.<name>}}            — reserved (not implemented)

   Missing paths render as empty string unless `strict` is true,
   in which case they throw an `UnknownVariable` error so the
   validator can flag broken references.
   ============================================================ */

const VAR_RE = /\{\{\s*([^}\s][^}]*?)\s*\}\}/g;

export class UnknownVariable extends Error {
    constructor(path) {
        super(`Unknown variable: ${path}`);
        this.code = 'UNKNOWN_VARIABLE';
        this.path = path;
    }
}

export function listVariables(str) {
    if (typeof str !== 'string') return [];
    const out = new Set();
    let m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(str)) !== null) out.add(m[1].trim());
    return Array.from(out);
}

/**
 * Resolve a dotted path against an object. Returns undefined if any
 * segment is missing (so callers can decide between blank-string and
 * throw).
 */
export function resolvePath(obj, path) {
    if (!path) return undefined;
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

/**
 * Interpolate {{var}} tokens against a context object.
 * Context shape: { trigger, steps: { nodeId: output }, vars: { name: value } }
 *
 * @param {string} str
 * @param {object} ctx
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false] throw UnknownVariable on missing
 * @param {boolean} [opts.keepMissing=false] return original {{var}} on missing
 */
export function interpolate(str, ctx, opts = {}) {
    if (typeof str !== 'string' || str.indexOf('{{') === -1) return str;
    return str.replace(VAR_RE, (whole, raw) => {
        const path = String(raw).trim();
        // Special tokens
        if (path === 'now') return new Date().toISOString();
        const val = resolvePath(ctx, path);
        if (val === undefined) {
            if (opts.strict) throw new UnknownVariable(path);
            if (opts.keepMissing) return whole;
            return '';
        }
        if (val == null) return '';
        if (typeof val === 'object') {
            try { return JSON.stringify(val); } catch (_) { return String(val); }
        }
        return String(val);
    });
}

/**
 * Validate every {{var}} in a string is reachable from `ctx`.
 * Returns { ok, missing[] }.
 */
export function validate(str, ctx) {
    const missing = [];
    const vars = listVariables(str);
    for (const v of vars) {
        if (v === 'now') continue;
        if (resolvePath(ctx, v) === undefined) missing.push(v);
    }
    return { ok: missing.length === 0, missing };
}

/**
 * Build the picker tree shown in the variable-insert chip.
 * Returns nested: [{key, label, children: [{key, label, type}]}]
 */
export function pickerTree(ctx) {
    const out = [];
    if (ctx && ctx.trigger) {
        out.push({
            key: 'trigger',
            label: 'Trigger',
            children: nodeToChildren(ctx.trigger, 'trigger')
        });
    }
    if (ctx && ctx.steps) {
        for (const [nodeId, output] of Object.entries(ctx.steps)) {
            out.push({
                key: `steps.${nodeId}`,
                label: `Step ${nodeId.slice(0, 6)}…`,
                children: nodeToChildren(output, `steps.${nodeId}`)
            });
        }
    }
    if (ctx && ctx.vars) {
        out.push({
            key: 'vars',
            label: 'Variables',
            children: Object.keys(ctx.vars).map(name => ({
                key: `vars.${name}`,
                label: name,
                type: 'string'
            }))
        });
    }
    return out;
}

function nodeToChildren(node, basePath, depth = 0) {
    if (node == null || typeof node !== 'object' || depth > 3) return [];
    return Object.entries(node).map(([k, v]) => {
        const childPath = `${basePath}.${k}`;
        const type = Array.isArray(v) ? 'array'
                   : v == null ? 'null'
                   : typeof v === 'object' ? 'object'
                   : typeof v;
        const child = { key: childPath, label: k, type };
        if (type === 'object' && depth < 2) {
            child.children = nodeToChildren(v, childPath, depth + 1);
        }
        return child;
    });
}