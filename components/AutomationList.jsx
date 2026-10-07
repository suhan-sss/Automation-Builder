'use client';

import { Registry } from '@/lib/registry';
import { fmtRelative } from '@/lib/ids';

export default function AutomationList({ automations, categories, onSelect, onRun, searchQuery }) {
    return (
        <div className="table-card">
            <table className="data-table">
                <thead>
                    <tr>
                        <th style={{ width: 36 }}></th>
                        <th>Automation</th>
                        <th>Trigger</th>
                        <th>Steps</th>
                        <th>Runs</th>
                        <th>Success</th>
                        <th>Last run</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {automations.map(a => {
                        const trigger = Registry.byId(a.trigger?.type);
                        return (
                            <tr key={a.id} onClick={() => onSelect(a.id)}>
                                <td style={{ fontSize: 18, textAlign: 'center' }}>{trigger?.icon || '⚡'}</td>
                                <td>
                                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                                        <div className="muted" style={{ fontSize: 12 }}>{a.folder || '—'}</div>
                                    </td>
                                <td>{trigger?.label || '—'}</td>
                                <td>{a.nodes?.length || 0}</td>
                                <td className="tnum">{a.runCount || 0}</td>
                                <td className="tnum">
                                    {a.runCount
                                        ? `${Math.round(((a.successCount || 0) / a.runCount) * 100)}%`
                                        : '—'
                                    }
                                </td>
                                <td>{fmtRelative(a.lastRunAt)}</td>
                                <td><span className={`chip chip-status-${a.status}`}>{a.status}</span></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {automations.length === 0 && (
                <div className="empty-state">
                    <h3>No automations yet</h3>
                    <p>Click <strong>+ New Automation</strong> to create your first workflow.</p>
                </div>
            )}
        </div>
    );
}