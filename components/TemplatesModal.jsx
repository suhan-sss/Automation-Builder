'use client';

import { Registry } from '@/lib/registry';

export default function TemplatesModal({ templates, onPick, onClose }) {
    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-card modal-card-lg">
                <div className="modal-head">
                    <div>
                        <h2>Templates</h2>
                        <div className="sub">Start from a pre-built workflow — open it in the builder to customize.</div>
                    </div>
                    <div className="modal-head-right">
                        <button className="btn btn-secondary btn-sm" onClick={() => onPick(null)}>+ Blank automation</button>
                        <button className="btn-icon btn-ghost btn" onClick={onClose}>✕</button>
                    </div>
                </div>
                <div className="modal-body">
                    {(!templates || templates.length === 0) ? (
                        <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
                            <h3>No templates yet</h3>
                            <p style={{ marginBottom: '20px' }}>
                                Templates let you reuse common workflows. Start with a blank automation
                                and save it as a template later.
                            </p>
                            <button className="btn btn-primary" onClick={() => onPick(null)}>+ Blank automation</button>
                        </div>
                    ) : (
                        <div className="auto-tpl-grid">
                            {templates.map(t => {
                                const trig = Registry.byId(t.trigger);
                                return (
                                    <div key={t.id} className="auto-tpl-card" onClick={() => onPick(t)}>
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
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}