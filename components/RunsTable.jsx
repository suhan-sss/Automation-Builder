'use client';

import { Registry } from '@/lib/registry';
import { fmtDateTime, fmtMs } from '@/lib/ids';

/**
 * Sortable, filterable runs table. Shows one row per run with:
 * status pill, automation name, trigger icon, duration, started time.
 * Click a row to open the run detail modal (handled by parent).
 */
export default function RunsTable({ runs, onSelect }) {
    if (!runs || runs.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <h3>No runs yet</h3>
                <p>Runs appear here when an automation fires. Trigger one from <a href="/automations">/automations</a>.</p>
            </div>
        );
    }
    return (
        <div className="data-table-wrap">
            <table className="data-table">
                <thead>
                    <tr>
                        <th style={{ width: 90 }}>Status</th>
                        <th>Automation</th>
                        <th>Trigger</th>
                        <th style={{ width: 120 }}>Duration</th>
                        <th style={{ width: 160 }}>Started</th>
                        <th style={{ width: 80 }}>Steps</th>
                    </tr>
                </thead>
                <tbody>
                    {runs.map(r => {
                        const trig = Registry.byId(r.trigger?.type);
                        return (
                            <tr key={r.id} onClick={() => onSelect && onSelect(r)} className="clickable">
                                <td><span className={`chip chip-status-${r.status}`}>{r.status}</span></td>
                                <td>
                                    <div className="strong">{r.automationName || '—'}</div>
                                    <div className="muted small mono">{r.id.slice(-8)}</div>
                                </td>
                                <td>
                                    <span className="trigger-cell">
                                        <span className="ico">{trig?.icon || '▶'}</span>
                                        <span className="muted small">{trig?.label || r.trigger?.type}</span>
                                    </span>
                                </td>
                                <td className="tnum">{fmtMs(r.durationMs)}</td>
                                <td className="muted small">{fmtDateTime(r.startedAt)}</td>
                                <td className="tnum">{r.steps?.length || 0}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
