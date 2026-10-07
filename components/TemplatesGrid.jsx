'use client';

import { Registry } from '@/lib/registry';

/**
 * Reusable templates grid. Used by /templates (standalone) and the
 * TemplatesModal inside /automations. Supports category filter chips,
 * a search input, and a click handler that receives the picked template.
 */
export default function TemplatesGrid({ templates, filter, search, onPick, emptyCta }) {
    const filtered = (templates || []).filter(t => {
        if (filter && filter !== 'all' && t.category !== filter) return false;
        if (search) {
            const q = search.toLowerCase();
            return t.name.toLowerCase().includes(q) ||
                   t.tagline.toLowerCase().includes(q) ||
                   (t.tags || []).some(tag => tag.toLowerCase().includes(q));
        }
        return true;
    });

    if (filtered.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <h3>No templates match</h3>
                <p style={{ marginBottom: '20px' }}>
                    Try a different category or search term.
                </p>
                {emptyCta && (
                    <button className="btn btn-primary" onClick={emptyCta.onClick}>{emptyCta.label}</button>
                )}
            </div>
        );
    }

    return (
        <div className="auto-tpl-grid">
            {filtered.map(t => {
                const trig = Registry.byId(t.trigger);
                return (
                    <div key={t.id} className="auto-tpl-card" onClick={() => onPick && onPick(t)}>
                        <div className="head">
                            <span className="ico">{trig?.icon || '⚡'}</span>
                            <div>
                                <div className="name">{t.name}</div>
                                <div className="cat">{t.category}</div>
                            </div>
                        </div>
                        <div className="body">{t.tagline}</div>
                        <div className="tags">
                            {(t.tags || []).map(tag => <span key={tag} className="tag">#{tag}</span>)}
                        </div>
                        <div className="footer">
                            <span className="muted">{t.nodes?.length || 0} steps</span>
                            <button className="btn btn-sm btn-primary">Use template →</button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
