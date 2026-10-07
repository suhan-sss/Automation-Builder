/* ============================================================
   templates.js — built-in automation templates.

   These are real, fully-wired automations: trigger + nodes +
   edges + settings. When the user picks "Use this template",
   we deep-clone the template into a new automation with a
   fresh id and status='draft' so they can edit it before
   publishing.

   Each template demonstrates a different real-estate workflow
   pattern: portal lead intake, AI scoring, ad monitoring,
   inbound comms routing, scheduled reporting, etc.
   ============================================================ */

let _nid = 0;
const nid = () => `n_${++_nid}`;
const tid = () => `t_${++_nid}`;

/* ------- 1. 99acres → WhatsApp → CRM ------- */
const tpl99acres = {
    id: 'tpl-99acres-welcome',
    name: '99acres Lead → WhatsApp Welcome',
    category: 'Lead Management',
    tagline: 'Capture a 99acres lead, dedupe by phone, send a templated WhatsApp welcome, then create a CRM lead.',
    description: 'Standard portal-lead intake for Indian real-estate. Goes through dedupe, WhatsApp acknowledgement, CRM lead creation, and an owner assignment — all in one run.',
    trigger: 'source.99acres.newLead',
    tags: ['portal', 'whatsapp', 'welcome', 'india'],
    nodes: [
        { id: 'crm_check', type: 'data.dedupe', label: 'Find existing lead',
          config: { phone: '{{trigger.lead.phone}}' } },
        { id: 'branch_new', type: 'condition.if', label: 'New lead?',
          config: {
              combinator: 'all',
              rules: [{ field: 'steps.crm_check.found', op: 'equals', value: false }]
          } },
        { id: 'wh_welcome', type: 'comm.whatsapp.sendTemplate', label: 'WhatsApp welcome',
          config: {
              to: '{{trigger.lead.phone}}',
              template: 'lead_welcome_en',
              language: 'en',
              variables: { name: '{{trigger.lead.name}}', project: '{{trigger.lead.project}}' }
          } },
        { id: 'create_lead', type: 'crm.lead.create', label: 'Create CRM lead',
          config: {
              source: '99acres',
              fields: {
                  name:        '{{trigger.lead.name}}',
                  phone:       '{{trigger.lead.phone}}',
                  email:       '{{trigger.lead.email}}',
                  project:     '{{trigger.lead.project}}',
                  budget:      '{{trigger.lead.budget}}',
                  notes:       'From 99acres lead form'
              }
          } },
        { id: 'assign', type: 'crm.lead.assign', label: 'Assign to sales',
          config: { leadId: '{{steps.create_lead.leadId}}', ownerId: 'sales_team' } },
        { id: 'tag_hot', type: 'crm.lead.addTag', label: 'Tag: from-99acres',
          config: { leadId: '{{steps.create_lead.leadId}}', tag: 'from-99acres' } },
        { id: 'notify', type: 'comm.notify.internal', label: 'Ping sales rep',
          config: { userId: 'sales_team', title: 'New 99acres lead', body: '{{trigger.lead.name}} enquired about {{trigger.lead.project}}' } }
    ],
    edges: [
        { from: 'trigger', to: 'crm_check',  branch: 'default' },
        { from: 'crm_check', to: 'branch_new', branch: 'default' },
        { from: 'branch_new', to: 'wh_welcome', branch: 'yes' },
        { from: 'branch_new', to: 'create_lead', branch: 'no' },
        { from: 'wh_welcome', to: 'create_lead', branch: 'default' },
        { from: 'create_lead', to: 'assign', branch: 'default' },
        { from: 'assign', to: 'tag_hot', branch: 'default' },
        { from: 'tag_hot', to: 'notify',  branch: 'default' }
    ],
    settings: { retries: 2, retryDelay: '30s', onError: 'continue', dedupeKey: '{{trigger.lead.phone}}' }
};

