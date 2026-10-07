'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import TemplatesGrid from '@/components/TemplatesGrid';
import { TEMPLATES, templateCategories } from '@/data/templates';

export default function TemplatesPage() {
    const router = useRouter();
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    const categories = useMemo(() => templateCategories(), []);

    function useTemplate(t) {
        /* Navigate to /automations with the template id picked up via query string.
           The automations page reads ?template=ID and opens the builder pre-filled. */
        router.push(`/automations?template=${encodeURIComponent(t.id)}`);
    }

    const counts = useMemo(() => {
        const out = { all: TEMPLATES.length };
        for (const c of categories) out[c] = TEMPLATES.filter(t => t.category === c).length;
        return out;
    }, [categories]);

    return (
        <PageShell
            breadcrumb={[{ href: '/automations', label: 'Automations' }, { label: 'Templates' }]}
            searchSlot={
                <input
                    type="text" className="search-input"
                    placeholder="Search templates by name, tag, description…"
                    value={search} onChange={e => setSearch(e.target.value)}
                />
            }
            actions={
                <a href="/automations" className="btn btn-primary btn-sm">+ Blank automation</a>
            }
        >
            {/* Hero */}
            <section className="hero">
                <div className="hero-text">
                    <h1>Templates</h1>
                    <p>
                        Pre-built real-estate workflows. Click <strong>Use template</strong> to drop one
                        into the builder, edit it for your business, then publish.
                    </p>
                </div>
                <div className="hero-actions">
                    <span className="muted">{TEMPLATES.length} templates · {categories.length} categories</span>
                </div>
            </section>

            {/* Stats */}
            <section className="stats">
                <div className="stat-card">
                    <div className="label">Templates</div>
                    <div className="value tnum">{TEMPLATES.length}</div>
                    <div className="change trend-flat">ready to use</div>
                </div>
                <div className="stat-card">
                    <div className="label">Categories</div>
                    <div className="value tnum">{categories.length}</div>
                    <div className="change trend-flat">across RE workflows</div>
                </div>
                <div className="stat-card">
                    <div className="label">Providers covered</div>
                    <div className="value tnum">14+</div>
                    <div className="change trend-flat">CRM · comms · ads · AI · portals</div>
                </div>
                <div className="stat-card">
                    <div className="label">Avg steps</div>
                    <div className="value tnum">
                        {Math.round(TEMPLATES.reduce((s, t) => s + (t.nodes?.length || 0), 0) / TEMPLATES.length)}
                    </div>
                    <div className="change trend-flat">nodes per template</div>
                </div>
            </section>

            {/* Category tabs */}
            <nav className="auto-tabs" role="tablist">
                <button
                    className={`auto-tab ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => setFilter('all')}
                >
                    All
                    <span className="count">{counts.all}</span>
                </button>
                {categories.map(c => (
                    <button
                        key={c}
                        className={`auto-tab ${filter === c ? 'active' : ''}`}
                        onClick={() => setFilter(c)}
                    >
                        {c}
                        <span className="count">{counts[c] || 0}</span>
                    </button>
                ))}
            </nav>

            <TemplatesGrid
                templates={TEMPLATES}
                filter={filter}
                search={search}
                onPick={useTemplate}
                emptyCta={{ label: '+ Blank automation', onClick: () => router.push('/automations') }}
            />
        </PageShell>
    );
}
