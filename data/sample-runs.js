/* ============================================================
   sample-runs.js — realistic sample run history.

   Seeded once on first load so a fresh org sees what a run
   timeline looks like. Mix of completed + failed runs across
   the 8 built-in templates. Timestamps are relative to "now"
   so the run list always shows recent activity.
   ============================================================ */

function _ago(ms) { return new Date(Date.now() - ms).toISOString(); }

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ------- 1. 99acres welcome - completed ------- */
const r1 = {
    id: 'run-99a-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-99acres',
    automationName: '99acres Lead → WhatsApp Welcome',
    trigger: {
        type: 'source.99acres.newLead',
        payload: {
            lead: {
                id: 'ld-99231', name: 'Aarav Mehta', phone: '+919876543210',
                email: 'aarav@example.com', project: 'Lodha Belmondo',
                budget: '1.5Cr-2Cr'
            }
        }
    },
    status: 'completed',
    startedAt:  _ago(2 * HOUR),
    completedAt: _ago(2 * HOUR - 3400),
    durationMs: 3400,
    steps: [
        { nodeId: 'crm_check',  type: 'data.dedupe',        status: 'completed', startedAt: _ago(2 * HOUR),         completedAt: _ago(2 * HOUR - 800),  durationMs: 800,  output: { found: false, leadId: null } },
        { nodeId: 'branch_new', type: 'condition.if',       status: 'completed', startedAt: _ago(2 * HOUR - 800),   completedAt: _ago(2 * HOUR - 805),  durationMs: 5,    output: { matched: 'yes', rule: null } },
        { nodeId: 'wh_welcome', type: 'comm.whatsapp.sendTemplate', status: 'completed', startedAt: _ago(2 * HOUR - 805), completedAt: _ago(2 * HOUR - 2200), durationMs: 1395, output: { messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5' }], contacts: [{ input: '+919876543210', wa_id: '919876543210' }] } },
        { nodeId: 'create_lead', type: 'crm.lead.create',   status: 'completed', startedAt: _ago(2 * HOUR - 2200),  completedAt: _ago(2 * HOUR - 2900),  durationMs: 700,  output: { id: 'ld-99232', source: '99acres' } },
        { nodeId: 'assign',     type: 'crm.lead.assign',    status: 'completed', startedAt: _ago(2 * HOUR - 2900),  completedAt: _ago(2 * HOUR - 3300),  durationMs: 400,  output: { leadId: 'ld-99232', ownerId: 'sales_team' } },
        { nodeId: 'tag_hot',    type: 'crm.lead.addTag',    status: 'completed', startedAt: _ago(2 * HOUR - 3300),  completedAt: _ago(2 * HOUR - 3380),  durationMs: 80,   output: { leadId: 'ld-99232', tag: 'from-99acres' } },
        { nodeId: 'notify',     type: 'comm.notify.internal', status: 'completed', startedAt: _ago(2 * HOUR - 3380), completedAt: _ago(2 * HOUR - 3400), durationMs: 20,  output: { notified: true } }
    ]
};

/* ------- 2. AI lead scoring - completed ------- */
const r2 = {
    id: 'run-ai-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-ai-score',
    automationName: 'AI Lead Scoring + Hot Alert',
    trigger: {
        type: 'crm.lead.created',
        payload: { lead: { id: 'ld-99240', name: 'Priya Sharma', source: 'Website', budget: '2Cr', intent: 'buy', phone: '+919812345678' } }
    },
    status: 'completed',
    startedAt:  _ago(5 * HOUR),
    completedAt: _ago(5 * HOUR - 1820),
    durationMs: 1820,
    steps: [
        { nodeId: 'score',         type: 'ai.score',                status: 'completed', startedAt: _ago(5 * HOUR),       completedAt: _ago(5 * HOUR - 1200), durationMs: 1200, output: { score: 87, reasoning: 'High-budget buy intent with active engagement.' } },
        { nodeId: 'set_score',     type: 'crm.lead.changeScore',     status: 'completed', startedAt: _ago(5 * HOUR - 1200), completedAt: _ago(5 * HOUR - 1500), durationMs: 300,  output: { leadId: 'ld-99240', score: 87 } },
        { nodeId: 'branch_hot',    type: 'condition.if',            status: 'completed', startedAt: _ago(5 * HOUR - 1500), completedAt: _ago(5 * HOUR - 1505), durationMs: 5,    output: { matched: 'yes', rule: null } },
        { nodeId: 'wh_alert',      type: 'comm.whatsapp.sendTemplate', status: 'completed', startedAt: _ago(5 * HOUR - 1505), completedAt: _ago(5 * HOUR - 1800), durationMs: 295, output: { messages: [{ id: 'wamid.HBgNOTPRlYWQ' }] } },
        { nodeId: 'tag_hot',       type: 'crm.lead.addTag',          status: 'completed', startedAt: _ago(5 * HOUR - 1800), completedAt: _ago(5 * HOUR - 1815), durationMs: 15,   output: { leadId: 'ld-99240', tag: 'hot' } },
        { nodeId: 'change_status', type: 'crm.lead.changeStatus',   status: 'completed', startedAt: _ago(5 * HOUR - 1815), completedAt: _ago(5 * HOUR - 1820), durationMs: 5,    output: { leadId: 'ld-99240', status: 'qualified' } }
    ]
};

/* ------- 3. Site visit reminder - completed ------- */
const r3 = {
    id: 'run-visit-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-site-visit',
    automationName: 'Site Visit Reminder (24h Before)',
    trigger: {
        type: 'prop.siteVisit.scheduled',
        payload: {
            visit: {
                id: 'sv-3011', scheduledFor: new Date(Date.now() + 24 * HOUR).toISOString(),
                contact: { name: 'Rahul Verma', phone: '+919898989898', email: 'rahul@example.com' },
                listing: { id: 'lst-501', title: '3BHK · Lodha Bellissimo, Powai' }
            }
        }
    },
    status: 'completed',
    startedAt:  _ago(8 * HOUR),
    completedAt: _ago(8 * HOUR - 2400),
    durationMs: 2400,
    steps: [
        { nodeId: 'compute_when',  type: 'data.setVariable',              status: 'completed', startedAt: _ago(8 * HOUR),       completedAt: _ago(8 * HOUR - 5),    durationMs: 5,    output: { name: 'remindAt', value: 'tomorrow 4pm' } },
        { nodeId: 'wh_remind',     type: 'comm.whatsapp.sendTemplate',    status: 'completed', startedAt: _ago(8 * HOUR - 5),   completedAt: _ago(8 * HOUR - 1300), durationMs: 1295, output: { messages: [{ id: 'wamid.HBgUkVNSU5E' }] } },
        { nodeId: 'email_confirm', type: 'comm.email.send',               status: 'completed', startedAt: _ago(8 * HOUR - 1300), completedAt: _ago(8 * HOUR - 1900), durationMs: 600,  output: { messageId: 'sg-msg-92af31' } },
        { nodeId: 'create_task',   type: 'crm.lead.createTask',           status: 'completed', startedAt: _ago(8 * HOUR - 1900), completedAt: _ago(8 * HOUR - 2400), durationMs: 500,  output: { taskId: 'task-7191' } }
    ]
};

/* ------- 4. Post-visit sentiment (positive) - completed ------- */
const r4 = {
    id: 'run-postvis-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-post-visit',
    automationName: 'Post-Visit AI Sentiment Update',
    trigger: {
        type: 'prop.siteVisit.completed',
        payload: {
            visit: { id: 'sv-3001', contact: { name: 'Anjali Rao', leadId: 'ld-99001' } },
            feedback: { text: 'Loved the property! The 3BHK layout is perfect for our family. The amenities are world-class and the sales rep was very helpful. We are ready to make an offer.' }
        }
    },
    status: 'completed',
    startedAt:  _ago(1 * DAY),
    completedAt: _ago(1 * DAY - 1410),
    durationMs: 1410,
    steps: [
        { nodeId: 'ai_sent',     type: 'ai.sentiment',           status: 'completed', startedAt: _ago(1 * DAY),         completedAt: _ago(1 * DAY - 900),  durationMs: 900,  output: { sentiment: 'positive', confidence: 0.97 } },
        { nodeId: 'branch_pos',  type: 'condition.if',           status: 'completed', startedAt: _ago(1 * DAY - 900),   completedAt: _ago(1 * DAY - 905),  durationMs: 5,    output: { matched: 'yes' } },
        { nodeId: 'qualify',     type: 'crm.lead.changeStatus',  status: 'completed', startedAt: _ago(1 * DAY - 905),   completedAt: _ago(1 * DAY - 1410), durationMs: 505,  output: { leadId: 'ld-99001', status: 'qualified' } }
    ]
};

/* ------- 5. Inbound WhatsApp - failed (no creds) ------- */
const r5 = {
    id: 'run-wain-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-inbound-wa',
    automationName: 'Inbound WhatsApp → AI Classify → Route',
    trigger: {
        type: 'comm.whatsapp.messageReceived',
        payload: { message: { from: '+971501234567', body: 'Hi, I want to rent a 2BHK in Dubai Marina. Budget 120k/year.', timestamp: new Date().toISOString() } }
    },
    status: 'failed',
    error: 'whatsapp credentials not configured. Set automation.settings.credentials.whatsapp = { phoneNumberId, accessToken }.',
    startedAt:  _ago(1 * DAY + 4 * HOUR),
    completedAt: _ago(1 * DAY + 4 * HOUR - 1100),
    durationMs: 1100,
    steps: [
        { nodeId: 'ai_class',     type: 'ai.classify',                  status: 'completed', startedAt: _ago(1 * DAY + 4 * HOUR),         completedAt: _ago(1 * DAY + 4 * HOUR - 1100), durationMs: 1100, output: { label: 'rent', confidence: 0.94 } },
        { nodeId: 'switch_intent', type: 'condition.switch',            status: 'completed', startedAt: _ago(1 * DAY + 4 * HOUR - 1100),  completedAt: _ago(1 * DAY + 4 * HOUR - 1105), durationMs: 5,    output: { matchedCase: 'sales' } },
        { nodeId: 'assign_sales',  type: 'crm.lead.assign',             status: 'failed',    startedAt: _ago(1 * DAY + 4 * HOUR - 1105),  completedAt: _ago(1 * DAY + 4 * HOUR - 1110), durationMs: 5,    error: 'crm credentials not configured. Set automation.settings.credentials.crm = { apiBase, token }.' },
        { nodeId: 'notify_sales',  type: 'comm.notify.internal',        status: 'skipped',   startedAt: _ago(1 * DAY + 4 * HOUR - 1110),  completedAt: _ago(1 * DAY + 4 * HOUR - 1110), durationMs: 0 }
    ]
};

/* ------- 6. Google Ads monitor - completed ------- */
const r6 = {
    id: 'run-ads-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-ads-ctr',
    automationName: 'Pause Low-CTR Google Ads (Daily)',
    trigger: { type: 'schedule.cron', payload: { cron: 'every 1 day at 09:00', timezone: 'Asia/Dubai', firedAt: _ago(15 * HOUR) } },
    status: 'completed',
    startedAt:  _ago(15 * HOUR),
    completedAt: _ago(15 * HOUR - 2150),
    durationMs: 2150,
    steps: [
        { nodeId: 'compute_thr', type: 'data.setVariable',   status: 'completed', startedAt: _ago(15 * HOUR),        completedAt: _ago(15 * HOUR - 5),    durationMs: 5,    output: { name: 'ctrThreshold', value: '0.01' } },
        { nodeId: 'ai_summary',  type: 'ai.summarize',       status: 'completed', startedAt: _ago(15 * HOUR - 5),    completedAt: _ago(15 * HOUR - 1500), durationMs: 1495, output: { summary: 'Daily CTR audit complete. 3 campaigns paused: A, B, C. Average CTR was 0.8%.' } },
        { nodeId: 'email_report', type: 'comm.email.send',   status: 'completed', startedAt: _ago(15 * HOUR - 1500), completedAt: _ago(15 * HOUR - 2150), durationMs: 650,  output: { messageId: 'sg-msg-aa1102' } }
    ]
};

/* ------- 7. MagicBricks - completed ------- */
const r7 = {
    id: 'run-mb-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-magicbricks',
    automationName: 'MagicBricks Inquiry → Email Follow-up',
    trigger: {
        type: 'source.magicbricks.newLead',
        payload: { lead: { id: 'mb-7720', name: 'Vikram Singh', phone: '+919900112233', email: 'vikram@example.com', project: 'Godrej Woods' } }
    },
    status: 'completed',
    startedAt:  _ago(2 * DAY),
    completedAt: _ago(2 * DAY - 2780),
    durationMs: 2780,
    steps: [
        { nodeId: 'wh_quick',     type: 'comm.whatsapp.sendTemplate', status: 'completed', startedAt: _ago(2 * DAY),         completedAt: _ago(2 * DAY - 1300), durationMs: 1300, output: { messages: [{ id: 'wamid.HBgTU9LRVM' }] } },
        { nodeId: 'email_follow', type: 'comm.email.send',            status: 'completed', startedAt: _ago(2 * DAY - 1300), completedAt: _ago(2 * DAY - 1900), durationMs: 600,  output: { messageId: 'sg-msg-mb2098' } },
        { nodeId: 'create_lead',  type: 'crm.lead.create',            status: 'completed', startedAt: _ago(2 * DAY - 1900), completedAt: _ago(2 * DAY - 2500), durationMs: 600,  output: { id: 'ld-98812', source: 'magicbricks' } },
        { nodeId: 'assign',       type: 'crm.lead.assign',             status: 'completed', startedAt: _ago(2 * DAY - 2500), completedAt: _ago(2 * DAY - 2750), durationMs: 250,  output: { leadId: 'ld-98812', ownerId: 'sales_team' } },
        { nodeId: 'tag',          type: 'crm.lead.addTag',             status: 'completed', startedAt: _ago(2 * DAY - 2750), completedAt: _ago(2 * DAY - 2780), durationMs: 30,   output: { leadId: 'ld-98812', tag: 'from-magicbricks' } }
    ]
};

/* ------- 8. Daily sales report - completed ------- */
const r8 = {
    id: 'run-rep-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-daily-report',
    automationName: 'Daily Sales Report Email (8am)',
    trigger: { type: 'schedule.cron', payload: { cron: 'every 1 day at 08:00', timezone: 'Asia/Dubai', firedAt: _ago(22 * HOUR) } },
    status: 'completed',
    startedAt:  _ago(22 * HOUR),
    completedAt: _ago(22 * HOUR - 1710),
    durationMs: 1710,
    steps: [
        { nodeId: 'set_date',     type: 'data.setVariable',  status: 'completed', startedAt: _ago(22 * HOUR),        completedAt: _ago(22 * HOUR - 5),    durationMs: 5,    output: { name: 'yesterday', value: 'yesterday' } },
        { nodeId: 'ai_summarize', type: 'ai.summarize',      status: 'completed', startedAt: _ago(22 * HOUR - 5),    completedAt: _ago(22 * HOUR - 1100), durationMs: 1095, output: { summary: 'Yesterday: 12 new leads, 9 contacted, 4 qualified, 1 closed. Top source: 99acres.' } },
        { nodeId: 'email',        type: 'comm.email.send',   status: 'completed', startedAt: _ago(22 * HOUR - 1100), completedAt: _ago(22 * HOUR - 1710), durationMs: 610,  output: { messageId: 'sg-msg-daily-101' } }
    ]
};

/* ------- 9. AI lead scoring (older) - completed ------- */
const r9 = {
    id: 'run-ai2-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-ai-score',
    automationName: 'AI Lead Scoring + Hot Alert',
    trigger: { type: 'crm.lead.created', payload: { lead: { id: 'ld-99210', name: 'Sandeep Iyer', source: 'Facebook', budget: '90L', intent: 'rent' } } },
    status: 'completed',
    startedAt:  _ago(3 * DAY),
    completedAt: _ago(3 * DAY - 1500),
    durationMs: 1500,
    steps: [
        { nodeId: 'score',       type: 'ai.score',                status: 'completed', startedAt: _ago(3 * DAY),         completedAt: _ago(3 * DAY - 1200), durationMs: 1200, output: { score: 42, reasoning: 'Mid-budget rental lead, lower engagement.' } },
        { nodeId: 'set_score',   type: 'crm.lead.changeScore',     status: 'completed', startedAt: _ago(3 * DAY - 1200), completedAt: _ago(3 * DAY - 1450), durationMs: 250,  output: { leadId: 'ld-99210', score: 42 } },
        { nodeId: 'branch_hot',  type: 'condition.if',            status: 'completed', startedAt: _ago(3 * DAY - 1450), completedAt: _ago(3 * DAY - 1455), durationMs: 5,    output: { matched: 'no' } },
        { nodeId: 'tag_cold',    type: 'crm.lead.addTag',          status: 'completed', startedAt: _ago(3 * DAY - 1455), completedAt: _ago(3 * DAY - 1500), durationMs: 45,   output: { leadId: 'ld-99210', tag: 'nurture' } }
    ]
};

/* ------- 10. 99acres - older - completed ------- */
const r10 = {
    id: 'run-99b-' + Math.random().toString(36).slice(2, 10),
    automationId: 'auto-seed-99acres',
    automationName: '99acres Lead → WhatsApp Welcome',
    trigger: { type: 'source.99acres.newLead', payload: { lead: { id: 'ld-99301', name: 'Neha Kapoor', phone: '+918888888888', email: 'neha@example.com', project: 'Hiranandani', budget: '80L-1Cr' } } },
    status: 'completed',
    startedAt:  _ago(4 * DAY),
    completedAt: _ago(4 * DAY - 3100),
    durationMs: 3100,
    steps: [
        { nodeId: 'crm_check',  type: 'data.dedupe',               status: 'completed', startedAt: _ago(4 * DAY),         completedAt: _ago(4 * DAY - 700),   durationMs: 700, output: { found: true, leadId: 'ld-99300' } },
        { nodeId: 'branch_new', type: 'condition.if',              status: 'completed', startedAt: _ago(4 * DAY - 700),   completedAt: _ago(4 * DAY - 705),   durationMs: 5,   output: { matched: 'no' } },
        { nodeId: 'tag_hot',    type: 'crm.lead.addTag',           status: 'completed', startedAt: _ago(4 * DAY - 705),   completedAt: _ago(4 * DAY - 3100),  durationMs: 2395, output: { leadId: 'ld-99300', tag: 're-engaged-from-99acres' } }
    ]
};

export const SAMPLE_RUNS = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10];
