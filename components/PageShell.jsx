'use client';

import Sidebar from './Sidebar';

/**
 * Shared layout shell used by every top-level page.
 * Renders the sidebar + a top bar (breadcrumb, search, primary actions)
 * + the page body. Keeps the three pages consistent.
 */
export default function PageShell({ breadcrumb, searchSlot, actions, children }) {
    return (
        <div className="app-shell">
            <Sidebar />
            <main className="main">
                <header className="top-bar">
                    <div className="breadcrumb">
                        {breadcrumb.map((b, i) => (
                            <span key={i}>
                                {b.href ? <a href={b.href}>{b.label}</a> : <span className="current">{b.label}</span>}
                                {i < breadcrumb.length - 1 && <span className="sep">/</span>}
                            </span>
                        ))}
                    </div>
                    {searchSlot && <div className="top-bar-center">{searchSlot}</div>}
                    {actions && <div className="top-bar-right">{actions}</div>}
                </header>
                <div className="page">{children}</div>
            </main>
        </div>
    );
}
