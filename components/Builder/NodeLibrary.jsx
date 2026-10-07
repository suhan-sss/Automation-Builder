'use client';

import { useMemo, useState } from 'react';
import { Registry } from '@/lib/registry';

export default function NodeLibrary({ onPick }) {
    const [q, setQ] = useState('');
    const grouped = useMemo(() => Registry.grouped(), []);

    const filtered = useMemo(() => {
        if (!q) return grouped;
        const matched = new Set(Registry.search(q).map(n => n.id));
        return grouped.map(g => ({
            ...g,
            items: g.items.filter(n => matched.has(n.id)),
            subGroups: g.subGroups
                .map(sg => ({ ...sg, items: sg.items.filter(n => matched.has(n.id)) }))
                .filter(sg => sg.items.length > 0)
        })).filter(g => g.items.length > 0);
    }, [q, grouped]);

    return (
        <aside className="auto-rail">
            <input
                type="text"
                className="auto-rail-search"
                placeholder="Search nodes…"
                value={q}
                onChange={e => setQ(e.target.value)}
            />
            {filtered.map(group => (
                <div key={group.key} className="auto-rail-group">
                    <h4>{group.label}</h4>
                    {group.subGroups.map(sg => (
                        <div key={sg.name}>
                            {sg.name !== 'Other' && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 4px', fontWeight: 600 }}>{sg.name}</div>
                            )}
                            {sg.items.map(n => (
                                <div
                                    key={n.id}
                                    className="auto-rail-item"
                                    onClick={() => onPick(n.id)}
                                    title={n.description}
                                >
                                    <span className="ico" style={{ background: n.color + '22', color: n.color }}>{n.icon}</span>
                                    <div className="body">
                                        <div className="label">{n.label}</div>
                                        <div className="sub">{n.description}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            ))}
            {filtered.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>
                    No nodes match "{q}".
                </div>
            )}
        </aside>
    );
}