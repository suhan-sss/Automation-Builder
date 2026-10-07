/* ============================================================
   engine.js — execution engine for automations.
   Framework-free. Works in browser AND Node.

   The engine walks the workflow graph from the trigger outward,
   resolving {{var}} placeholders, dispatching to Registry.run(),
   writing per-step records, and branching through if/else / switch
   nodes.

   Graph model
   -----------
   nodes: [{ id, type, config, position, errorConfig? }]
   edges: [{ from, to, branch: 'default'|'yes'|'no'|'case:<v>' }]
   The trigger itself is automation.trigger, NOT a node — but it has
   an id (auto-generated at runtime) so edges can attach to it.

   The engine does NOT mutate the saved automation. It produces:
     - a Run record  (run.status, run.steps, run.durationMs, ...)
     - per-step records written to run.steps[]

   Failure semantics (per SPEC §42, §46)
     - settings.onError = 'stop'      → abort the run
     - settings.onError = 'continue'  → record failure, keep walking
     - settings.onError = 'fallback'  → jump to node.errorConfig.fallbackNodeId
     - retry: per-node retry up to N attempts with exponential backoff
     - dedupe: per-event dedup key skips the run if seen (simulated)
   ============================================================ */

import { Registry } from './registry.js';
import { interpolate } from './variables.js';
import { genId, nowIso } from './ids.js';

const RUN_STATUS = Object.freeze({
    QUEUED:    'queued',
    RUNNING:   'running',
    WAITING:   'waiting',
    COMPLETED: 'completed',
    FAILED:    'failed',
    CANCELLED: 'cancelled',
    SKIPPED:   'skipped'
});

/* ------------------------------------------------------------
   Graph helpers
   ------------------------------------------------------------ */

/** Find outgoing edges from a node (or from the trigger). */
function outgoing(automation, fromNodeOrTriggerId) {
    return (automation.edges || []).filter(e => e.from === fromNodeOrTriggerId);
}

/** Pick the edge that matches the current branching decision. */
function pickEdge(automation, fromNodeOrTriggerId, decision, ctx) {
    const edges = outgoing(automation, fromNodeOrTriggerId);
    if (!edges.length) return null;
    // Branch match: 'yes' | 'no' | 'default' | 'case:<value>'
    const match = edges.find(e => e.branch === decision);
    if (match) return match;
    const fallback = edges.find(e => e.branch === 'default');
    return fallback || edges[0];
}

/** Resolve the immediate next node id (null = end of flow). */
function nextNodeId(automation, fromNodeOrTriggerId, decision, ctx) {
    const edge = pickEdge(automation, fromNodeOrTriggerId, decision, ctx);
    return edge ? edge.to : null;
}

/* ------------------------------------------------------------
   Variable setter application — write setVariable outputs into ctx.vars
   ------------------------------------------------------------ */
function applyVariableSetters(node, ctx) {
    if (node.type === 'data.setVariable') {
        const out = ctx.steps[node.id] || {};
        if (out.name) {
            // Interpolate value against the SAME ctx
            try {
                ctx.vars[out.name] = interpolate(out.value, ctx);
            } catch (_) {
                ctx.vars[out.name] = out.value;
            }
        }
    }
}

/* ------------------------------------------------------------
   Retry with exponential backoff (simulated — no real delay)
   ------------------------------------------------------------ */
async function runWithRetry(node, ctx, stepRec, settings) {
    const max = (settings && Number(settings.retries)) || 0;
    const baseDelay = parseDuration(settings?.retryDelay || '5m');
    let attempt = 0;
    let lastErr = null;
    while (attempt <= max) {
        try {
            const reg = Registry.byId(node.type);
            if (!reg) throw new Error(`Unknown node type: ${node.type}`);
            const out = await reg.run({ node, ctx });
            return { ok: true, output: out, attempts: attempt + 1 };
        } catch (e) {
            lastErr = e;
            attempt++;
            if (attempt > max) break;
            stepRec.retryCount = attempt;
            // Real impl would await sleep(baseDelay * 2^attempt). Simulated: no-op.
            await Promise.resolve();
        }
    }
    return { ok: false, error: lastErr ? String(lastErr.message || lastErr) : 'Unknown error', attempts: attempt };
}

function parseDuration(s) {
    const m = String(s || '5m').match(/^(\d+)(ms|s|m|h|d)$/);
    if (!m) return 300000;
    const n = parseInt(m[1], 10);
    switch (m[2]) {
        case 'ms': return n;
        case 's':  return n * 1000;
        case 'm':  return n * 60 * 1000;
        case 'h':  return n * 60 * 60 * 1000;
        case 'd':  return n * 24 * 60 * 60 * 1000;
        default:   return 300000;
    }
}

/* ------------------------------------------------------------
   Main run function
   ------------------------------------------------------------ */
/**
 * @param {object} automation — the saved automation graph
 * @param {object} triggerPayload — the trigger payload
 * @param {object} [opts]
 * @param {function} [opts.onStep] — callback(stepRec) for live UI updates
 * @returns {object} run record
 */
