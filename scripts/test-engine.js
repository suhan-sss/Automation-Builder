// scripts/test-engine.js
//
// Node smoke test for the Connect360 Automation Builder engine + registry.
// Loads the pure-JS lib/ modules by staging them in a temp directory with
// a package.json that opts them into ESM mode, then uses dynamic import().
//
// Run: `npm test`

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT_LIB = path.resolve(__dirname, '..', 'lib');

/* ----------------------------------------------------------
   Stage lib/ and data/ in a temp ESM dir. Returns the temp dir.
   Mirrors the production layout so relative imports like
   `../data/sample-runs.js` from lib/store.js still resolve.
   ---------------------------------------------------------- */
function stageEsmCopy() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-smoke-'));
    fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ type: 'module' }, null, 2)
    );
    const tmpLib = path.join(tmp, 'lib');
    fs.mkdirSync(tmpLib, { recursive: true });
    for (const name of ['registry.js','engine.js','store.js','variables.js','ids.js','adapters.js']) {
        fs.copyFileSync(path.join(PROJECT_LIB, name), path.join(tmpLib, name));
    }
    const PROJECT_DATA = path.resolve(__dirname, '..', 'data');
    const tmpData = path.join(tmp, 'data');
    fs.mkdirSync(tmpData, { recursive: true });
    for (const name of fs.readdirSync(PROJECT_DATA)) {
        fs.copyFileSync(path.join(PROJECT_DATA, name), path.join(tmpData, name));
    }
    return tmp;
}

/* ----------------------------------------------------------
   Smoke checks
   ---------------------------------------------------------- */
