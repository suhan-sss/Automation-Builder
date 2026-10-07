'use client';

import { usePathname } from 'next/navigation';

const NAV = [
    { section: 'Workspace' },
    { label: 'Automations', href: '/automations', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
    ) },
    { label: 'Runs',       href: '/runs',       icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
    ) },
    { label: 'Templates',  href: '/templates',  icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
    ) }
];

export default function Sidebar() {
    const pathname = usePathname();
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="logo-icon" />
                    <div>Connect360</div>
                </div>
            </div>
            <nav className="sidebar-nav" aria-label="Primary">
                {NAV.map((item, idx) => {
                    if (item.section) {
                        return <div key={'s-' + idx} className="nav-section-title">{item.section}</div>;
                    }
                    const active = pathname === item.href || (item.href === '/automations' && pathname === '/');
                    return (
                        <a key={item.label} href={item.href} className={`nav-item${active ? ' active' : ''}`}>
                            <svg className="nav-icon" viewBox="0 0 24 24">{item.icon}</svg>
                            <span>{item.label}</span>
                        </a>
                    );
                })}
            </nav>
            <div className="sidebar-footer">
                <div className="muted" style={{ fontSize: 12 }}>Real adapters · localStorage</div>
            </div>
        </aside>
    );
}