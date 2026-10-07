'use client';

import { Registry } from '@/lib/registry';
import { escapeHtml } from '@/lib/ids';

export default function NodeCard({ node, selected, onSelect, onRemove }) {
    const reg = Registry.byId(node.type);
    if (!reg) return null;

    const isTrigger = node.id === '__trigger__' || reg.category === 'trigger';
    const classes = [
        'auto-node',
        reg.category === 'trigger'    ? 'trigger'    : '',
        reg.category === 'condition'  ? 'condition'  : '',
        reg.category === 'ai'         ? 'ai'         : '',
        reg.category === 'utility' && reg.id === 'utility.delay' ? 'utility delay' : '',
        selected ? 'selected' : ''
    ].filter(Boolean).join(' ');

    /* Build a one-line summary of the node's main config input. */
    const summary = summarize(node, reg);

    return (
        <div className={classes} onClick={() => onSelect(node.id)}>
            <div className="auto-node-head">
                <span className="ico" style={{ background: reg.color + '22', color: reg.color }}>{reg.icon}</span>
                <div className="body">
                    <div className="label">{reg.label}</div>
                    <div className="sub">{reg.description}</div>
                </div>
                {!isTrigger && (
                    <div className="actions">
                        <button
                            className="btn-icon btn btn-ghost btn-sm"
                            onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}
                            title="Remove step"
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>
            {summary && <div className="auto-node-body" dangerouslySetInnerHTML={{ __html: summary }} />}
            {reg.category === 'condition' && reg.id === 'condition.if' && (
                <div className="auto-node-branch">
                    <span className="pill yes">YES → next</span>
                    <span className="pill no">NO → branch</span>
                </div>
            )}
            {reg.category === 'condition' && reg.id === 'condition.switch' && (
                <div className="auto-node-branch">
                    <span className="pill">Switch on value</span>
                </div>
            )}
        </div>
    );
}

function summarize(node, reg) {
    const c = node.config || {};
    const mainInput = (reg.inputs || [])[0];
    if (!mainInput) return null;
    const v = c[mainInput.key];
    if (!v) return null;
    const safe = escapeHtml(String(v).slice(0, 80));
    return `<code>${mainInput.label}:</code> ${safe}`;
}