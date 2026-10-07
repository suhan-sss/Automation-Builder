'use client';

import { useEffect, useState } from 'react';
import { Registry } from '@/lib/registry';
import { genId } from '@/lib/ids';
import NodeLibrary from './NodeLibrary';
import NodeCard from './NodeCard';
import ConfigPanel from './ConfigPanel';
import { interpolate } from '@/lib/variables';

/**
 * The BuilderModal orchestrates:
 *   - left rail (NodeLibrary) for inserting nodes
 *   - center canvas (the workflow flow: trigger + nodes + arrows + end)
 *   - right pane (ConfigPanel) for editing the selected node's inputs
 *
 * Props:
 *   - automation : { trigger, nodes, edges, settings, ... }
 *   - onChange   : (next) => void  — full automation mutation
 *   - onClose    : () => void
 *   - onSave     : (next) => void  — used by Save Draft / Publish
 */
export default function BuilderModal({ automation, onChange, onClose, onSave }) {
    const [selectedId, setSelectedId] = useState(automation.trigger?.id || '__trigger__');

    /* Build a context object for variable interpolation / picker. */
    const ctx = buildCtx(automation);

    function updateNode(nodeId, nextNode) {
        if (nodeId === '__trigger__' || nodeId === automation.trigger?.id) {
            onChange({ ...automation, trigger: { ...automation.trigger, ...nextNode } });
        } else {
            onChange({
                ...automation,
                nodes: automation.nodes.map(n => n.id === nodeId ? nextNode : n)
            });
        }
    }
    function updateTriggerConfig(key, value) {
        onChange({
            ...automation,
            trigger: {
                ...automation.trigger,
                config: { ...(automation.trigger?.config || {}), [key]: value }
            }
        });
    }

    function addNode(typeId) {
        const reg = Registry.byId(typeId);
        if (!reg) return;
        const id = genId('node');
        const newNode = { id, type: typeId, config: {}, position: {} };
        const triggerId = automation.trigger?.id || '__trigger__';
        const lastNodeId = automation.nodes?.[automation.nodes.length - 1]?.id;

        let edges = [...(automation.edges || [])];
        /* Detach the last outgoing edge from the trigger or the previous node,
           so it now points to the new node. */
        const oldLastEdge = edges.find(e => e.from === (lastNodeId || triggerId) && e.branch === 'default');
        if (oldLastEdge) {
            edges = edges.filter(e => e !== oldLastEdge);
            edges.push({ from: (lastNodeId || triggerId), to: id, branch: 'default' });
        } else if (!edges.some(e => e.from === triggerId)) {
            edges.push({ from: triggerId, to: id, branch: 'default' });
        }
        /* For an if/else condition, default to wiring yes→next, no→also next (simplified). */
        edges.push({ from: id, to: genId('placeholder'), branch: 'default' });

        onChange({
            ...automation,
            nodes: [...(automation.nodes || []), newNode],
            edges
        });
        setSelectedId(id);
    }

    function removeNode(nodeId) {
        if (nodeId === '__trigger__' || nodeId === automation.trigger?.id) return;
        const nodes = automation.nodes.filter(n => n.id !== nodeId);
        /* Repair edges: any edge that pointed to nodeId now points to wherever it pointed */
        const removed = automation.edges.find(e => e.to === nodeId);
        const fromOfRemoved = automation.nodes.find(n => n.id === nodeId);
        const precedingEdge = automation.edges.find(e => e.to === nodeId);
        const sourceOfRemoved = precedingEdge ? precedingEdge.from : null;
        const outgoingFromRemoved = automation.edges.filter(e => e.from === nodeId);

        let edges = automation.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        if (sourceOfRemoved) {
            for (const oe of outgoingFromRemoved) {
                edges.push({ from: sourceOfRemoved, to: oe.to, branch: oe.branch });
            }
        }
        onChange({ ...automation, nodes, edges });
        if (selectedId === nodeId) setSelectedId(automation.trigger?.id || '__trigger__');
    }

    function selectNode(nodeId) {
        setSelectedId(nodeId);
    }

    function changeName(name) {
        onChange({ ...automation, name });
    }

    /* Resolve selected node for the config panel. */
    let selectedNode = null;
    if (selectedId === '__trigger__' || selectedId === automation.trigger?.id) {
        const reg = Registry.byId(automation.trigger?.type);
        if (reg) {
            selectedNode = {
                id: automation.trigger?.id || '__trigger__',
                type: automation.trigger?.type,
                config: automation.trigger?.config || {},
                _isTrigger: true
            };
        }
    } else {
        selectedNode = automation.nodes.find(n => n.id === selectedId);
    }

    function updateSelectedNode(nextNode) {
        if (!selectedNode) return;
        if (selectedNode._isTrigger) {
            onChange({
                ...automation,
                trigger: { ...automation.trigger, config: nextNode.config }
            });
        } else {
            updateNode(selectedNode.id, nextNode);
        }
    }

    const triggerReg = Registry.byId(automation.trigger?.type);

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-card modal-card-xl">
                <div className="modal-head">
                    <input
                        type="text"
                        value={automation.name || ''}
                        onChange={e => changeName(e.target.value)}
                        style={{ fontSize: 16, fontWeight: 700, padding: '4px 8px', border: 'none', background: 'transparent' }}
                    />
                    <span className={`chip chip-status-${automation.status || 'draft'}`}>{automation.status || 'draft'}</span>
                    <div className="modal-head-right">
                        <button className="btn btn-secondary btn-sm" onClick={() => onSave({ ...automation, status: 'draft' })}>Save Draft</button>
                        <button className="btn btn-primary btn-sm" onClick={() => onSave({ ...automation, status: 'published', version: (automation.version || 0) + 1 })}>Publish</button>
                        <button className="btn-icon btn-ghost btn" onClick={onClose} aria-label="Close">✕</button>
                    </div>
                </div>
                <div className="modal-body" style={{ padding: 0 }}>
                    <div className="auto-builder">
                        <NodeLibrary onPick={addNode} />
                        <Canvas
                            automation={automation}
                            selectedId={selectedId}
                            onSelect={selectNode}
                            onRemove={removeNode}
                            onPickNew={addNode}
                        />
                        <ConfigPanel
                            node={selectedNode}
                            ctx={ctx}
                            onChange={updateSelectedNode}
                            onClose={() => setSelectedId(null)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function Canvas({ automation, selectedId, onSelect, onRemove, onPickNew }) {
    const triggerId = automation.trigger?.id || '__trigger__';
    const triggerReg = Registry.byId(automation.trigger?.type);
    const triggerNodeCard = (
        <NodeCard
            key="trigger"
            node={{
                id: triggerId,
                type: automation.trigger?.type,
                config: automation.trigger?.config || {}
            }}
            selected={selectedId === triggerId}
            onSelect={() => onSelect(triggerId)}
            onRemove={() => {}}
        />
    );

    return (
        <div className="auto-canvas">
            {!triggerReg && (
                <div className="auto-canvas-empty">
                    <div className="ico">⚡</div>
                    <h3 style={{ margin: '8px 0' }}>Choose a trigger to start</h3>
                    <div>Pick a trigger from the left rail — for example "New Lead" or "Run manually".</div>
                </div>
            )}
            {triggerReg && (
                <div className="auto-flow">
                    {triggerNodeCard}
                    <Arrow />
                    <AddNode onPick={onPickNew} />
                    {(automation.nodes || []).map((node, idx) => (
                        <FlowBranch
                            key={node.id}
                            node={node}
                            selected={selectedId === node.id}
                            onSelect={() => onSelect(node.id)}
                            onRemove={() => onRemove(node.id)}
                            onPickNew={onPickNew}
                            isLast={idx === automation.nodes.length - 1}
                        />
                    ))}
                    <div className="auto-end">END</div>
                </div>
            )}
        </div>
    );
}

function FlowBranch({ node, selected, onSelect, onRemove, onPickNew, isLast }) {
    return (
        <>
            <NodeCard node={node} selected={selected} onSelect={onSelect} onRemove={onRemove} />
            <Arrow />
            <AddNode onPick={onPickNew} />
        </>
    );
}

function Arrow() {
    return <div className="auto-arrow" />;
}

function AddNode({ onPick }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button className="auto-add-node" onClick={() => setOpen(!open)}>
                {open ? '▾ Click a node to insert it' : '+ Add step'}
            </button>
            {open && (
                <div style={{ width: '100%', maxWidth: 520, padding: 12, background: 'var(--bg-page)', borderRadius: 8, margin: '4px 0' }}>
                    <NodeLibrary onPick={(id) => { onPick(id); setOpen(false); }} />
                </div>
            )}
        </>
    );
}

function buildCtx(automation) {
    return {
        trigger: automation.trigger?.config || {},
        steps:   Object.fromEntries((automation.nodes || []).map(n => [n.id, n.config || {}])),
        vars:    {}
    };
}