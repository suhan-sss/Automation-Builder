'use client';

import { useState } from 'react';
import { Registry } from '@/lib/registry';

const SAMPLE = {
    'crm.lead.created':         { lead: { id: 'l-test', name: 'Sara Khan', phone: '+971501234567', email: 'sara@example.com', source: 'web', budget: 800000 } },
    'source.99acres.newLead':    { lead: { id: '99acres-test', name: 'Rohit Verma', phone: '+919812345678', email: 'r@example.com', source: '99acres' } },
    'source.facebookLead.newLead': { lead: { id: 'fb-test', name: 'Aisha Mahmoud', phone: '+971555555555', email: 'a@example.com', source: 'facebook' } },
    'prop.inquiry.created':      { inquiry: { id: 'in-test', property: 'lst-1', name: 'Omar Ali' } },
    'schedule.cron':             { firedAt: new Date().toISOString() },
    'webhook.received':          { payload: { event: 'test', id: 1 }, headers: {} },
    'comm.whatsapp.messageReceived': { message: { from: '+971500000000', body: 'Hi, is this still available?' } },
    'manual.run':                { triggeredAt: new Date().toISOString(), source: 'test-panel' }
};

export default function TestModal({ automation, onClose, onRun }) {
    const trigger = Registry.byId(automation.trigger?.type);
    const [payloadText, setPayloadText] = useState(() => {
        const sample = SAMPLE[automation.trigger?.type] || { hello: 'world' };
        return JSON.stringify(sample, null, 2);
    });

    function run() {
        let payload;
        try {
            payload = JSON.parse(payloadText || '{}');
        } catch (e) {
            return alert('Invalid JSON in payload: ' + e.message);
        }
        onRun(automation, payload);
    }

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-card modal-card-md">
                <div className="modal-head">
                    <div style={{ fontSize: 22 }}>{trigger?.icon || '▶'}</div>
                    <div>
                        <h2>Test run — {automation.name}</h2>
                        <div className="sub">Fires the workflow against a sample trigger payload.</div>
                    </div>
                    <div className="modal-head-right">
                        <button className="btn-icon btn-ghost btn" onClick={onClose}>✕</button>
                    </div>
                </div>
                <div className="modal-body">
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                        Trigger payload (JSON)
                    </label>
                    <textarea
                        className="auto-payload-editor"
                        value={payloadText}
                        onChange={e => setPayloadText(e.target.value)}
                    />
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                        Edit the JSON above to test with custom data. The shape should match the trigger's output schema.
                    </div>
                </div>
                <div className="modal-foot">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={run}>▶ Run workflow</button>
                </div>
            </div>
        </div>
    );
}