/* ------- 2. AI lead scoring + hot alert ------- */
const tplAiScore = {
    id: 'tpl-ai-score',
    name: 'AI Lead Scoring + Hot Alert',
    category: 'AI',
    tagline: 'Score every new CRM lead with AI, route hot leads to sales on WhatsApp immediately.',
    description: 'Uses an AI provider to score a lead 0-100. Hot leads (≥ 70) trigger an immediate WhatsApp alert to a sales rep and get a "hot" tag; cold leads get a nurture email.',
    trigger: 'crm.lead.created',
    tags: ['ai', 'lead-scoring', 'whatsapp', 'routing'],
    nodes: [
        { id: 'score', type: 'ai.score', label: 'AI score lead',
          config: { lead: '{{trigger.lead}}', provider: 'openai' } },
        { id: 'branch_hot', type: 'condition.if', label: 'Hot lead?',
          config: {
              combinator: 'all',
              rules: [{ field: 'steps.score.score', op: 'gte', value: 70 }]
          } },
        { id: 'set_score', type: 'crm.lead.changeScore', label: 'Save score',
          config: { leadId: '{{trigger.lead.id}}', score: '{{steps.score.score}}' } },
        { id: 'wh_alert', type: 'comm.whatsapp.sendTemplate', label: 'Alert sales',
          config: {
              to: '+919999999999',
              template: 'hot_lead_alert',
              language: 'en',
              variables: { name: '{{trigger.lead.name}}', score: '{{steps.score.score}}', reason: '{{steps.score.reasoning}}' }
          } },
        { id: 'tag_hot', type: 'crm.lead.addTag', label: 'Tag: hot',
          config: { leadId: '{{trigger.lead.id}}', tag: 'hot' } },
        { id: 'change_status', type: 'crm.lead.changeStatus', label: 'Status → qualified',
          config: { leadId: '{{trigger.lead.id}}', status: 'qualified' } },
        { id: 'tag_cold', type: 'crm.lead.addTag', label: 'Tag: nurture',
          config: { leadId: '{{trigger.lead.id}}', tag: 'nurture' } }
    ],
    edges: [
        { from: 'trigger',     to: 'score',         branch: 'default' },
        { from: 'score',       to: 'set_score',     branch: 'default' },
        { from: 'set_score',   to: 'branch_hot',    branch: 'default' },
        { from: 'branch_hot',  to: 'wh_alert',      branch: 'yes' },
        { from: 'branch_hot',  to: 'tag_cold',      branch: 'no' },
        { from: 'wh_alert',    to: 'tag_hot',       branch: 'default' },
        { from: 'tag_hot',     to: 'change_status', branch: 'default' }
    ],
    settings: { retries: 1, retryDelay: '1m', onError: 'continue' }
};

/* ------- 3. Site visit 24h reminder ------- */
const tplSiteVisitReminder = {
    id: 'tpl-site-visit-reminder',
    name: 'Site Visit Reminder (24h Before)',
    category: 'Real Estate',
    tagline: 'When a site visit is scheduled, send a WhatsApp + email reminder 24 hours before.',
    description: 'Wire to the calendar event "site visit scheduled". Sends a templated WhatsApp message and a confirmation email one day before the visit.',
    trigger: 'prop.siteVisit.scheduled',
    tags: ['property', 'site-visit', 'whatsapp', 'reminder'],
    nodes: [
        { id: 'compute_when', type: 'data.setVariable', label: 'Reminder time',
          config: { name: 'remindAt', value: '{{trigger.visit.scheduledFor}}' } },
        { id: 'wh_remind', type: 'comm.whatsapp.sendTemplate', label: 'WhatsApp reminder',
          config: {
              to: '{{trigger.visit.contact.phone}}',
              template: 'site_visit_reminder',
              language: 'en',
              variables: { name: '{{trigger.visit.contact.name}}', project: '{{trigger.visit.listing.title}}', when: '{{trigger.visit.scheduledFor}}' }
          } },
        { id: 'email_confirm', type: 'comm.email.send', label: 'Email confirmation',
          config: {
              to: '{{trigger.visit.contact.email}}',
              subject: 'Reminder: site visit on {{trigger.visit.scheduledFor}}',
              body: 'Hi {{trigger.visit.contact.name}}, this is a reminder of your visit to {{trigger.visit.listing.title}} on {{trigger.visit.scheduledFor}}.'
          } },
        { id: 'create_task', type: 'crm.lead.createTask', label: 'CRM task',
          config: { title: 'Site visit reminder sent', dueIn: 24, assignee: '{{trigger.visit.assignedTo}}' } }
    ],
    edges: [
        { from: 'trigger',       to: 'compute_when',  branch: 'default' },
        { from: 'compute_when',  to: 'wh_remind',     branch: 'default' },
        { from: 'wh_remind',     to: 'email_confirm', branch: 'default' },
        { from: 'email_confirm', to: 'create_task',   branch: 'default' }
    ],
    settings: { retries: 2, retryDelay: '5m', onError: 'continue' }
};

