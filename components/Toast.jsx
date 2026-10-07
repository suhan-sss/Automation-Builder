'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ToastCtx = createContext({ push: () => {} });

export function useToast() {
    return useContext(ToastCtx);
}

export default function ToastProvider({ children }) {
    const [items, setItems] = useState([]);

    const push = useCallback((message, type = 'info', timeoutMs = 2600) => {
        const id = 'toast-' + Math.random().toString(36).slice(2, 8);
        setItems(prev => [...prev, { id, message, type }]);
        setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), timeoutMs);
    }, []);

    /* Expose to window so non-React modules (lib/engine.js stubs) can call it.
       This matches the pattern in Connect360's main.js — a single global hook. */
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.__autoToast = push;
        }
    }, [push]);

    return (
        <ToastCtx.Provider value={{ push }}>
            {children}
            <div className="toast-stack" aria-live="polite">
                {items.map(t => (
                    <div key={t.id} className={`toast ${t.type}`} role="status">
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastCtx.Provider>
    );
}