export async function runAutomation(automation, triggerPayload, opts = {}) {
    const settings = automation.settings || {};
    const onStep = opts.onStep || (() => {});
    const startedAt = nowIso();
    const startedMs = Date.now();

    const run = {
        id: genId('run'),
        automationId: automation.id,
        automationVersion: automation.version || 1,
        status: RUN_STATUS.RUNNING,
        trigger: { type: automation.trigger?.type, payload: triggerPayload },
        startedAt,
        completedAt: null,
        durationMs: 0,
        steps: [],
        error: null
    };

    const ctx = {
        trigger: triggerPayload || {},
        steps:   Object.create(null),
        vars:    Object.create(null),
        run,
        now:     nowIso()
    };

    /* Dedupe key (simulated — without a backend dedup store we always let it pass). */
    if (settings.dedupeKey) {
        try {
            const dedupVal = interpolate(settings.dedupeKey, ctx);
            ctx.dedupeKey = dedupVal;
        } catch (_) { /* ignore — broken template will be caught at validation */ }
    }

    /* Walk the graph. The trigger itself is at automation.trigger.id (auto-id),
       so we begin with the first outgoing edge of the trigger. */
    const triggerId = automation.trigger?.id || `trigger-${automation.id}`;
    let currentId = nextNodeId(automation, triggerId, 'default', ctx);

    while (currentId) {
        const node = (automation.nodes || []).find(n => n.id === currentId);
        if (!node) {
            run.status = RUN_STATUS.FAILED;
            run.error = `Missing node ${currentId}`;
            break;
        }
        const reg = Registry.byId(node.type);
        const stepRec = {
            nodeId: node.id,
            type: node.type,
            label: reg?.label || node.type,
            startedAt: nowIso(),
            completedAt: null,
            status: 'running',
            input: snapshotForStep(node),
            output: null,
            error: null,
            retryCount: 0
        };
        run.steps.push(stepRec);
        onStep(stepRec);

        try {
            /* Pre-resolve variable placeholders in the node config and snapshot. */
            const resolved = resolveConfig(node, ctx);
            const nodeWithResolved = { ...node, config: resolved };

            const r = await runWithRetry(nodeWithResolved, ctx, stepRec, settings);
            if (!r.ok) throw new Error(r.error);

            stepRec.output  = r.output;
            stepRec.status  = 'completed';
            stepRec.retryCount = r.attempts - 1;
            ctx.steps[node.id] = r.output;
            applyVariableSetters(node, ctx);
        } catch (err) {
            stepRec.status = 'failed';
            stepRec.error = String(err.message || err);

            if (settings.onError === 'continue') {
                /* keep walking — fallthrough to next default edge */
                currentId = nextNodeId(automation, node.id, 'default', ctx);
                finalizeStep(stepRec);
                onStep(stepRec);
                continue;
            }
            if (settings.onError === 'fallback' && node.errorConfig?.fallbackNodeId) {
                currentId = node.errorConfig.fallbackNodeId;
                finalizeStep(stepRec);
                onStep(stepRec);
                continue;
            }
            /* 'stop' (default) → abort */
            run.status = RUN_STATUS.FAILED;
            run.error = stepRec.error;
            finalizeStep(stepRec);
            onStep(stepRec);
            break;
        }

        finalizeStep(stepRec);
        onStep(stepRec);

        /* Decide the next edge. */
        const decision = decideBranch(node, ctx);
        currentId = nextNodeId(automation, node.id, decision, ctx);
    }

    if (run.status === RUN_STATUS.RUNNING) {
        run.status = RUN_STATUS.COMPLETED;
    }
    run.completedAt = nowIso();
    run.durationMs = Date.now() - startedMs;

    return run;
}

/** Resolve {{var}} inside the node config snapshot. */
function resolveConfig(node, ctx) {
    const out = {};
    for (const [k, v] of Object.entries(node.config || {})) {
        if (typeof v === 'string' && v.indexOf('{{') >= 0) {
            try { out[k] = interpolate(v, ctx); }
            catch (_) { out[k] = v; }
        } else if (Array.isArray(v)) {
            out[k] = v.map(item => typeof item === 'string' ? safeInterp(item, ctx) : item);
        } else if (v && typeof v === 'object') {
            out[k] = v;  // objects pass through; users can interpolate inside string fields
        } else {
            out[k] = v;
        }
    }
    return out;
}
function safeInterp(s, ctx) { try { return interpolate(s, ctx); } catch (_) { return s; } }

function snapshotForStep(node) {
    return JSON.parse(JSON.stringify(node.config || {}));
}
function finalizeStep(stepRec) {
    stepRec.completedAt = nowIso();
}