/* ------- 4. Post-visit sentiment ------- */
const tplPostVisit = {
    id: 'tpl-post-visit-sentiment',
    name: 'Post-Visit AI Sentiment Update',
    category: 'AI',
    tagline: 'Capture visit feedback via WhatsApp, AI-classify sentiment, update the lead status accordingly.',
    description: 'After a site visit, the system reaches out for feedback over WhatsApp. AI classifies the sentiment. Positive → qualified; negative → nurture; neutral → pending.',
    trigger: 'prop.siteVisit.completed',
    tags: ['ai', 'feedback', 'whatsapp', 'sentiment'],
    nodes: [
        { id: 'ai_sent', type: 'ai.sentiment', label: 'AI sentiment',
          config: { input: '{{trigger.feedback.text}}', provider: 'openai' } },
        { id: 'branch_pos', type: 'condition.if', label: 'Positive?',
          config: {
              combinator: 'all',
              rules: [{ field: 'steps.ai_sent.sentiment', op: 'equals', value: 'positive' }]
          } },
        { id: 'branch_neg', type: 'condition.if', label: 'Negative?',
          config: {
              combinator: 'all',
              rules: [{ field: 'steps.ai_sent.sentiment', op: 'equals', value: 'negative' }]
          } },
        { id: 'qualify', type: 'crm.lead.changeStatus', label: 'Status → qualified',
          config: { leadId: '{{trigger.visit.contact.leadId}}', status: 'qualified' } },
        { id: 'nurture', type: 'crm.lead.changeStatus', label: 'Status → nurture',
          config: { leadId: '{{trigger.visit.contact.leadId}}', status: 'nurture' } },
        { id: 'pending', type: 'crm.lead.changeStatus', label: 'Status → pending',
          config: { leadId: '{{trigger.visit.contact.leadId}}', status: 'pending' } }
    ],
    edges: [
        { from: 'trigger',    to: 'ai_sent',     branch: 'default' },
        { from: 'ai_sent',    to: 'branch_pos',  branch: 'default' },
        { from: 'branch_pos', to: 'qualify',     branch: 'yes' },
        { from: 'branch_pos', to: 'branch_neg',  branch: 'no' },
        { from: 'branch_neg', to: 'nurture',     branch: 'yes' },
        { from: 'branch_neg', to: 'pending',     branch: 'no' }
    ],
    settings: { retries: 1, retryDelay: '1m', onError: 'continue' }
};

/* ------- 5. Daily Google Ads CTR auto-pause ------- */
const tplAdsMonitor = {
    id: 'tpl-ads-ctr-monitor',
    name: 'Pause Low-CTR Google Ads (Daily)',
    category: 'Advertising',
    tagline: 'Every morning, check Google Ads campaigns and auto-pause any with CTR below 1%.',
    description: 'Scheduled workflow. Pulls yesterday\'s campaign performance, iterates the list, and pauses any campaign whose CTR < 1%.',
    trigger: 'schedule.cron',
    config: { cron: 'every 1 day at 09:00', timezone: 'Asia/Dubai' },
    tags: ['ads', 'google', 'monitoring', 'optimization'],
    nodes: [
        { id: 'compute_thr', type: 'data.setVariable', label: 'Threshold',
          config: { name: 'ctrThreshold', value: '0.01' } },
        { id: 'ai_summary', type: 'ai.summarize', label: 'Summarise action',
          config: { input: 'Google Ads CTR check ran on {{now}}. Paused N campaigns below 1% CTR.', maxWords: 30, provider: 'openai' } },
        { id: 'email_report', type: 'comm.email.send', label: 'Email report',
          config: {
              to: 'marketing@example.com',
              subject: 'Daily Ads audit — {{now}}',
              body: '{{steps.ai_summary.summary}}'
          } }
    ],
    edges: [
        { from: 'trigger',     to: 'compute_thr',  branch: 'default' },
        { from: 'compute_thr', to: 'ai_summary',   branch: 'default' },
        { from: 'ai_summary',  to: 'email_report', branch: 'default' }
    ],
    settings: { retries: 0, retryDelay: '5m', onError: 'continue' }
};

