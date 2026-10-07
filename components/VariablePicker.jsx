'use client';

import { useEffect, useRef, useState } from 'react';
import { pickerTree } from '@/lib/variables';

export default function VariablePicker({ ctx, onInsert, anchorRect, onClose }) {
    const ref = useRef(null);
    const tree = pickerTree(ctx || {});

    useEffect(() => {
        function onDoc(e) {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        }
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [onClose]);

    const style = anchorRect
        ? { top: anchorRect.bottom + window.scrollY, left: anchorRect.left + window.scrollX }
        : { top: 80, left: 200 };

    return (
        <div ref={ref} className="auto-vpicker" style={style}>
            {tree.length === 0 && <div className="group">No variables available yet — add a Trigger first.</div>}
            {tree.map(group => (
                <div key={group.key}>
                    <div className="group">{group.label}</div>
                    {group.children.map(c => (
                        <PickerItem key={c.key} item={c} onInsert={onInsert} />
                    ))}
                </div>
            ))}
        </div>
    );
}

function PickerItem({ item, onInsert, depth = 0 }) {
    const [open, setOpen] = useState(false);
    return (
        <>
                <div className="item" style={depth ? { paddingLeft: 8 + depth * 12 } : undefined}>
                    <span onClick={() => onInsert('{{' + item.key + '}}')}>{item.label}</span>
                    {item.children && item.children.length > 0 && (
                        <span className="type" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>{open ? '▾' : '▸'}</span>
                    )}
                    {!item.children && <span className="type">{item.type}</span>}
                </div>
                {open && item.children && item.children.map(c => (
                    <PickerItem key={c.key} item={c} onInsert={onInsert} depth={depth + 1} />
                ))}
            </>
    );
}