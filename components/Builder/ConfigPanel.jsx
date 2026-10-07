'use client';

import { useState } from 'react';
import { Registry } from '@/lib/registry';
import { testNode } from '@/lib/engine';
import VariablePicker from '../VariablePicker';

export default function ConfigPanel({ node, ctx, onChange, onClose }) {
    const [picker, setPicker] = useState(null); // { fieldKey, anchorRect }
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);

    if (!node) {
        return (
            <aside className="auto-config">
                <div className="auto-config-empty">
                    Select a step to configure it.
                    <br /><br />
                    <div className="muted">Use the left rail to add triggers and actions. Click any node to edit its settings.</div>
                </div>
            </aside>
        );
    }

    const reg = Registry.byId(node.type);
    if (!reg) return <aside className="auto-config"><div className="auto-config-empty">Unknown node type: {node.type}</div></aside>;

    function updateField(key, value) {
        const nextConfig = { ...(node.config || {}), [key]: value };
        onChange({ ...node, config: nextConfig });
    }

    function appendVar(fieldKey, anchor) {
        const rect = anchor ? anchor.getBoundingClientRect() : null;
        setPicker({ fieldKey, anchorRect: rect });
    }
    function insertVar(fieldKey, snippet) {
        const current = node.config?.[fieldKey] || '';
        updateField(fieldKey, current + snippet);
        setPicker(null);
    }

    async function runTest() {
        setTesting(true);
        setTestResult(null);
        try {
            const r = await testNode(node, ctx);
            setTestResult(r);
        } catch (e) {
            setTestResult({ ok: false, error: String(e.message || e) });
        }
        setTesting(false);
    }

    return (
        <aside className="auto-config">
            <div className="row between" style={{ marginBottom: 4 }}>
                <h3>{reg.icon} {reg.label}</h3>
                <button className="btn-icon btn-ghost btn" onClick={onClose} aria-label="Deselect">✕</button>
            </div>
            <div className="sub">{reg.description}</div>

            {reg.id === '__trigger__' && (
                <div className="muted" style={{ fontSize: 12, padding: 12, background: 'var(--accent-fade)', borderRadius: 6 }}>
                    Trigger settings live in the Workflow header — choose what fires this automation.
                </div>
            )}

            {(reg.inputs || []).map(field => (
                <FieldRow
                    key={field.key}
                    field={field}
                    value={node.config?.[field.key]}
                    onChange={v => updateField(field.key, v)}
                    onPickVar={(v) => insertVar(field.key, v)}
                    onShowPicker={(anchor) => appendVar(field.key, anchor)}
                    pickerOpen={picker?.fieldKey === field.key}
                    pickerClose={() => setPicker(null)}
                    pickerCtx={ctx}
                />
            ))}

            {(reg.inputs || []).length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>No settings required.</div>
            )}

            {reg.supportsTest && (
                <div style={{ marginTop: 16 }}>
                    <button className="btn btn-secondary btn-sm" onClick={runTest} disabled={testing}>
                        {testing ? 'Testing…' : '▶ Test this step'}
                    </button>
                    {testResult && (
                        <div className={`test-result ${testResult.ok ? 'ok' : 'err'}`}>
                            {testResult.ok ? '✓ ' + JSON.stringify(testResult.output, null, 2) : '✕ ' + testResult.error}
                        </div>
                    )}
                </div>
            )}

            {!reg.supportsTest && (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 12, padding: 8, background: '#fef3c7', borderRadius: 6, color: '#92400e' }}>
                    This node does not support isolated testing — it'll execute when the workflow runs.
                </div>
            )}
        </aside>
    );
}

function FieldRow({ field, value, onChange, onShowPicker, pickerOpen, pickerClose, pickerCtx, onPickVar }) {
    function renderInput() {
        if (field.options && Array.isArray(field.options)) {
            return (
                <select value={value ?? field.default ?? ''} onChange={e => onChange(e.target.value)}>
                    {!field.required && <option value="">— none —</option>}
                    {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            );
        }
        if (field.type === 'number') {
            return <input type="number" value={value ?? field.default ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
        }
        if (field.type === 'array' || field.type === 'object') {
            return (
                <textarea
                    rows={4}
                    placeholder={field.type === 'object' ? '{ "key": "value" }' : '["a","b","c"]'}
                    value={typeof value === 'string' ? value : (value ? JSON.stringify(value, null, 2) : '')}
                    onChange={e => onChange(e.target.value)}
                />
            );
        }
        if (field.type === 'boolean') {
            return (
                <select value={String(value ?? false)} onChange={e => onChange(e.target.value === 'true')}>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                </select>
            );
        }
        /* default: string */
        const isMultiline = field.key === 'body' || field.key === 'prompt' || field.key === 'script' || field.key === 'code';
        return isMultiline ? (
            <textarea rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.default || ''} />
        ) : (
            <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.default || ''} />
        );
    }

    const supportsVar = field.type === 'string' || (!field.options);

    return (
        <div className="field">
            <label>{field.label}{field.required ? ' *' : ''}</label>
            {supportsVar ? (
                <div className="var-input-wrap">
                    {renderInput()}
                    <button type="button" className="var-toggle" onClick={(e) => onShowPicker(e.currentTarget)}>
                        {'{•}'}
                    </button>
                    {pickerOpen && (
                        <VariablePicker
                            ctx={pickerCtx}
                            onInsert={onPickVar}
                            onClose={pickerClose}
                        />
                    )}
                </div>
            ) : renderInput()}
            {field.hint && <div className="field-hint">{field.hint}</div>}
        </div>
    );
}