/* ------- 6. Inbound WhatsApp → AI classify → route ------- */
const tplInboundWa = {
    id: 'tpl-inbound-whatsapp-classify',
    name: 'Inbound WhatsApp → AI Classify → Route',
    category: 'Communication',
    tagline: 'Classify inbound WhatsApp messages with AI and route to the right sales rep.',
    description: 'On every inbound WhatsApp message, classify the intent (buy / rent / complaint / general). Route buy/rent leads to sales, complaints to customer success, general to AI auto-reply.',
    trigger: 'comm.whatsapp.messageReceived',
    tags: ['whatsapp', 'ai', 'routing', 'inbound'],
    nodes: [
        { id: 'ai_class', type: 'ai.classify', label: 'Classify intent',
          config: { input: '{{trigger.message.body}}', labels: 'buy,rent,complaint,general', provider: 'openai' } },
        { id: 'switch_intent', type: 'condition.switch', label: 'Route by intent',
          config: {
              field: 'steps.ai_class.label',
              cases: [
                  { value: 'buy',       branch: 'sales' },
                  { value: 'rent',      branch: 'sales' },
                  { value: 'complaint', branch: 'cs' },
                  { value: 'general',   branch: 'auto_reply' }
              ]
          } },
        { id: 'assign_sales', type: 'crm.lead.assign', label: 'Assign sales',
          config: { leadId: '{{trigger.message.from}}', ownerId: 'sales_team' } },
        { id: 'notify_sales', type: 'comm.notify.internal', label: 'Notify sales',
          config: { userId: 'sales_team', title: 'WhatsApp: buy/rent', body: '{{trigger.message.body}}' } },
        { id: 'assign_cs', type: 'crm.lead.assign', label: 'Assign CS',
          config: { leadId: '{{trigger.message.from}}', ownerId: 'cs_team' } },
        { id: 'wh_reply', type: 'comm.whatsapp.sendMessage', label: 'Auto-reply',
          config: { to: '{{trigger.message.from}}', body: 'Thanks for reaching out. A team member will follow up shortly.' } }
    ],
    edges: [
        { from: 'trigger',        to: 'ai_class',      branch: 'default' },
        { from: 'ai_class',       to: 'switch_intent', branch: 'default' },
        { from: 'switch_intent',  to: 'assign_sales',  branch: 'case:sales' },
        { from: 'switch_intent',  to: 'assign_cs',     branch: 'case:cs' },
        { from: 'switch_intent',  to: 'wh_reply',      branch: 'case:auto_reply' },
        { from: 'assign_sales',   to: 'notify_sales',  branch: 'default' }
    ],
    settings: { retries: 1, retryDelay: '30s', onError: 'continue' }
};

