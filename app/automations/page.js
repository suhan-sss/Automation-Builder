'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Registry } from '@/lib/registry';
import { Engine } from '@/lib/engine';
import * as Store from '@/lib/store';
import { genId, nowIso, fmtRelative, fmtNum } from '@/lib/ids';
import { useToast } from '@/components/Toast';

import PageShell from '@/components/PageShell';
import Sidebar from '@/components/Sidebar';
import AutomationList from '@/components/AutomationList';
import BuilderModal from '@/components/Builder/BuilderModal';
import DetailModal from '@/components/Modals/DetailModal';
import TestModal from '@/components/Modals/TestModal';
import RunModal from '@/components/Modals/RunModal';
import TemplatesModal from '@/components/TemplatesModal';
import { TEMPLATES, getTemplate } from '@/data/templates';

const EMPTY_CATEGORIES = [
    { id: 'all',       name: 'All',       color: '#6366f1' },
    { id: 'draft',     name: 'Draft',     color: '#94a3b8' },
    { id: 'published', name: 'Published', color: '#10b981' },
    { id: 'paused',    name: 'Paused',    color: '#f59e0b' },
    { id: 'archived',  name: 'Archived',  color: '#475569' }
];

/* Default export — wraps the inner page in <Suspense> so useSearchParams()
   is allowed during static export (Next.js 14 requirement). */
export default function AutomationsPage() {
    return (
        <Suspense fallback={<AutomationsLoading />}>
            <AutomationsPageInner />
        </Suspense>
    );
}

function AutomationsLoading() {
    return (
        <PageShell breadcrumb={[{ label: 'Automations' }]}>
            <div className="empty-state">Loading…</div>
        </PageShell>
    );
}

function AutomationsPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [state, setState] = useState({ automations: [], runs: [], audit: [] });
    const [hydrated, setHydrated] = useState(false);

    const [statusFilter, setStatusFilter] = useState('all');
    const [search, setSearch] = useState('');

    const [builderFor, setBuilderFor] = useState(null);
    const [detailFor, setDetailFor] = useState(null);
    const [testFor, setTestFor]     = useState(null);
    const [runFor, setRunFor]       = useState(null);
    const [templatesOpen, setTemplatesOpen] = useState(false);

    /* Hydrate from localStorage on mount (with one-time seed). */
    useEffect(() => {
        setState(Store.loadWithSeed());
        setHydrated(true);
    }, []);

    /* Open builder from /templates?template=ID once we've hydrated. */
    useEffect(() => {
        if (!hydrated) return;
        const tplId = searchParams.get('template');
        if (!tplId) return;
        const tpl = getTemplate(tplId);
        if (tpl) {
            openBuilderFromTemplate(tpl);
            /* Clear the query so a refresh doesn't re-open it. */
            router.replace('/automations');
        }
    }, [hydrated, searchParams]);

    const liveStats = useMemo(() => computeStats(state.automations, state.runs), [state]);

    const filtered = useMemo(() => {
        return state.automations.filter(a => {
            if (statusFilter !== 'all' && a.status !== statusFilter) return false;
            if (search) {
                const q = search.toLowerCase();
                return (a.name || '').toLowerCase().includes(q) ||
                       (a.folder || '').toLowerCase().includes(q) ||
                       (a.tags || []).some(t => t.toLowerCase().includes(q));
            }
            return true;
        });
    }, [state.automations, statusFilter, search]);

    const categoryCounts = useMemo(() => {
        const out = { all: state.automations.length };
        for (const c of EMPTY_CATEGORIES) {
            if (c.id === 'all') continue;
            out[c.id] = state.automations.filter(a => a.status === c.id).length;
        }
        return out;
    }, [state.automations]);

    const detailRuns = useMemo(() => {
        if (!detailFor) return [];
        return state.runs.filter(r => r.automationId === detailFor.id);
    }, [state.runs, detailFor]);

    /* ===== Mutators ===== */
    function openBuilder(automation) {
        if (!automation || typeof automation === 'string') {
            setBuilderFor(blankAutomation(automation));
        } else {
            setBuilderFor(JSON.parse(JSON.stringify(automation)));
        }
    }
    function openBuilderFromTemplate(template) {
        const auto = templateToAutomation(template);
        setBuilderFor(auto);
        setTemplatesOpen(false);
    }
    function saveBuilder(next) {
        setBuilderFor(next);
        if (!next) return;
        const persisted = {
            ...next,
            updatedAt: nowIso(),
            createdAt: next.createdAt || nowIso()
        };
        setState((s) => {
            const exists = s.automations.some(a => a.id === persisted.id);
            const automations = exists
                ? s.automations.map(a => a.id === persisted.id ? persisted : a)
                : [...s.automations, persisted];
            const nextState = { ...s, automations };
            Store.save(nextState);
            return nextState;
        });
    }
    async function runAutomation(automation, payload) {
        if (!automation) return;
        const result = await Engine.runAutomation(automation, payload, {
            onStep: () => { /* engine writes its own timeline */ }
        });
        setState((s) => {
            let nextState = Store.addRun(s, result);
            nextState = Store.bumpAutomationStats(nextState, automation.id, result.status === 'completed');
            return nextState;
        });
        if (result.status === 'completed') {
            pushToast(`✓ ${automation.name} — ${result.steps.length} steps in ${result.durationMs}ms`, 'success');
        } else {
            pushToast(`✕ ${automation.name} — ${result.error}`, 'error');
        }
        return result;
    }
    async function runAndOpenModal(automation, payload) {
        const r = await runAutomation(automation, payload);
        setTestFor(null);
        setRunFor(r);
    }
    function pauseToggle(automation, forceResume = false) {
        const next = forceResume ? 'published' : (automation.status === 'published' ? 'paused' : 'published');
        setState(s => {
            const automations = s.automations.map(a => a.id === automation.id ? { ...a, status: next, updatedAt: nowIso() } : a);
            const nextState = { ...s, automations };
            Store.save(nextState);
            return nextState;
        });
        if (detailFor?.id === automation.id) {
            setDetailFor({ ...automation, status: next });
        }
        pushToast(forceResume ? `▶ Resumed` : `⏸ Paused`, 'info');
    }
    function archive(automation) {
        const next = automation.status === 'archived' ? 'draft' : 'archived';
        setState(s => {
            const automations = s.automations.map(a => a.id === automation.id ? { ...a, status: next, updatedAt: nowIso() } : a);
            const nextState = { ...s, automations };
            Store.save(nextState);
            return nextState;
        });
        if (detailFor?.id === automation.id) setDetailFor({ ...automation, status: next });
        pushToast(next === 'archived' ? `📦 Archived` : `↩ Unarchived`, 'info');
    }
    function duplicate(automation) {
        setState(s => Store.duplicateAutomation(s, automation.id));
        pushToast('Duplicated', 'success');
    }
    function remove(automation) {
        if (!confirm(`Delete "${automation.name}"? This cannot be undone.`)) return;
        setState(s => Store.deleteAutomation(s, automation.id));
        setDetailFor(null);
        pushToast('Deleted', 'info');
    }

    const { push: pushToast } = useToast();

    if (!hydrated) {
        return (
            <PageShell breadcrumb={[{ label: 'Automations' }]}>
                <div className="empty-state">Loading…</div>
            </PageShell>
        );
    }

    return (
        <PageShell
            breadcrumb={[{ label: 'Automations' }]}
            searchSlot={
                <input
                    type="text" className="search-input"
                    placeholder="Search automations by name, folder, tag…"
                    value={search} onChange={e => setSearch(e.target.value)}
                />
            }
            actions={
                <>
                    <a href="/runs" className="btn btn-secondary btn-sm">📊 Runs ({state.runs.length})</a>
                    <button className="btn btn-secondary btn-sm" onClick={() => setTemplatesOpen(true)}>📋 Templates</button>
                    <button className="btn btn-primary btn-sm" onClick={() => openBuilder('new')}>+ New Automation</button>
                </>
            }
        >
            {/* Hero */}
            <section className="hero">
                <div className="hero-text">
                    <h1>Automations</h1>
                    <p>
                        Build once, run forever. Compose triggers, conditions, and actions across CRM, ads, WhatsApp, AI, and property portals — all in one engine.
                        {state.automations.length > 0 && (
                            <> <strong style={{ color: 'var(--accent-primary)' }}>{state.automations.filter(a => a.status === 'published').length}</strong> live.</>
                        )}
                    </p>
                </div>
                <div className="hero-actions">
                    <a href="/templates" className="btn btn-secondary btn-sm">
                        ⚡ {TEMPLATES.length} templates
                    </a>
                </div>
            </section>

            {/* Stats */}
            <section className="stats">
                {liveStats.map((s, i) => (
                    <div key={i} className="stat-card">
                        <div className="label">{s.label}</div>
                        <div className="value tnum">{s.value}</div>
                        <div className={`change trend-${s.trend === 'up' ? 'flat' : s.trend === 'down' ? 'down' : 'flat'}`}>{s.change}</div>
                    </div>
                ))}
            </section>

            {/* Category tabs */}
            <nav className="auto-tabs" role="tablist">
                {EMPTY_CATEGORIES.map(c => (
                    <button
                        key={c.id}
                        className={`auto-tab ${statusFilter === c.id ? 'active' : ''}`}
                        onClick={() => setStatusFilter(c.id)}
                    >
                        {c.name}
                        <span className="count">{categoryCounts[c.id] || 0}</span>
                    </button>
                ))}
            </nav>

            <AutomationList
                automations={filtered}
                categories={EMPTY_CATEGORIES}
                onSelect={(id) => {
                    const a = state.automations.find(x => x.id === id);
                    if (a) setDetailFor(a);
                }}
                onRun={(a) => setTestFor(a)}
                searchQuery={search}
            />

            {/* Empty-state hint when no automations and no runs — show the templates CTA prominently. */}
            {state.automations.length === 0 && (
                <section style={{ marginTop: 32, padding: 24, background: 'var(--bg-card)', borderRadius: 12, border: '1px dashed var(--border-color)' }}>
                    <h3 style={{ margin: '0 0 8px' }}>Get started in 3 ways</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 16 }}>
                        <button className="empty-cta-card" onClick={() => openBuilder('new')}>
                            <div className="ico">✨</div>
                            <div className="title">Blank automation</div>
                            <div className="muted small">Start from scratch with a trigger and your own steps.</div>
                        </button>
                        <a href="/templates" className="empty-cta-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                            <div className="ico">📋</div>
                            <div className="title">Pick a template</div>
                            <div className="muted small">{TEMPLATES.length} pre-built RE workflows ready to use.</div>
                        </a>
                        <a href="/runs" className="empty-cta-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                            <div className="ico">📊</div>
                            <div className="title">See runs in action</div>
                            <div className="muted small">Sample run history already loaded.</div>
                        </a>
                    </div>
                </section>
            )}

            {/* ===== Modals ===== */}
            {builderFor && (
                <BuilderModal
                    automation={builderFor}
                    onChange={saveBuilder}
                    onSave={(next) => {
                        saveBuilder(next);
                        if (next.status === 'published') {
                            pushToast('✓ Published', 'success');
                            setBuilderFor(null);
                        } else {
                            pushToast('✓ Draft saved', 'info');
                        }
                    }}
                    onClose={() => setBuilderFor(null)}
                />
            )}
            {detailFor && (
                <DetailModal
                    automation={detailFor}
                    runs={detailRuns}
                    onClose={() => setDetailFor(null)}
                    onEdit={(a) => { setDetailFor(null); openBuilder(a); }}
                    onRun={(a) => setTestFor(a)}
                    onPause={pauseToggle}
                    onArchive={archive}
                    onDuplicate={duplicate}
                    onDelete={remove}
                    onOpenRun={(r) => setRunFor(r)}
                />
            )}
            {testFor && (
                <TestModal
                    automation={testFor}
                    onClose={() => setTestFor(null)}
                    onRun={runAndOpenModal}
                />
            )}
            {runFor && (
                <RunModal run={runFor} onClose={() => setRunFor(null)} />
            )}
            {templatesOpen && (
                <TemplatesModal
                    templates={TEMPLATES}
                    onPick={(t) => {
                        if (t) openBuilderFromTemplate(t);
                        else openBuilder('new');
                        setTemplatesOpen(false);
                    }}
                    onClose={() => setTemplatesOpen(false)}
                />
            )}
        </PageShell>
    );
}

