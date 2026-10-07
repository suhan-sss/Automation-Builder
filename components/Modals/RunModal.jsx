'use client';

import { fmtDateTime, fmtMs } from '@/lib/ids';
import { Registry } from '@/lib/registry';

export default function RunModal({ run, onClose }) {
    if (!run) return null;
    const trigger = Registry.byId(run.trigger?.type);

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-card modal-card-lg">
                <div className="modal-head">
                    <div style={{ fontSize: 22 }}>{trigger?.icon || '▶'}</div>
                    <div>
                        <h2>Run #{run.id.slice(-6)}</h2>
                        <div className="sub">
                            <span className={`chip chip-status-${run.status}`}>{run.status}</span>
                            {' '}{fmtDateTime(run.startedAt)} · {fmtMs(run.durationMs)} · {run.steps.length} steps
                        </div>
                    </div>
                    <div className="modal-head-right">
                        <button className="btn-icon btn-ghost btn" onClick={onClose}>✕</button>
                    </div>
                </div>
                <div className="modal-body">
                    {run.error && (
                        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#991b1b', marginBottom: 12 }}>
                            <strong>Error:</strong> {run.error}
                        </div>
                    )}

                    <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Trigger</h3>
                    <div className="muted mono" style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 6, maxHeight: 160, overflow: 'auto' }}>
                        {trigger?.label} · {run.trigger?.type}
                        <br /><br />
                        {JSON.stringify(run.trigger?.payload, null, 2)}
                    </div>

                    <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>Steps</h3>
                    <ol className="auto-timeline">
                        {run.steps.map((s, i) => {
                            const reg = Registry.byId(s.type);
                            return (
                                <li key={i} className={s.status}>
                                    <div className="step-title">{reg?.icon} {reg?.label || s.type}</div>
                                    <div className="step-meta">
                                        {fmtMs(new Date(s.completedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime())}
                                        {s.retryCount > 0 ? ` · retried ${s.retryCount}×` : ''}
                                    </div>
                                    {s.output && (
                                        <pre className="step-output">{JSON.stringify(s.output, null, 2)}</pre>
                                    )}
                                    {s.error && (
                                        <pre className="step-error">{s.error}</pre>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                </div>
            </div>
        </div>
    );
}