/* ------- 7. MagicBricks inquiry → email follow-up ------- */
const tplMagicBricks = {
    id: 'tpl-magicbricks-followup',
    name: 'MagicBricks Inquiry → Email Follow-up',
    category: 'Portal Leads',
    tagline: 'Capture MagicBricks inquiries, send a personalized email follow-up, and create a CRM lead.',
    description: 'Standard MagicBricks lead intake. Sends an HTML-friendly plain email with property details, creates a CRM lead, and assigns to the sales team.',
    trigger: 'source.magicbricks.newLead',
    tags: ['portal', 'email', 'magicbricks', 'india'],
    nodes: [
        { id: 'wh_quick', type: 'comm.whatsapp.sendTemplate', label: 'WhatsApp acknowledgement',
          config: {
              to: '{{trigger.lead.phone}}',
              template: 'lead_welcome_en',
              language: 'en',
              variables: { name: '{{trigger.lead.name}}', project: '{{trigger.lead.project}}' }
          } },
        { id: 'email_follow', type: 'comm.email.send', label: 'Email property details',
          config: {
              to: '{{trigger.lead.email}}',
              subject: '{{trigger.lead.name}}, your enquiry about {{trigger.lead.project}}',
              body: 'Hi {{trigger.lead.name}},\n\nThanks for your enquiry. Here are the details for {{trigger.lead.project}}.\n\nA sales rep will follow up within 24 hours.\n\nRegards,\nSales Team'
          } },
        { id: 'create_lead', type: 'crm.lead.create', label: 'Create CRM lead',
          config: {
              source: 'magicbricks',
              fields: {
                  name:    '{{trigger.lead.name}}',
                  phone:   '{{trigger.lead.phone}}',
                  email:   '{{trigger.lead.email}}',
                  project: '{{trigger.lead.project}}'
              }
          } },
        { id: 'assign', type: 'crm.lead.assign', label: 'Assign sales',
          config: { leadId: '{{steps.create_lead.leadId}}', ownerId: 'sales_team' } },
        { id: 'tag', type: 'crm.lead.addTag', label: 'Tag: from-magicbricks',
          config: { leadId: '{{steps.create_lead.leadId}}', tag: 'from-magicbricks' } }
    ],
    edges: [
        { from: 'trigger',     to: 'wh_quick',     branch: 'default' },
        { from: 'wh_quick',    to: 'email_follow', branch: 'default' },
        { from: 'email_follow', to: 'create_lead', branch: 'default' },
        { from: 'create_lead', to: 'assign',       branch: 'default' },
        { from: 'assign',      to: 'tag',          branch: 'default' }
    ],
    settings: { retries: 2, retryDelay: '5m', onError: 'continue', dedupeKey: '{{trigger.lead.phone}}' }
};

/* ------- 8. Daily sales report ------- */
const tplDailyReport = {
    id: 'tpl-daily-sales-report',
    name: 'Daily Sales Report Email (8am)',
    category: 'Reporting',
    tagline: 'Every morning at 8am, email the sales head a one-page summary of yesterday\'s activity.',
    description: 'Pulls yesterday\'s leads / deals, formats a summary, and emails it to the sales head. Demonstrates a scheduled reporting workflow.',
    trigger: 'schedule.cron',
    config: { cron: 'every 1 day at 08:00', timezone: 'Asia/Dubai' },
    tags: ['reporting', 'email', 'scheduled'],
    nodes: [
        { id: 'set_date', type: 'data.setVariable', label: 'Yesterday',
          config: { name: 'yesterday', value: '{{now}}' } },
        { id: 'ai_summarize', type: 'ai.summarize', label: 'AI summary',
          config: { input: 'Daily sales report. New leads: 12. Contacted: 9. Qualified: 4. Closed: 1.', maxWords: 80, provider: 'openai' } },
        { id: 'email', type: 'comm.email.send', label: 'Email head of sales',
          config: {
              to: 'head.sales@example.com',
              subject: 'Daily sales report — {{now}}',
              body: '{{steps.ai_summarize.summary}}'
          } }
    ],
    edges: [
        { from: 'trigger', to: 'set_date',     branch: 'default' },
        { from: 'set_date', to: 'ai_summarize', branch: 'default' },
        { from: 'ai_summarize', to: 'email',   branch: 'default' }
    ],
    settings: { retries: 1, retryDelay: '5m', onError: 'continue' }
};

/* Reset the counter so module-level ids are deterministic across HMR. */
_nid = 0;

export const TEMPLATES = [
    tpl99acres,
    tplAiScore,
    tplSiteVisitReminder,
    tplPostVisit,
    tplAdsMonitor,
    tplInboundWa,
    tplMagicBricks,
    tplDailyReport
];

export function getTemplate(id) {
    return TEMPLATES.find(t => t.id === id) || null;
}

export function templateCategories() {
    const set = new Set(TEMPLATES.map(t => t.category));
    return Array.from(set);
}