/* ============================================================
   Helpers
   ============================================================ */

function blankAutomation(_idHint) {
    return {
        id: genId('auto'),
        name: 'Untitled automation',
        description: '',
        folder: '',
        tags: [],
        owner: 'demo',
        status: 'draft',
        version: 1,
        trigger: { id: 'trigger-' + genId('t').slice(2, 8), type: null, config: {} },
        nodes: [],
        edges: [],
        variables: [],
        settings: {
            retries: 0,
            retryDelay: '5m',
            onError: 'stop',
            concurrency: 'queue'
        },
        audit: [],
        runCount: 0,
        successCount: 0,
        failCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso()
    };
}

/* Convert a template into a fresh automation. Deep-clone so the
   template source isn't mutated by builder edits. */
function templateToAutomation(template) {
    const auto = blankAutomation();
    auto.name = template.name;
    auto.description = template.tagline;
    auto.folder = template.category;
    auto.tags = (template.tags || []).slice();
    auto.status = 'draft';
    auto.trigger = {
        id: 'trigger-' + genId('t').slice(2, 8),
        type: template.trigger,
        config: template.config || {}
    };
    auto.nodes = JSON.parse(JSON.stringify(template.nodes || []));
    auto.edges = JSON.parse(JSON.stringify(template.edges || []));
    auto.settings = { ...auto.settings, ...(template.settings || {}) };
    return auto;
}

function computeStats(automations, runs) {
    const live = automations.filter(a => a.status === 'published').length;
    const today = new Date().toISOString().slice(0, 10);
    const runsToday = runs.filter(r => r.startedAt && r.startedAt.startsWith(today)).length;
    const completed = runs.filter(r => r.status === 'completed').length;
    const failed = runs.filter(r => r.status === 'failed').length;
    const successRate = runs.length === 0 ? null : Math.round((completed / runs.length) * 1000) / 10;

    return [
        { label: 'Active Automations', value: String(live), change: `${automations.length} total`, trend: 'flat' },
        { label: 'Runs Today',         value: String(runsToday), change: `${runs.length} all-time`, trend: 'flat' },
        { label: 'Success Rate',       value: successRate === null ? '—' : successRate + '%', change: `${completed} ok`, trend: 'flat' },
        { label: 'Failed Runs',        value: String(failed), change: runs.length ? `${Math.round((failed/runs.length)*100)}% of runs` : '0', trend: 'flat' }
    ];
}