/** Decide which edge to follow after a node. */
function decideBranch(node, ctx) {
    const out = ctx.steps[node.id] || {};
    switch (node.type) {
        case 'condition.if':
            return out.matched === 'yes' ? 'yes' : 'no';
        case 'condition.switch':
            return 'case:' + (out.matchedCase ?? '__default__');
        case 'condition.exists':
            return out.found ? 'yes' : 'no';
        case 'condition.changed':
            return out.changed ? 'yes' : 'no';
        default:
            return 'default';
    }
}

/* ------------------------------------------------------------
   Validation — runs BEFORE publish (called from UI)
   Returns { ok, errors: [{ nodeId, message }] }
   ------------------------------------------------------------ */
export function validateAutomation(automation) {
    const errors = [];
    if (!automation) return { ok: false, errors: [{ message: 'No automation' }] };

    if (!automation.trigger || !automation.type || !automation.type.length) {
        errors.push({ message: 'No trigger selected' });
    } else {
        const t = Registry.byId(automation.trigger.type);
        if (!t) errors.push({ nodeId: 'trigger', message: `Unknown trigger: ${automation.trigger.type}` });
        else validateInputs(automation.trigger.config || {}, t.inputs, 'trigger').forEach(m => errors.push({ nodeId: 'trigger', message: m }));
    }

    if (!automation.nodes || !automation.nodes.length) {
        errors.push({ nodeId: 'graph', message: 'Workflow has no steps' });
    }

    (automation.nodes || []).forEach(n => {
        const reg = Registry.byId(n.type);
        if (!reg) { errors.push({ nodeId: n.id, message: `Unknown node type: ${n.type}` }); return; }
        validateInputs(n.config || {}, reg.inputs, n.id).forEach(m => errors.push({ nodeId: n.id, message: m }));
    });

    /* Check for dangling edges */
    const validIds = new Set(['trigger-' + automation.id, ...(automation.nodes || []).map(n => n.id)]);
    (automation.edges || []).forEach((e, i) => {
        if (!validIds.has(e.from)) errors.push({ nodeId: e.edgeId || ('edge-' + i), message: `Edge has unknown source: ${e.from}` });
        if (!validIds.has(e.to))   errors.push({ nodeId: e.edgeId || ('edge-' + i), message: `Edge has unknown target: ${e.to}` });
    });

    /* Check broken {{var}} placeholders. */
    const ctx = buildValidationCtx(automation);
    const walker = (str, nodeId, label) => {
        if (typeof str !== 'string') return;
        try { interpolate(str, ctx, { strict: true }); }
        catch (e) {
            if (e.code === 'UNKNOWN_VARIABLE') {
                errors.push({ nodeId, message: `${label || 'field'} references unknown variable: ${e.path}` });
            }
        }
    };
    (automation.nodes || []).forEach(n => {
        Object.entries(n.config || {}).forEach(([k, v]) => {
            if (typeof v === 'string') walker(v, n.id, k);
            if (Array.isArray(v)) v.forEach((item, idx) => typeof item === 'string' && walker(item, n.id, `${k}[${idx}]`));
        });
    });

    return { ok: errors.length === 0, errors };
}

function validateInputs(config, schema, now) {
    const errs = [];
    (schema || []).forEach(field => {
        if (field.required && (config[field.key] == null || config[field.key] === '')) {
            errs.push(`${field.label} is required`);
        }
    });
    return errs;
}

/* Build a placeholder ctx that pretends every previous step is reachable,
   so {{vars.X}} and {{steps.X.output}} don't get flagged as broken. */
function buildValidationCtx(automation) {
    const ctx = { trigger: {}, steps: {}, vars: {} };
    (automation.nodes || []).forEach(n => {
        ctx.steps[n.id] = {};
    });
    /* Pre-populate common trigger shapes so references like {{trigger.lead.name}} validate. */
    ctx.trigger = {
        lead: { id: '', name: '', phone: '', email: '', source: '', budget: 0 },
        contact: { id: '', name: '' },
        deal: { id: '', name: '', value: 0, stage: '' },
        message: { from: '', body: '', messageId: '' },
        listing: { id: '', title: '', price: 0 },
        inquiry: { id: '', property: '', name: '' },
        visit: { id: '', property: '', when: '' },
        payload: {}, headers: {}, firedAt: ''
    };
    return ctx;
}

/* ------------------------------------------------------------
   Dry-run a single node against the saved config — used by "Test step"
   button in the config panel.
   ------------------------------------------------------------ */
export async function testNode(node, ctx = {}) {
    const fullCtx = { trigger: ctx.trigger || {}, steps: ctx.steps || {}, vars: ctx.vars || {} };
    const reg = Registry.byId(node.type);
    if (!reg) return { ok: false, error: `Unknown node type: ${node.type}` };
    const resolved = resolveConfig(node, fullCtx);
    try {
        const out = await reg.run({ node: { ...node, config: resolved }, ctx: fullCtx });
        return { ok: true, output: out, input: resolved };
    } catch (e) {
        return { ok: false, error: String(e.message || e), input: resolved };
    }
}

export const Engine = { runAutomation, validateAutomation, testNode, RUN_STATUS };