let passed = 0, failed = 0;
function ok(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else      { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function group(name) { console.log(`\n# ${name}`); }

(async () => {
    console.log('Connect360 Automation Builder — engine smoke test\n');

    /* 1. Stage lib/ as ESM. */
    const tmp = stageEsmCopy();
    const tmpUrl = (f) => pathToFileURL(path.join(tmp, f)).href;

    /* The data: URL trick was wrong: ESM can't follow relative imports inside
       a non-hierarchical URL. Staging + scoped package.json is reliable. */

    /* 2. Import each module via dynamic import(). */
    const Registry  = (await import(tmpUrl('lib/registry.js'))).Registry;
    const Engine    = await import(tmpUrl('lib/engine.js'));
    const Store     = await import(tmpUrl('lib/store.js'));
    const Variables = await import(tmpUrl('lib/variables.js'));
    const Adapters  = await import(tmpUrl('lib/adapters.js'));

    /* The staged modules run in a fresh realm — re-attach browser stubs
       so registry.js's _toast / _log hooks do not crash. */
    globalThis.window      = globalThis.window || {};
    globalThis.window.__autoToast = (msg, type) => console.log(`  [toast:${type || 'info'}] ${msg}`);

    /* 3. Registry surface. */
    group('Registry surface');
    ok('Registry is an object',               Registry && typeof Registry === 'object');
    ok('triggers is an array',                Array.isArray(Registry.triggers));
    ok('conditions is an array',              Array.isArray(Registry.conditions));
    ok('actions is an array',                 Array.isArray(Registry.actions));
    ok('dataNodes is an array',               Array.isArray(Registry.dataNodes));
    ok('aiNodes is an array',                 Array.isArray(Registry.aiNodes));
    ok('utility is an array',                 Array.isArray(Registry.utility));
    ok('byId() is a function',                typeof Registry.byId === 'function');

    const trigN = Registry.triggers.length;
    const actN  = Registry.actions.length;
    ok('triggers ≥ 25', trigN >= 25, `got ${trigN}`);
    ok('actions  ≥ 30', actN  >= 30, `got ${actN}`);
    ok('total nodes ≥ 70', (trigN + actN + Registry.conditions.length +
        Registry.dataNodes.length + Registry.aiNodes.length + Registry.utility.length) >= 70);

    /* 4. Descriptor shape. */
    group('Descriptor shape');
    const all = [
        ...Registry.triggers, ...Registry.conditions, ...Registry.actions,
        ...Registry.dataNodes, ...Registry.aiNodes, ...Registry.utility
    ];
    ok('every descriptor has id',       all.every(d => typeof d.id === 'string' && d.id.length));
    ok('every descriptor has label',    all.every(d => typeof d.label === 'string' && d.label.length));
    ok('every descriptor has category', all.every(d => typeof d.category === 'string'));
    ok('every descriptor has run()',    all.every(d => typeof d.run === 'function'));
    ok('every descriptor has icon',     all.every(d => typeof d.icon === 'string'));

    /* 5. byId() lookup. */
    group('byId() lookup');
    const sample = Registry.triggers[0];
    ok('byId(sample) returns same descriptor', Registry.byId(sample.id) === sample);
    ok('byId(unknown) returns null',           Registry.byId('not.a.real.id') === null);

    /* 6. Variables. */
    group('Variables');
    ok('interpolate() resolves {{vars.X}}',
        Variables.interpolate('hello {{vars.name}}', { vars: { name: 'world' } }) === 'hello world');
    ok('interpolate() resolves nested paths',
        Variables.interpolate('{{trigger.lead.email}}', { trigger: { lead: { email: 'a@b.c' } } }) === 'a@b.c');
    ok('interpolate() throws UnknownVariable in strict mode',
        (() => {
            try { Variables.interpolate('{{vars.x}}', {}, { strict: true }); return false; }
            catch (e) { return e instanceof Variables.UnknownVariable; }
        })());

    /* 7. validateAutomation — empty automation. */
    group('validateAutomation');
    const emptyRes = Engine.validateAutomation({ trigger: { type: null }, nodes: [], edges: [] });
    ok('flags missing trigger',
        emptyRes.ok === false && (emptyRes.errors || []).some(e => /trigger/i.test(e.message || '')));

    /* 8. runAutomation — trigger → if/else → action. */
    group('runAutomation');

    const branchAuto = {
        name: 'Branch smoke',
        trigger: { id: 'trig', type: 'manual.run', config: {} },
        nodes: [
            { id: 'c1',    type: 'condition.if',  label: 'High value?',
              config: {
                  combinator: 'all',
                  rules: [{ field: 'trigger.value', op: 'gt', value: 100 }]
              } },
            { id: 'aYes',  type: 'data.setVariable', label: 'Flag hot',
              config: { name: 'tier', value: 'hot' } },
            { id: 'aNo',   type: 'data.setVariable', label: 'Flag cold',
              config: { name: 'tier', value: 'cold' } }
        ],
        edges: [
            { from: 'trig', to: 'c1',   branch: 'default' },
            { from: 'c1',   to: 'aYes', branch: 'yes' },
            { from: 'c1',   to: 'aNo',  branch: 'no' }
        ],
        settings: { retries: 0, retryDelay: '5m', onError: 'stop' }
    };

    const runHot  = await Engine.runAutomation(branchAuto, { value: 250, leadId: 'l-001' });
    ok('hot run completes',         runHot.status === 'completed', `got ${runHot.status}`);
    /* Trigger is not run as a step; only c1 + aYes execute → 2 steps. */
    ok('hot run has 2 steps',       runHot.steps.length === 2, `got ${runHot.steps.length}`);
    ok('hot run took yes branch',   runHot.steps.some(s => s.nodeId === 'aYes') &&
                                     !runHot.steps.some(s => s.nodeId === 'aNo'));

    const runCold = await Engine.runAutomation(branchAuto, { value: 5, leadId: 'l-002' });
    ok('cold run completes',        runCold.status === 'completed');
    ok('cold run took no branch',   !runCold.steps.some(s => s.nodeId === 'aYes') &&
                                     runCold.steps.some(s => s.nodeId === 'aNo'));

    /* 9. localStorage round-trip (Store uses in-memory shim under Node). */
    group('localStorage round-trip');
    Store.setStoreOrg('smoke');
    const before = {
        automations: [branchAuto],
        runs: [runHot, runCold],
        audit: [{ at: new Date().toISOString(), actor: 'test', action: 'created' }]
    };
    Store.save(before);
    const after = Store.load();
    ok('round-trip preserves automations',   after.automations.length === 1);
    ok('round-trip preserves runs',          after.runs.length === 2);
    ok('round-trip preserves audit',         after.audit.length === 1);
    ok('round-trip preserves automation id', after.automations[0].id === branchAuto.id);

    /* 10. Adapters — credential lookup + missing-creds error. */
    group('Adapters');
    ok('lookupCreds returns null when no creds anywhere',
        Adapters.lookupCreds('whatsapp', {}) === null);
    ok('lookupCreds reads from ctx.settings.credentials',
        (() => {
            const c = Adapters.lookupCreds('whatsapp', { settings: { credentials: { whatsapp: { phoneNumberId: 'p-123', accessToken: 'tok' } } } });
            return c && c.source === 'automation' && c.phoneNumberId === 'p-123' && c.accessToken === 'tok';
        })());
    ok('lookupCreds reads from ctx.automation.settings.credentials',
        (() => {
            const c = Adapters.lookupCreds('crm', { automation: { settings: { credentials: { crm: { apiBase: 'https://crm.example.com', token: 'tok' } } } } });
            return c && c.source === 'automation' && c.apiBase === 'https://crm.example.com';
        })());
    ok('requireCreds throws when creds are null',
        (() => { try { Adapters.requireCreds('whatsapp', null, ['phoneNumberId','accessToken']); return false; }
                 catch (e) { return /credentials not configured/i.test(e.message); } })());
    ok('requireCreds throws when a required field is missing',
        (() => { try { Adapters.requireCreds('whatsapp', { phoneNumberId: 'p' }, ['phoneNumberId','accessToken']); return false; }
                 catch (e) { return /accessToken.*missing/i.test(e.message); } })());

    /* 11. Real adapters throw when no credentials. */
    group('Real adapters require credentials');
    const noCredsAuto = {
        trigger: { id: 'trig', type: 'manual.run', config: {} },
        nodes: [
            { id: 'a', type: 'crm.lead.create', label: 'Create lead',
              config: { source: 'test', fields: { name: 'Test' } } }
        ],
        edges: [{ from: 'trig', to: 'a', branch: 'default' }],
        settings: { retries: 0, retryDelay: '5m', onError: 'stop' }
    };
    const noCredsRun = await Engine.runAutomation(noCredsAuto, {});
    ok('runAutomation fails when crm creds missing',
        noCredsRun.status === 'failed',
        `got ${noCredsRun.status}`);
    ok('failure error mentions "credentials"',
        /credentials not configured/i.test(noCredsRun.error || ''),
        `error: ${noCredsRun.error}`);
    ok('the failing step is recorded',
        Array.isArray(noCredsRun.steps) && noCredsRun.steps.some(s => s.status === 'failed'));

    /* 12. Final tally. */
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
    console.error('\nFATAL:', err && err.stack || err);
    process.exit(2);
});
