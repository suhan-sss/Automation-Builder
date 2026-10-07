'use client';

import { useState } from 'react';
import { Registry } from '@/lib/registry';
import { fmtDateTime, fmtRelative } from '@/lib/ids';

export default function DetailModal({ automation, runs, onClose, onEdit, onRun, onPause, onArchive, onDuplicate, onDelete, onOpenRun }) {
    const [tab, setTab] = useState('overview');

    const trigger = Registry.byId(automation.trigger?.type);

    function tabBtn(name, label) {
        return (
            <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{label}</button>
        );
    }

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-card modal-card-lg">
                <div className="modal-head">
                    <div style={{ fontSize: 24 }}>{trigger?.icon || '⚡'}</div>
                    <div>
                        <h2>{automation.name || 'Untitled automation'}</h2>
                        <div className="sub">
                            <span className={`chip chip-status-${automation.status}`}>{automation.status}</span>
                            {' '}v{automation.version || 1} · {automation.nodes?.length || 0} steps · {automation.runCount || 0} runs · updated {fmtRelative(automation.updatedAt)}
                        </div>
                    </div>
                    <div className="modal-head-right">
                        {automation.status === 'paused'
                            ? <button className="btn btn-primary btn-sm" onClick={() => onEdit(automation)}>Edit</button>
                            : <button className="btn btn-secondary btn-sm" onClick={() => onEdit(automation)}>Edit</button>
                        }
                        <button className="btn btn-secondary btn-sm" onClick={() => onRun(automation)}>▶ Run now</button>
                        <button className="btn-icon btn-ghost btn" onClick={onClose}>✕</button>
                    </div>
                </div>

                <div className="modal-body">
                    <div className="auto-detail-tabs">
                        {tabBtn('overview', 'Overview')}
                        {tabBtn('graph', 'Workflow')}
                        {tabBtn('runs', `Runs (${runs.length})`)}
                        {tabBtn('settings', 'Settings')}
                    </div>

                    {tab === 'overview' && <OverviewTab automation={automation} />}
                    {tab === 'graph' && <GraphTab automation={automation} />}
                    {tab === 'runs' && <RunsTab runs={runs} onOpenRun={onOpenRun} />}
                    {tab === 'settings' && <SettingsTab automation={automation} onPause={onPause} onArchive={onArchive} onDuplicate={onDuplicate} onDelete={onDelete} />}
                </div>
            </div>
        </div>
    );
}

function OverviewTab({ automation }) {
    const trigger = Registry.byId(automation.trigger?.type);
    const steps = automation.nodes || [];

    return (
        <div>
            <div style={{ marginBottom: 20 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{trigger?.icon} {trigger?.label || 'No trigger'}</h3>
                <div className="muted">{trigger?.description}</div>
            </div>

            <h3 style={{ margin: '20px 0 12px', fontSize: 14 }}>Steps ({steps.length})</h3>
            {steps.length === 0 && <div className="muted">No steps yet — click Edit to add actions.</div>}
            {steps.map((n, i) => {
                const reg = Registry.byId(n.type);
                return (
                    <div key={n.id} className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ width: 24, color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</div>
                        <span style={{ width: 24 }}>{reg?.icon}</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600 }}>{reg?.label || n.type}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{reg?.description}</div>
                        </div>
                    </div>
                );
            })}

            <div className="auto-kv" style={{ marginTop: 24 }}>
                <div className="k">Folder</div><div className="v">{automation.folder || '—'}</div>
                <div className="k">Owner</div><div className="v">{automation.owner || '—'}</div>
                <div className="k">Tags</div><div className="v">{(automation.tags || []).join(', ') || '—'}</div>
                <div className="k">Created</div><div className="v">{fmtDateTime(automation.createdAt)}</div>
                <div className="k">Last run</div><div className="v">{fmtRelative(automation.lastRunAt)}</div>
                <div className="k">Success</div><div className="v">{automation.successCount || 0}</div>
                <div className="k">Failed</div><div className="v">{automation.failCount || 0}</div>
            </div>
        </div>
    );
}

function GraphTab({ automation }) {
    const triggerReg = Registry.byId(automation.trigger?.type);
    return (
        <div className="auto-flow">
            {triggerReg && (
                <NodeSummary icon={triggerReg.icon} label={triggerReg.label} sub={triggerReg.description} />
            )}
            {(automation.nodes || []).map(n => {
                const reg = Registry.byId(n.type);
                return <NodeSummary key={n.id} icon={reg?.icon} label={reg?.label || n.type} sub={reg?.description} />;
            })}
            {(automation.nodes || []).length === 0 && (
                <div className="muted">No nodes — edit and start composing.</div>
            )}
        </div>
    );
}

function NodeSummary({ icon, label, sub }) {
    return (
        <div className="auto-node">
            <div className="auto-node-head">
                <span className="ico" style={{ background: 'var(--accent-fade)' }}>{icon}</span>
                <div className="body">
                    <div className="label">{label}</div>
                    <div className="sub">{sub}</div>
                </div>
            </div>
        </div>
    );
}

function RunsTab({ runs, onOpenRun }) {
    if (runs.length === 0) return <div className="empty-state"><h3>No runs yet</h3><p>Click ▶ Run now to test this automation.</p></div>;
    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Steps</th>
                    <th>Trigger</th>
                </tr>
            </thead>
            <tbody>
                {runs.map(r => (
                    <tr key={r.id} onClick={() => onOpenRun(r)}>
                        <td>{fmtRelative(r.startedAt)}<br /><span className="muted" style={{ fontSize: 11 }}>{fmtDateTime(r.startedAt)}</span></td>
                        <td><span className={`chip chip-status-${r.status}`}>{r.status}</span></td>
                        <td>{r.durationMs}ms</td>
                        <td>{r.steps.length}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{r.trigger?.type}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function SettingsTab({ automation, onPause, onArchive, onDuplicate, onDelete }) {
    return (
        <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Execution settings</h3>
            <div className="auto-kv">
                <div className="k">On error</div><div className="v">{automation.settings?.onError || 'stop'}</div>
                <div className="k">Retries</div><div className="v">{automation.settings?.retries ?? 0}</div>
                <div className="k">Retry delay</div><div className="v">{automation.settings?.retryDelay || '5m'}</div>
                <div className="k">Concurrency</div><div className="v">{automation.settings?.concurrency || 'queue'}</div>
                <div className="k">Dedupe key</div><div className="v mono">{automation.settings?.dedupeKey || '—'}</div>
                <div className="k">Rate limit</div><div className="v">{automation.settings?.rateLimitGuard ? `${automation.settings.rateLimitGuard.perHour}/h · ${automation.settings.rateLimitGuard.perDay}/d` : '—'}</div>
            </div>

            <h3 style={{ margin: '24px 0 8px', fontSize: 14 }}>Danger zone</h3>
            <div className="row wrap" style={{ gap: 8 }}>
                {automation.status === 'published'
                    ? <button className="btn btn-secondary btn-sm" onClick={() => onPause(automation)}>⏸ Pause</button>
                    : <button className="btn btn-secondary btn-sm" onClick={() => onPause(automation, true)}>▶ Resume</button>
                }
                <button className="btn btn-secondary btn-sm" onClick={() => onArchive(automation)}>{automation.status === 'archived' ? 'Unarchive' : 'Archive'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => onDuplicate(automation)}>Duplicate</button>
                <button className="btn btn-danger btn-sm" onClick={() => onDelete(automation)}>Delete</button>
            </div>
        </div>
    );
}