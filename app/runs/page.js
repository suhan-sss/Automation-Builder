'use client';

import { useEffect, useMemo, useState } from 'react';
import PageShell from '@/components/PageShell';
import RunsTable from '@/components/RunsTable';
import RunModal from '@/components/Modals/RunModal';
import * as Store from '@/lib/store';
import { fmtMs } from '@/lib/ids';

const STATUS_FILTERS = [
    { id: 'all',       label: 'All',       color: '#6366f1' },
    { id: 'completed', label: 'Completed', color: '#10b981' },
    { id: 'failed',    label: 'Failed',    color: '#ef4444' },
    { id: 'running',   label: 'Running',   color: '#3b82f6' }
];

export default function RunsPage() {
    const [state, setState] = useState({ runs: [], automations: [] });
    const [hydrated, setHydrated] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');
    const [automationFilter, setAutomationFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [runFor, setRunFor] = useState(null);

    useEffect(() => {
        const seeded = Store.loadWithSeed();
        setState({ runs: seeded.runs, automations: seeded.automations });
        setHydrated(true);
    }, []);

    /* Stats across the (filtered) run list. */
    const stats = useMemo(() => {
        const total = state.runs.length;
        const completed = state.runs.filter(r => r.status === 'completed').length;
        const failed = state.runs.filter(r => r.status === 'failed').length;
        const today = new Date().toISOString().slice(0, 10);
        const runsToday = state.runs.filter(r => r.startedAt?.startsWith(today)).length;
        const successRate = total === 0 ? null : Math.round((completed / total) * 1000) / 10;
        const durations = state.runs.map(r => r.durationMs || 0).filter(d => d > 0);
        const avgMs = durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
        return { total, completed, failed, runsToday, successRate, avgMs };
    }, [state.runs]);

    /* Unique automation labels for the dropdown filter. */
    const automationOptions = useMemo(() => {
        const seen = new Map();
        for (const r of state.runs) {
            const key = r.automationId || r.automationName;
            if (key && !seen.has(key)) seen.set(key, r.automationName || r.automationId);
        }
        return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
    }, [state.runs]);

    /* Apply filters + search. */
    const filtered = useMemo(() => {
        return state.runs.filter(r => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (automationFilter !== 'all' && r.automationId !== automationFilter) return false;
            if (search) {
                const q = search.toLowerCase();
                return (r.automationName || '').toLowerCase().includes(q) ||
                       (r.id || '').toLowerCase().includes(q) ||
                       (r.trigger?.type || '').toLowerCase().includes(q);
            }
            return true;
        });
    }, [state.runs, statusFilter, automationFilter, search]);

    function clearAllRuns() {
        if (!confirm('Delete all runs? This cannot be undone.')) return;
        const next = Store.setRuns(state, []);
        setState(s => ({ ...s, runs: next.runs }));
    }

    if (!hydrated) {
        return (
            <PageShell breadcrumb={[{ label: 'Runs' }]}>
                <div className="empty-state">Loading…</div>
            </PageShell>
        );
    }

    return (
        <PageShell
            breadcrumb={[{ href: '/automations', label: 'Automations' }, { label: 'Runs' }]}
            searchSlot={
                <input
                    type="text" className="search-input"
                    placeholder="Search runs by automation, trigger, id…"
                    value={search} onChange={e => setSearch(e.target.value)}
                />
            }
            actions={
                <>
                    {state.runs.length > 0 && (
                        <button className="btn btn-secondary btn-sm" onClick={clearAllRuns}>Clear all</button>
                    )}
                    <a href="/automations" className="btn btn-primary btn-sm">+ New Automation</a>
                </>
            }
        >
            {/* Hero */}
            <section className="hero">
                <div className="hero-text">
                    <h1>Runs</h1>
                    <p>
                        Every time an automation fires, the run is recorded here with its full timeline —
                        trigger payload, step-by-step output, and any errors.
                    </p>
                </div>
                <div className="hero-actions">
                    <span className="muted">{state.runs.length} run{state.runs.length === 1 ? '' : 's'} all-time</span>
                </div>
            </section>

            {/* Stats */}
            <section className="stats">
                <div className="stat-card">
                    <div className="label">Total Runs</div>
                    <div className="value tnum">{stats.total}</div>
                    <div className="change trend-flat">{stats.runsToday} today</div>
                </div>
                <div className="stat-card">
                    <div className="label">Completed</div>
                    <div className="value tnum">{stats.completed}</div>
                    <div className="change trend-flat">all-time</div>
                </div>
                <div className="stat-card">
                    <div className="label">Failed</div>
                    <div className="value tnum" style={{ color: stats.failed > 0 ? 'var(--color-danger)' : undefined }}>{stats.failed}</div>
                    <div className="change trend-flat">
                        {stats.total === 0 ? '—' : `${Math.round((stats.failed / stats.total) * 100)}% of runs`}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="label">Success Rate</div>
                    <div className="value tnum">{stats.successRate === null ? '—' : `${stats.successRate}%`}</div>
                    <div className="change trend-flat">avg {fmtMs(stats.avgMs)}</div>
                </div>
            </section>

            {/* Filters */}
            <nav className="auto-tabs" role="tablist">
                {STATUS_FILTERS.map(f => (
                    <button
                        key={f.id}
                        className={`auto-tab ${statusFilter === f.id ? 'active' : ''}`}
                        onClick={() => setStatusFilter(f.id)}
                    >
                        {f.label}
                        <span className="count">
                            {f.id === 'all' ? state.runs.length : state.runs.filter(r => r.status === f.id).length}
                        </span>
                    </button>
                ))}
            </nav>

            {/* Automation filter + runs table */}
            <section style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <label className="muted small" htmlFor="auto-filter">Automation:</label>
                <select
                    id="auto-filter"
                    className="select-input"
                    value={automationFilter}
                    onChange={e => setAutomationFilter(e.target.value)}
                >
                    <option value="all">All automations</option>
                    {automationOptions.map(o => (
                        <option key={o.id} value={o.id}>{o.name || o.id}</option>
                    ))}
                </select>
                <span className="muted small">Showing {filtered.length} of {state.runs.length}</span>
            </section>

            <RunsTable runs={filtered} onSelect={setRunFor} />

            {runFor && <RunModal run={runFor} onClose={() => setRunFor(null)} />}
        </PageShell>
    );
}
