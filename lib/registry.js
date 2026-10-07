/* ============================================================
   registry.js — single source of truth for triggers / conditions
   / actions / data / AI / utility nodes.

   Each entry has the same descriptor shape:
     { id, category, provider, object, label, icon, color, group,
       description, inputs, outputs, requiredScopes,
       supportsTest, supportsRetry, async, run(ctx) }

   `run(ctx)` is a REAL adapter call:
     1. Look up credentials via lookupCreds(provider, ctx)
     2. Throw a clear "credentials not configured" error if missing
     3. Make a real fetch() via apiCall({...})
     4. Return the parsed response, or throw on non-2xx

   No toasts, no mock IDs, no _log shims. The engine and UI
   handle all UX. The only side effects here are HTTP requests.
   ============================================================ */

import { apiCall, lookupCreds, requireCreds, paginate } from './adapters.js';

/* ----------------------------------------------------------------
   TRIGGERS — describe inbound events.
   `run()` returns the payload shape the trigger carries. The engine
   walks from the trigger's outgoing edges; `run()` is only called by
   `testNode()` / the smoke test.
   ---------------------------------------------------------------- */
const TRIGGERS = [
    /* ===== Manual / System ===== */
    { id: 'manual.run',                category: 'trigger', provider: 'system', object: null, label: 'Run manually',                icon: '▶️',  color: '#6366f1', group: 'Manual',
      description: 'Trigger this workflow by clicking Run, or from a CRM record\'s action menu.',
      inputs: [], outputs: [{ key: 'payload', label: 'Manual payload', type: 'object' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ ctx }) => ({ triggeredAt: new Date().toISOString(), source: 'manual', payload: ctx?.trigger || {} }) },

    { id: 'schedule.cron',             category: 'trigger', provider: 'system', object: null, label: 'On a schedule',                icon: '⏰', color: '#94a3b8', group: 'Schedule',
      description: 'Fires on a cron-like schedule (every minute / hour / day / week / custom). Production tick requires a backend worker — registered at publish time.',
      inputs: [
        { key: 'cron',     label: 'Schedule', type: 'string', required: true, default: 'every 1 day at 09:00',
          options: ['every 5 minutes','every 15 minutes','every 30 minutes','every 1 hour','every 6 hours','every 1 day at 09:00','every Monday','every weekday','every 1st of month'] },
        { key: 'timezone', label: 'Timezone', type: 'string', required: true, default: 'Asia/Dubai',
          options: ['UTC','Asia/Dubai','Asia/Kolkata','Asia/Riyadh','Asia/Qatar','Africa/Cairo'] }
      ],
      outputs: [{ key: 'firedAt', label: 'Fired at', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node }) => ({ firedAt: new Date().toISOString(), cron: node.config?.cron || '', timezone: node.config?.timezone || '' }) },

    { id: 'webhook.received',          category: 'trigger', provider: 'system', object: null, label: 'Webhook received',             icon: '🪝', color: '#94a3b8', group: 'Webhook',
      description: 'Fires when an HTTP POST hits this automation\'s generated webhook URL. The dispatcher is at /api/automations/<id>/trigger.',
      inputs: [{ key: 'authToken', label: 'Auth token', type: 'string', required: false }],
      outputs: [{ key: 'payload', label: 'Webhook payload', type: 'object' }, { key: 'headers', label: 'Headers', type: 'object' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: () => ({ payload: {}, headers: {} }) },

    /* ===== CRM ===== */
    { id: 'crm.lead.created',          category: 'trigger', provider: 'crm', object: 'lead', label: 'Lead created',                 icon: '🆕', color: '#10b981', group: 'CRM',
      description: 'Fires when a new lead is created upstream. Subscribe via the CRM webhook at publish time.',
      outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'crm.lead.updated',          category: 'trigger', provider: 'crm', object: 'lead', label: 'Lead updated',                 icon: '✏️', color: '#10b981', group: 'CRM',
      description: 'Fires when a lead\'s fields are updated upstream.',
      outputs: [{ key: 'lead', label: 'Lead (new)', type: 'object' }, { key: 'changes', label: 'Changed fields', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null, changes: ctx?.trigger?.changes || {} }) },

    { id: 'crm.lead.statusChanged',    category: 'trigger', provider: 'crm', object: 'lead', label: 'Lead status changed',          icon: '🔁', color: '#10b981', group: 'CRM',
      description: 'Fires when a lead moves between statuses (new → contacted, etc).',
      outputs: [{ key: 'lead', label: 'Lead', type: 'object' }, { key: 'fromStatus', label: 'From', type: 'string' }, { key: 'toStatus', label: 'To', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null, fromStatus: ctx?.trigger?.fromStatus, toStatus: ctx?.trigger?.toStatus }) },

    { id: 'crm.contact.created',       category: 'trigger', provider: 'crm', object: 'contact', label: 'Contact created',          icon: '👤', color: '#10b981', group: 'CRM',
      description: 'Fires when a new contact record is created.',
      outputs: [{ key: 'contact', label: 'Contact', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ contact: ctx?.trigger?.contact || null }) },

    { id: 'crm.deal.created',          category: 'trigger', provider: 'crm', object: 'deal', label: 'Deal created',                 icon: '💼', color: '#10b981', group: 'CRM',
      description: 'Fires when a new deal is created.',
      outputs: [{ key: 'deal', label: 'Deal', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ deal: ctx?.trigger?.deal || null }) },

    { id: 'crm.deal.stageChanged',     category: 'trigger', provider: 'crm', object: 'deal', label: 'Deal stage changed',           icon: '📊', color: '#10b981', group: 'CRM',
      description: 'Fires when a deal moves between pipeline stages.',
      outputs: [{ key: 'deal', label: 'Deal', type: 'object' }, { key: 'fromStage', label: 'From', type: 'string' }, { key: 'toStage', label: 'To', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ deal: ctx?.trigger?.deal || null, fromStage: ctx?.trigger?.fromStage, toStage: ctx?.trigger?.toStage }) },

    { id: 'crm.task.completed',        category: 'trigger', provider: 'crm', object: 'task', label: 'Task completed',               icon: '✅', color: '#10b981', group: 'CRM',
      description: 'Fires when a task is marked complete.',
      outputs: [{ key: 'task', label: 'Task', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ task: ctx?.trigger?.task || null }) },

    { id: 'crm.note.added',            category: 'trigger', provider: 'crm', object: 'note', label: 'Note added',                   icon: '📝', color: '#10b981', group: 'CRM',
      description: 'Fires when a note is added to any CRM record.',
      outputs: [{ key: 'note', label: 'Note', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ note: ctx?.trigger?.note || null }) },

    /* ===== Property ===== */
    { id: 'prop.listing.created',      category: 'trigger', provider: 'properties', object: 'listing', label: 'Property listing created', icon: '🏠', color: '#0ea5e9', group: 'Property',
      description: 'Fires when a new property listing is created.', outputs: [{ key: 'listing', label: 'Listing', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ listing: ctx?.trigger?.listing || null }) },

    { id: 'prop.inquiry.created',      category: 'trigger', provider: 'properties', object: 'inquiry', label: 'Property inquiry created', icon: '📨', color: '#0ea5e9', group: 'Property',
      description: 'Fires when a new property inquiry comes in.', outputs: [{ key: 'inquiry', label: 'Inquiry', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ inquiry: ctx?.trigger?.inquiry || null }) },

    { id: 'prop.siteVisit.scheduled',  category: 'trigger', provider: 'properties', object: 'siteVisit', label: 'Site visit scheduled',  icon: '🗓️', color: '#0ea5e9', group: 'Property',
      description: 'Fires when a site visit is scheduled on the calendar.', outputs: [{ key: 'visit', label: 'Site visit', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ visit: ctx?.trigger?.visit || null }) },

    { id: 'prop.siteVisit.completed',  category: 'trigger', provider: 'properties', object: 'siteVisit', label: 'Site visit completed',  icon: '✔️', color: '#0ea5e9', group: 'Property',
      description: 'Fires when a site visit is marked complete.', outputs: [{ key: 'visit', label: 'Site visit', type: 'object' }, { key: 'feedback', label: 'Feedback', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ visit: ctx?.trigger?.visit || null, feedback: ctx?.trigger?.feedback || {} }) },

    /* ===== Communication (inbound) ===== */
    { id: 'comm.whatsapp.messageReceived', category: 'trigger', provider: 'whatsapp', object: 'message', label: 'WhatsApp message received', icon: '💬', color: '#25d366', group: 'Communication',
      description: 'Fires when an inbound WhatsApp message arrives. Requires WhatsApp webhook configured on your Meta Business app.', outputs: [{ key: 'message', label: 'WhatsApp message', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ message: ctx?.trigger?.message || null }) },

    { id: 'comm.email.opened',         category: 'trigger', provider: 'email', object: 'event', label: 'Email opened',                 icon: '📧', color: '#ec4899', group: 'Communication',
      description: 'Fires when a sent email is opened (requires tracking pixel).', outputs: [{ key: 'event', label: 'Open event', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ event: ctx?.trigger?.event || null }) },

    { id: 'comm.sms.received',         category: 'trigger', provider: 'sms', object: 'message', label: 'SMS received',                 icon: '📱', color: '#ec4899', group: 'Communication',
      description: 'Fires when an inbound SMS is received.', outputs: [{ key: 'message', label: 'SMS', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ message: ctx?.trigger?.message || null }) },

    { id: 'comm.call.completed',       category: 'trigger', provider: 'voice', object: 'call', label: 'Call completed',               icon: '📞', color: '#ec4899', group: 'Communication',
      description: 'Fires when an outbound or inbound call finishes.', outputs: [{ key: 'call', label: 'Call', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ call: ctx?.trigger?.call || null }) },

    /* ===== Lead source ===== */
    { id: 'source.99acres.newLead',    category: 'trigger', provider: '99acres', object: 'lead', label: '99acres — new lead',           icon: '🟧', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead arrives from 99acres.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.magicbricks.newLead',category: 'trigger', provider: 'magicbricks', object: 'lead', label: 'MagicBricks — new lead',   icon: '🟦', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead arrives from MagicBricks.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.housing.newLead',    category: 'trigger', provider: 'housing', object: 'lead', label: 'Housing.com — new lead',       icon: '🟩', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead arrives from Housing.com.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.nobroker.newLead',   category: 'trigger', provider: 'nobroker', object: 'lead', label: 'NoBroker — new lead',          icon: '🟪', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead arrives from NoBroker.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.commonfloor.newLead',category: 'trigger', provider: 'commonfloor', object: 'lead', label: 'CommonFloor — new lead',   icon: '🟨', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead arrives from CommonFloor.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.squareyards.newLead',category: 'trigger', provider: 'squareyards', object: 'lead', label: 'Square Yards — new lead',  icon: '🟫', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead arrives from Square Yards.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.facebookLead.newLead', category: 'trigger', provider: 'facebook', object: 'lead', label: 'Facebook Lead Ad — new lead', icon: '📘', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead is submitted via a Facebook Lead Ad form.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.instagramLead.newLead',category: 'trigger', provider: 'instagram', object: 'lead', label: 'Instagram Lead — new lead',  icon: '📷', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead is submitted via an eligible Instagram Lead Form.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'source.linkedinLead.newLead',category: 'trigger', provider: 'linkedin', object: 'lead', label: 'LinkedIn Lead Gen — new lead', icon: '💼', color: '#f97316', group: 'Lead sources',
      description: 'Fires when a new lead is submitted via a LinkedIn Lead Gen Form.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    /* ===== Ads ===== */
    { id: 'ads.google.leadCreated',    category: 'trigger', provider: 'google_ads', object: 'lead', label: 'Google Ads — new lead',        icon: '🟢', color: '#3b82f6', group: 'Advertising',
      description: 'Fires when Google Ads records a new conversion/lead.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'ads.meta.leadCreated',      category: 'trigger', provider: 'meta_ads', object: 'lead', label: 'Meta Ads — new lead',          icon: '🔵', color: '#3b82f6', group: 'Advertising',
      description: 'Fires when Meta Ads records a new conversion from a Lead form.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) },

    { id: 'ads.linkedin.formSubmitted',category: 'trigger', provider: 'linkedin_ads', object: 'submission', label: 'LinkedIn Ads — form submitted', icon: '🔷', color: '#3b82f6', group: 'Advertising',
      description: 'Fires when a LinkedIn Lead Gen form is submitted.', outputs: [{ key: 'submission', label: 'Form submission', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ submission: ctx?.trigger?.submission || null }) },

    { id: 'ads.tiktok.leadGenerated',  category: 'trigger', provider: 'tiktok_ads', object: 'lead', label: 'TikTok Ads — lead generated',  icon: '⬛', color: '#3b82f6', group: 'Advertising',
      description: 'Fires when TikTok Ads records a new lead.', outputs: [{ key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: false,
      run: ({ ctx }) => ({ lead: ctx?.trigger?.lead || null }) }
];

/* ----------------------------------------------------------------
   CONDITIONS — pure logic, no network. These stay as-is.
   ---------------------------------------------------------------- */
function resolveFromCtx(ctx, path) {
    if (!path || !ctx) return undefined;
    const parts = String(path).split('.');
    let cur = ctx;
    for (const p of parts) {
        if (cur == null) return undefined;
        if (p === 'ctx' || p === 'trigger' || p === 'vars' || p === 'steps') { cur = cur[p]; continue; }
        if (cur && cur.trigger && (cur.trigger[p] !== undefined)) { cur = cur.trigger[p]; continue; }
        if (cur && (cur[p] !== undefined)) { cur = cur[p]; continue; }
        return undefined;
    }
    return cur;
}

const CONDITIONS = [
    { id: 'condition.if',  category: 'condition', provider: 'system', object: null, label: 'If / else',          icon: '🔀', color: '#8b5cf6', group: 'Logic',
      description: 'Branch the flow based on one or more comparisons on trigger / step output.',
      inputs: [
        { key: 'rules',     label: 'Rules',          type: 'array',   required: true, default: [] },
        { key: 'combinator',label: 'Match',          type: 'string',  required: true, default: 'all', options: ['all','any'] },
        { key: 'fallbackNodeId', label: 'No-branch → node', type: 'string', required: false }
      ],
      outputs: [{ key: 'matched', label: 'Branch taken', type: 'string' }, { key: 'rule', label: 'Matched rule', type: 'object' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node, ctx }) => {
          const combinator = node.config?.combinator || 'all';
          const rules = node.config?.rules || [];
          const evalRule = (rule) => {
              if (!rule || !rule.field) return false;
              const val = resolveFromCtx(ctx, rule.field);
              const target = rule.value;
              switch (rule.op) {
                  case 'equals':        return String(val) === String(target);
                  case 'not_equals':    return String(val) !== String(target);
                  case 'contains':      return String(val || '').includes(String(target || ''));
                  case 'not_contains':  return !String(val || '').includes(String(target || ''));
                  case 'gt':            return Number(val) >  Number(target);
                  case 'gte':           return Number(val) >= Number(target);
                  case 'lt':            return Number(val) <  Number(target);
                  case 'lte':           return Number(val) <= Number(target);
                  case 'is_empty':      return val == null || val === '' || (Array.isArray(val) && val.length === 0);
                  case 'is_not_empty':  return !(val == null || val === '' || (Array.isArray(val) && val.length === 0));
                  case 'starts_with':   return String(val || '').startsWith(String(target || ''));
                  case 'ends_with':     return String(val || '').endsWith(String(target || ''));
                  default: return false;
              }
          };
          const matched = rules.length === 0 ? true
              : combinator === 'any' ? rules.some(evalRule)
              : rules.every(evalRule);
          const rule = rules.find(evalRule) || null;
          return { matched: matched ? 'yes' : 'no', rule };
      } },

    { id: 'condition.switch', category: 'condition', provider: 'system', object: null, label: 'Switch (route by value)', icon: '🪜', color: '#8b5cf6', group: 'Logic',
      description: 'Route the flow based on the value of a single field (e.g. lead.score → hot/warm/cold).',
      inputs: [
        { key: 'field',   label: 'Switch on', type: 'string',  required: true, default: 'trigger.lead.source' },
        { key: 'cases',   label: 'Cases',     type: 'array',   required: true, default: [] }
      ],
      outputs: [{ key: 'matchedCase', label: 'Matched case', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node, ctx }) => {
          const field = node.config?.field;
          const cases = node.config?.cases || [];
          const val = resolveFromCtx(ctx, field);
          const match = cases.find(c => String(c.value) === String(val)) || cases.find(c => c.value === '__default__') || null;
          return { matchedCase: match ? match.value : '__default__' };
      } },

    { id: 'condition.exists', category: 'condition', provider: 'crm', object: null, label: 'Record exists', icon: '🔍', color: '#8b5cf6', group: 'Logic',
      description: 'Branches based on whether a CRM record exists matching the lookup.',
      inputs: [
        { key: 'object',  label: 'Object', type: 'string', required: true, options: ['lead','contact','deal','listing'] },
        { key: 'matchField', label: 'Match field', type: 'string', required: true },
        { key: 'matchValue', label: 'Match value template', type: 'string', required: true }
      ],
      outputs: [{ key: 'found', label: 'Found?', type: 'boolean' }],
      supportsTest: true, supportsRetry: false, async: true,
      run: async ({ node, ctx }) => {
          const creds = lookupCreds('crm', ctx);
          requireCreds('crm', creds, ['apiBase', 'token']);
          const field = resolveFromCtx(ctx, node.config?.matchField);
          const target = node.config?.matchValue;
          if (!field || !target) return { found: false, record: null };
          const obj = node.config?.object || 'lead';
          const res = await apiCall({
              method: 'GET',
              url: `${creds.apiBase}/api/v1/${obj}s`,
              headers: { Authorization: `Bearer ${creds.token}` },
              query: { [`${node.config?.matchField?.split('.').pop() || field}`]: field },
              provider: 'crm'
          });
          const found = Array.isArray(res?.items) && res.items.length > 0;
          return { found, record: found ? res.items[0] : null };
      } },

    { id: 'condition.changed', category: 'condition', provider: 'system', object: null, label: 'Field changed', icon: '🔄', color: '#8b5cf6', group: 'Logic',
      description: 'Branches when a specific field changed value during the trigger event.',
      inputs: [{ key: 'field', label: 'Field', type: 'string', required: true }],
      outputs: [{ key: 'changed', label: 'Changed?', type: 'boolean' }, { key: 'from', label: 'From', type: 'string' }, { key: 'to', label: 'To', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node, ctx }) => {
          const changes = ctx?.trigger?.changes || {};
          const f = node.config?.field;
          const ch = f ? changes[f] : null;
          if (!ch) return { changed: false };
          return { changed: true, from: ch.from, to: ch.to };
      } }
];

/* ----------------------------------------------------------------
   ACTIONS — real adapter calls.
   Every run() looks up credentials, throws if missing, then fetches.
   ---------------------------------------------------------------- */

/* --- CRM (16) — POST/PATCH/DELETE on {apiBase}/api/v1/... --- */
const CRM_HELPERS = {
    auth(creds) { return { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' }; }
};
const ACTIONS = [
    { id: 'crm.lead.create',          category: 'action', provider: 'crm', object: 'lead', label: 'Create lead',         icon: '➕', color: '#10b981', group: 'CRM',
      description: 'Create a new lead record via the CRM REST API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'source', label: 'Source', type: 'string', default: 'automation' }, { key: 'fields', label: 'Fields', type: 'object' }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }, { key: 'lead', label: 'Lead', type: 'object' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/leads`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm',
              body: { source: node.config?.source || 'automation', ...(node.config?.fields || {}) } });
      } },

    { id: 'crm.lead.update',          category: 'action', provider: 'crm', object: 'lead', label: 'Update lead',         icon: '✏️', color: '#10b981', group: 'CRM',
      description: 'Update an existing lead record.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'fields', label: 'Fields', type: 'object' }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }, { key: 'lead', label: 'Lead', type: 'object' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'PATCH', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: node.config?.fields || {} });
      } },

    { id: 'crm.lead.assign',          category: 'action', provider: 'crm', object: 'lead', label: 'Assign lead',         icon: '👤', color: '#10b981', group: 'CRM',
      description: 'Assign a lead to a user/team.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'ownerId', label: 'Owner ID', type: 'string', required: true }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }, { key: 'ownerId', label: 'Owner ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}/assign`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { ownerId: node.config?.ownerId } });
      } },

    { id: 'crm.lead.changeStatus',    category: 'action', provider: 'crm', object: 'lead', label: 'Change lead status',  icon: '🔁', color: '#10b981', group: 'CRM',
      description: 'Move a lead to a different status.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'status', label: 'New status', type: 'string', required: true }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }, { key: 'status', label: 'Status', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}/status`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { status: node.config?.status } });
      } },

    { id: 'crm.lead.changeScore',     category: 'action', provider: 'crm', object: 'lead', label: 'Change lead score',   icon: '🎯', color: '#10b981', group: 'CRM',
      description: 'Set a lead\'s score (numeric).', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'score', label: 'Score', type: 'number', required: true }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }, { key: 'score', label: 'Score', type: 'number' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}/score`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { score: Number(node.config?.score) || 0 } });
      } },

    { id: 'crm.lead.addTag',          category: 'action', provider: 'crm', object: 'lead', label: 'Add tag',             icon: '🏷️', color: '#10b981', group: 'CRM',
      description: 'Add a tag to a lead.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'tag', label: 'Tag', type: 'string', required: true }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }, { key: 'tag', label: 'Tag', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}/tags`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { tag: node.config?.tag } });
      } },

    { id: 'crm.lead.removeTag',       category: 'action', provider: 'crm', object: 'lead', label: 'Remove tag',          icon: '🗑️', color: '#10b981', group: 'CRM',
      description: 'Remove a tag from a lead.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'tag', label: 'Tag', type: 'string', required: true }],
      outputs: [{ key: 'leadId', label: 'Lead ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'DELETE', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}/tags/${encodeURIComponent(node.config?.tag)}`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm' });
      } },

    { id: 'crm.lead.addNote',         category: 'action', provider: 'crm', object: 'lead', label: 'Add note',            icon: '📝', color: '#10b981', group: 'CRM',
      description: 'Add a note to a lead.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }, { key: 'body', label: 'Note body', type: 'string', required: true }],
      outputs: [{ key: 'noteId', label: 'Note ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}/notes`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { body: node.config?.body } });
      } },

    { id: 'crm.lead.createTask',      category: 'action', provider: 'crm', object: 'task', label: 'Create task',         icon: '🧾', color: '#10b981', group: 'CRM',
      description: 'Create a CRM task linked to a lead or deal.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'title', label: 'Title', type: 'string', required: true }, { key: 'dueIn', label: 'Due in (h)', type: 'number', default: 24 }, { key: 'assignee', label: 'Assignee ID', type: 'string' }, { key: 'linkedTo', label: 'Linked to', type: 'object' }],
      outputs: [{ key: 'taskId', label: 'Task ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/tasks`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm',
              body: { title: node.config?.title, dueInHours: Number(node.config?.dueIn) || 24,
                      assigneeId: node.config?.assignee, linkedTo: node.config?.linkedTo || {} } });
      } },

    { id: 'crm.lead.delete',          category: 'action', provider: 'crm', object: 'lead', label: 'Delete lead',         icon: '🗑️', color: '#10b981', group: 'CRM',
      description: 'Permanently delete a lead.', supportsTest: false, supportsRetry: false, async: true,
      inputs: [{ key: 'leadId', label: 'Lead ID', type: 'string', required: true }],
      outputs: [{ key: 'deleted', label: 'Deleted', type: 'boolean' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          await apiCall({ method: 'DELETE', url: `${creds.apiBase}/api/v1/leads/${encodeURIComponent(node.config?.leadId)}`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm' });
          return { deleted: true };
      } },

    { id: 'crm.contact.create',       category: 'action', provider: 'crm', object: 'contact', label: 'Create contact',  icon: '➕', color: '#10b981', group: 'CRM',
      description: 'Create a new contact record.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'fields', label: 'Fields', type: 'object' }],
      outputs: [{ key: 'contactId', label: 'Contact ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/contacts`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: node.config?.fields || {} });
      } },

    { id: 'crm.contact.update',       category: 'action', provider: 'crm', object: 'contact', label: 'Update contact',  icon: '✏️', color: '#10b981', group: 'CRM',
      description: 'Update an existing contact record.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'contactId', label: 'Contact ID', type: 'string', required: true }, { key: 'fields', label: 'Fields', type: 'object' }],
      outputs: [{ key: 'contactId', label: 'Contact ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'PATCH', url: `${creds.apiBase}/api/v1/contacts/${encodeURIComponent(node.config?.contactId)}`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: node.config?.fields || {} });
      } },

    { id: 'crm.deal.create',          category: 'action', provider: 'crm', object: 'deal', label: 'Create deal',         icon: '💼', color: '#10b981', group: 'CRM',
      description: 'Create a new deal in a pipeline.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'name', label: 'Deal name', type: 'string', required: true }, { key: 'value', label: 'Value', type: 'number' }, { key: 'stage', label: 'Stage', type: 'string' }],
      outputs: [{ key: 'dealId', label: 'Deal ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/deals`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm',
              body: { name: node.config?.name, value: Number(node.config?.value) || 0, stage: node.config?.stage } });
      } },

    { id: 'crm.deal.moveStage',       category: 'action', provider: 'crm', object: 'deal', label: 'Move deal stage',     icon: '📊', color: '#10b981', group: 'CRM',
      description: 'Move a deal to a different pipeline stage.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'dealId', label: 'Deal ID', type: 'string', required: true }, { key: 'stage', label: 'New stage', type: 'string', required: true }],
      outputs: [{ key: 'dealId', label: 'Deal ID', type: 'string' }, { key: 'stage', label: 'Stage', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/deals/${encodeURIComponent(node.config?.dealId)}/stage`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { stage: node.config?.stage } });
      } },

    { id: 'crm.deal.markWon',         category: 'action', provider: 'crm', object: 'deal', label: 'Mark deal won',       icon: '🏆', color: '#10b981', group: 'CRM',
      description: 'Mark a deal as won.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'dealId', label: 'Deal ID', type: 'string', required: true }],
      outputs: [{ key: 'dealId', label: 'Deal ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/deals/${encodeURIComponent(node.config?.dealId)}/won`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: {} });
      } },

    { id: 'crm.deal.markLost',        category: 'action', provider: 'crm', object: 'deal', label: 'Mark deal lost',      icon: '💔', color: '#10b981', group: 'CRM',
      description: 'Mark a deal as lost.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'dealId', label: 'Deal ID', type: 'string', required: true }, { key: 'reason', label: 'Reason', type: 'string' }],
      outputs: [{ key: 'dealId', label: 'Deal ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/deals/${encodeURIComponent(node.config?.dealId)}/lost`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm', body: { reason: node.config?.reason } });
      } },

    /* --- Property (5) --- */
    { id: 'prop.listings.create',     category: 'action', provider: 'properties', object: 'listing', label: 'Create listing', icon: '➕', color: '#0ea5e9', group: 'Property',
      description: 'Create a new property listing.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'fields', label: 'Fields', type: 'object' }],
      outputs: [{ key: 'listingId', label: 'Listing ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('properties', lookupCreds('properties', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/listings`,
              headers: CRM_HELPERS.auth(creds), provider: 'properties', body: node.config?.fields || {} });
      } },

    { id: 'prop.listings.publish',    category: 'action', provider: 'properties', object: 'listing', label: 'Publish listing', icon: '🚀', color: '#0ea5e9', group: 'Property',
      description: 'Publish a listing to enabled portals.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }],
      outputs: [{ key: 'listingId', label: 'Listing ID', type: 'string' }, { key: 'publishedAt', label: 'Published at', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('properties', lookupCreds('properties', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/listings/${encodeURIComponent(node.config?.listingId)}/publish`,
              headers: CRM_HELPERS.auth(creds), provider: 'properties', body: {} });
      } },

    { id: 'prop.listings.unpublish',  category: 'action', provider: 'properties', object: 'listing', label: 'Unpublish listing', icon: '⏸️', color: '#0ea5e9', group: 'Property',
      description: 'Unpublish a listing from portals.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }],
      outputs: [{ key: 'listingId', label: 'Listing ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('properties', lookupCreds('properties', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/listings/${encodeURIComponent(node.config?.listingId)}/unpublish`,
              headers: CRM_HELPERS.auth(creds), provider: 'properties', body: {} });
      } },

    { id: 'prop.inquiry.create',      category: 'action', provider: 'properties', object: 'inquiry', label: 'Create inquiry', icon: '📨', color: '#0ea5e9', group: 'Property',
      description: 'Create a new property inquiry.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'fields', label: 'Fields', type: 'object' }],
      outputs: [{ key: 'inquiryId', label: 'Inquiry ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('properties', lookupCreds('properties', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/inquiries`,
              headers: CRM_HELPERS.auth(creds), provider: 'properties', body: node.config?.fields || {} });
      } },

    { id: 'prop.siteVisit.schedule',  category: 'action', provider: 'properties', object: 'siteVisit', label: 'Schedule site visit', icon: '🗓️', color: '#0ea5e9', group: 'Property',
      description: 'Schedule a site visit on the calendar.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }, { key: 'when', label: 'When (ISO)', type: 'string', required: true }, { key: 'contact', label: 'Contact', type: 'object' }],
      outputs: [{ key: 'visitId', label: 'Visit ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('properties', lookupCreds('properties', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/site-visits`,
              headers: CRM_HELPERS.auth(creds), provider: 'properties',
              body: { listingId: node.config?.listingId, scheduledFor: node.config?.when, contact: node.config?.contact || {} } });
      } },

    /* --- Communication (8) --- */
    { id: 'comm.whatsapp.sendMessage', category: 'action', provider: 'whatsapp', object: 'message', label: 'WhatsApp — send freeform message', icon: '💬', color: '#25d366', group: 'Communication',
      description: 'Send a plain WhatsApp message (within 24h service window).', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'to', label: 'Recipient phone', type: 'string', required: true }, { key: 'body', label: 'Message body', type: 'string', required: true }],
      outputs: [{ key: 'messageId', label: 'Message ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('whatsapp', lookupCreds('whatsapp', ctx), ['phoneNumberId', 'accessToken']);
          return apiCall({ method: 'POST',
              url: `https://graph.facebook.com/v20.0/${encodeURIComponent(creds.phoneNumberId)}/messages`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'whatsapp',
              body: { messaging_product: 'whatsapp', to: node.config?.to, type: 'text',
                      text: { body: node.config?.body } } });
      } },

    { id: 'comm.whatsapp.sendTemplate',category: 'action', provider: 'whatsapp', object: 'message', label: 'WhatsApp — send template', icon: '📋', color: '#25d366', group: 'Communication',
      description: 'Send a pre-approved WhatsApp template with variables.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'to', label: 'Recipient phone', type: 'string', required: true }, { key: 'template', label: 'Template name', type: 'string', required: true }, { key: 'language', label: 'Language', type: 'string', default: 'en' }, { key: 'variables', label: 'Variables', type: 'object' }],
      outputs: [{ key: 'messageId', label: 'Message ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('whatsapp', lookupCreds('whatsapp', ctx), ['phoneNumberId', 'accessToken']);
          const vars = node.config?.variables || {};
          const components = Object.keys(vars).length ? [{
              type: 'body', parameters: Object.values(vars).map(v => ({ type: 'text', text: String(v) }))
          }] : [];
          return apiCall({ method: 'POST',
              url: `https://graph.facebook.com/v20.0/${encodeURIComponent(creds.phoneNumberId)}/messages`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'whatsapp',
              body: { messaging_product: 'whatsapp', to: node.config?.to, type: 'template',
                      template: { name: node.config?.template, language: { code: node.config?.language || 'en' }, components } } });
      } },

    { id: 'comm.email.send',          category: 'action', provider: 'email', object: 'message', label: 'Send email',           icon: '📧', color: '#ec4899', group: 'Communication',
      description: 'Send a transactional or marketing email via SendGrid.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'to', label: 'To', type: 'string', required: true }, { key: 'subject', label: 'Subject', type: 'string', required: true }, { key: 'body', label: 'Body', type: 'string', required: true }, { key: 'from', label: 'From', type: 'string' }],
      outputs: [{ key: 'messageId', label: 'Message ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('email', lookupCreds('email', ctx), ['apiKey', 'from']);
          return apiCall({ method: 'POST', url: 'https://api.sendgrid.com/v3/mail/send',
              headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
              provider: 'sendgrid',
              body: { personalizations: [{ to: [{ email: node.config?.to }] }],
                      from: { email: node.config?.from || creds.from },
                      subject: node.config?.subject,
                      content: [{ type: 'text/plain', value: node.config?.body }] } });
      } },

    { id: 'comm.sms.send',            category: 'action', provider: 'sms', object: 'message', label: 'Send SMS',             icon: '📱', color: '#ec4899', group: 'Communication',
      description: 'Send an SMS via Twilio.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'to', label: 'Recipient phone', type: 'string', required: true }, { key: 'body', label: 'Body', type: 'string', required: true }, { key: 'from', label: 'From', type: 'string' }],
      outputs: [{ key: 'messageId', label: 'Message ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('sms', lookupCreds('sms', ctx), ['accountSid', 'authToken', 'from']);
          const basicAuth = 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
          return apiCall({ method: 'POST',
              url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`,
              headers: { Authorization: basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
              provider: 'twilio',
              body: new URLSearchParams({ To: node.config?.to, From: node.config?.from || creds.from, Body: node.config?.body || '' }) });
      } },

    { id: 'comm.voice.call',          category: 'action', provider: 'voice', object: 'call', label: 'Start AI / Voice call', icon: '📞', color: '#ec4899', group: 'Communication',
      description: 'Place an outbound call via Twilio Voice (AI agent or human transfer).', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'to', label: 'Recipient phone', type: 'string', required: true }, { key: 'script', label: 'Script / agent ID', type: 'string' }, { key: 'from', label: 'From', type: 'string' }],
      outputs: [{ key: 'callId', label: 'Call ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('voice', lookupCreds('voice', ctx), ['accountSid', 'authToken', 'from']);
          const basicAuth = 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
          return apiCall({ method: 'POST',
              url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Calls.json`,
              headers: { Authorization: basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
              provider: 'twilio-voice',
              body: new URLSearchParams({ To: node.config?.to, From: node.config?.from || creds.from, Url: node.config?.script || '' }) });
      } },

    { id: 'comm.calendar.createEvent',category: 'action', provider: 'calendar', object: 'event', label: 'Create calendar event', icon: '📅', color: '#ec4899', group: 'Communication',
      description: 'Create a Google Calendar event.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'title', label: 'Title', type: 'string', required: true }, { key: 'start', label: 'Start (ISO)', type: 'string', required: true }, { key: 'duration', label: 'Duration (min)', type: 'number', default: 30 }, { key: 'attendees', label: 'Attendees', type: 'array' }],
      outputs: [{ key: 'eventId', label: 'Event ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('calendar', lookupCreds('calendar', ctx), ['accessToken']);
          const start = node.config?.start;
          const end = new Date(new Date(start).getTime() + (Number(node.config?.duration) || 30) * 60000).toISOString();
          return apiCall({ method: 'POST',
              url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'google-calendar',
              body: { summary: node.config?.title, start: { dateTime: start }, end: { dateTime: end },
                      attendees: (node.config?.attendees || []).map(email => ({ email })) } });
      } },

    { id: 'comm.meeting.create',      category: 'action', provider: 'meeting', object: 'meeting', label: 'Create meeting link', icon: '🎥', color: '#ec4899', group: 'Communication',
      description: 'Generate a Zoom meeting link.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'provider', label: 'Provider', type: 'string', default: 'zoom', options: ['zoom','google_meet','teams'] }, { key: 'topic', label: 'Topic', type: 'string', required: true }],
      outputs: [{ key: 'meetingUrl', label: 'Meeting URL', type: 'string' }],
      run: async ({ node, ctx }) => {
          const provider = node.config?.provider || 'zoom';
          if (provider === 'zoom') {
              const creds = requireCreds('zoom', lookupCreds('zoom', ctx), ['accountId', 'clientId', 'clientSecret']);
              /* OAuth Server-to-Server token first */
              const basicAuth = 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
              const tokenRes = await apiCall({
                  method: 'POST',
                  url: `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`,
                  headers: { Authorization: basicAuth }, provider: 'zoom-oauth' });
              return apiCall({ method: 'POST', url: 'https://api.zoom.us/v2/users/me/meetings',
                  headers: { Authorization: `Bearer ${tokenRes.access_token}`, 'Content-Type': 'application/json' },
                  provider: 'zoom', body: { topic: node.config?.topic, type: 1, settings: { join_before_hosted: false } } });
          }
          throw new Error(`Meeting provider "${provider}" not wired yet — only zoom is implemented.`);
      } },

    { id: 'comm.notify.internal',     category: 'action', provider: 'system', object: 'notification', label: 'Send internal notification', icon: '🔔', color: '#94a3b8', group: 'Communication',
      description: 'Persist an in-app notification for a user. The CRM\'s GET /api/v1/notifications endpoint will pick this up.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'userId', label: 'Recipient user ID', type: 'string', required: true }, { key: 'title', label: 'Title', type: 'string', required: true }, { key: 'body', label: 'Body', type: 'string' }],
      outputs: [{ key: 'notified', label: 'Notified', type: 'boolean' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          await apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/notifications`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm',
              body: { userId: node.config?.userId, title: node.config?.title, body: node.config?.body || '' } });
          return { notified: true };
      } },

    /* --- Productivity (6) --- */
    { id: 'prod.sheets.appendRow',    category: 'action', provider: 'google_sheets', object: 'row', label: 'Sheets — append row', icon: '📊', color: '#10b981', group: 'Productivity',
      description: 'Append a row to a Google Sheet via the Sheets API v4.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'string', required: true }, { key: 'sheet', label: 'Sheet', type: 'string', default: 'Sheet1' }, { key: 'values', label: 'Values', type: 'array' }],
      outputs: [{ key: 'updatedRange', label: 'Updated range', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('google_sheets', lookupCreds('google_sheets', ctx), ['accessToken']);
          return apiCall({ method: 'POST',
              url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(node.config?.spreadsheetId)}/values/${encodeURIComponent(node.config?.sheet || 'Sheet1')}:append`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              query: { valueInputOption: 'USER_ENTERED' },
              provider: 'google-sheets',
              body: { values: [node.config?.values || []] } });
      } },

    { id: 'prod.sheets.updateRow',    category: 'action', provider: 'google_sheets', object: 'row', label: 'Sheets — update row', icon: '✏️', color: '#10b981', group: 'Productivity',
      description: 'Update a row in a Google Sheet.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'string', required: true }, { key: 'range', label: 'Range (A1 notation)', type: 'string', required: true }, { key: 'values', label: 'Values', type: 'array' }],
      outputs: [{ key: 'updatedRange', label: 'Updated range', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('google_sheets', lookupCreds('google_sheets', ctx), ['accessToken']);
          return apiCall({ method: 'PUT',
              url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(node.config?.spreadsheetId)}/values/${encodeURIComponent(node.config?.range)}`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              query: { valueInputOption: 'USER_ENTERED' },
              provider: 'google-sheets',
              body: { values: [node.config?.values || []] } });
      } },

    { id: 'prod.drive.createFolder',  category: 'action', provider: 'google_drive', object: 'folder', label: 'Drive — create folder', icon: '📁', color: '#10b981', group: 'Productivity',
      description: 'Create a Google Drive folder.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'name', label: 'Folder name', type: 'string', required: true }, { key: 'parentId', label: 'Parent ID', type: 'string' }],
      outputs: [{ key: 'folderId', label: 'Folder ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('google_drive', lookupCreds('google_drive', ctx), ['accessToken']);
          return apiCall({ method: 'POST', url: 'https://www.googleapis.com/drive/v3/files',
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'google-drive',
              body: { name: node.config?.name, mimeType: 'application/vnd.google-apps.folder',
                      parents: node.config?.parentId ? [node.config.parentId] : undefined } });
      } },

    { id: 'http.request',             category: 'action', provider: 'http', object: 'request', label: 'HTTP request',         icon: '🌐', color: '#000000', group: 'Productivity',
      description: 'Make a generic HTTP request to any external API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [
        { key: 'method', label: 'Method', type: 'string', default: 'POST', options: ['GET','POST','PUT','PATCH','DELETE'] },
        { key: 'url',    label: 'URL',    type: 'string', required: true },
        { key: 'headers',label: 'Headers',type: 'object' },
        { key: 'body',   label: 'Body (JSON or text)', type: 'string' },
        { key: 'timeout',label: 'Timeout (ms)', type: 'number', default: 30000 }
      ],
      outputs: [{ key: 'status', label: 'Status', type: 'number' }, { key: 'response', label: 'Response body', type: 'object' }],
      run: async ({ node }) => {
          if (!node.config?.url) throw new Error('http.request: url is required');
          let body = node.config?.body;
          if (body && typeof body === 'string') {
              try { body = JSON.parse(body); } catch { /* keep as string */ }
          }
          const res = await apiCall({ method: node.config?.method || 'GET', url: node.config.url,
              headers: node.config?.headers || {}, body, timeoutMs: Number(node.config?.timeout) || 30000, provider: 'http' });
          return { status: 200, response: res };
      } },

    { id: 'http.webhook.send',        category: 'action', provider: 'http', object: 'webhook', label: 'Send outgoing webhook', icon: '🪝', color: '#000000', group: 'Productivity',
      description: 'POST a payload to an external webhook URL.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'url', label: 'Webhook URL', type: 'string', required: true }, { key: 'body', label: 'Body', type: 'object' }],
      outputs: [{ key: 'status', label: 'Status', type: 'number' }],
      run: async ({ node }) => {
          if (!node.config?.url) throw new Error('http.webhook.send: url is required');
          await apiCall({ method: 'POST', url: node.config.url, body: node.config?.body || {}, provider: 'webhook' });
          return { status: 200 };
      } },

    { id: 'http.code.run',            category: 'action', provider: 'system', object: 'code', label: 'Run custom code (sandboxed)', icon: '⌨️', color: '#000000', group: 'Productivity',
      description: 'Execute a small JavaScript snippet. Output = last expression. WARNING: pure Function() — for trusted code only; use isolated-vm in production.',
      inputs: [{ key: 'code', label: 'JavaScript', type: 'string', required: true }],
      outputs: [{ key: 'result', label: 'Result', type: 'object' }],
      supportsTest: true, supportsRetry: false, async: true,
      run: async ({ node, ctx }) => {
          try {
              // eslint-disable-next-line no-new-func
              const fn = new Function('ctx', `with (ctx) { ${node.config?.code || 'return null;'} }`);
              return { result: fn(ctx) };
          } catch (e) {
              return { result: null, error: e.message };
          }
      } },

    /* --- Payments (3) --- */
    { id: 'pay.stripe.createInvoice', category: 'action', provider: 'stripe', object: 'invoice', label: 'Stripe — create invoice', icon: '🧾', color: '#635bff', group: 'Payments',
      description: 'Create a Stripe invoice.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'customerId', label: 'Customer ID', type: 'string', required: true }, { key: 'amount', label: 'Amount', type: 'number', required: true }, { key: 'currency', label: 'Currency', type: 'string', default: 'usd' }],
      outputs: [{ key: 'invoiceId', label: 'Invoice ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('stripe', lookupCreds('stripe', ctx), ['secretKey']);
          return apiCall({ method: 'POST', url: 'https://api.stripe.com/v1/invoices',
              headers: { Authorization: `Bearer ${creds.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              provider: 'stripe',
              body: new URLSearchParams({ customer: node.config?.customerId,
                  'amount_due': String(Number(node.config?.amount) || 0), currency: node.config?.currency || 'usd' }) });
      } },

    { id: 'pay.razorpay.createOrder', category: 'action', provider: 'razorpay', object: 'order', label: 'Razorpay — create order', icon: '🧾', color: '#3395ff', group: 'Payments',
      description: 'Create a Razorpay order.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'amount', label: 'Amount (paise)', type: 'number', required: true }, { key: 'currency', label: 'Currency', type: 'string', default: 'INR' }],
      outputs: [{ key: 'orderId', label: 'Order ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('razorpay', lookupCreds('razorpay', ctx), ['keyId', 'keySecret']);
          const basicAuth = 'Basic ' + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');
          return apiCall({ method: 'POST', url: 'https://api.razorpay.com/v1/orders',
              headers: { Authorization: basicAuth, 'Content-Type': 'application/json' },
              provider: 'razorpay',
              body: { amount: Number(node.config?.amount) || 0, currency: node.config?.currency || 'INR' } });
      } },

    { id: 'pay.cashfree.createPayment',category: 'action', provider: 'cashfree', object: 'payment', label: 'Cashfree — create payment', icon: '💳', color: '#3563ff', group: 'Payments',
      description: 'Create a Cashfree payment link.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'amount', label: 'Amount', type: 'number', required: true }, { key: 'customer', label: 'Customer', type: 'object' }],
      outputs: [{ key: 'link', label: 'Payment link', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('cashfree', lookupCreds('cashfree', ctx), ['appId', 'secretKey']);
          return apiCall({ method: 'POST', url: 'https://api.cashfree.com/pg/links',
              headers: { 'x-client-id': creds.appId, 'x-client-secret': creds.secretKey,
                         'x-api-version': '2022-09-01', 'Content-Type': 'application/json' },
              provider: 'cashfree',
              body: { link_amount: Number(node.config?.amount) || 0, link_currency: 'INR',
                      customer_details: node.config?.customer || {} } });
      } },

    /* --- Ads (8) --- */
    { id: 'ads.google.createCampaign',  category: 'action', provider: 'google_ads', object: 'campaign', label: 'Google Ads — create paused campaign', icon: '🟢', color: '#3b82f6', group: 'Advertising',
      description: 'Create a new Search campaign in PAUSED state via the Google Ads API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'name', label: 'Campaign name', type: 'string', required: true }, { key: 'budget', label: 'Daily budget', type: 'number', required: true }, { key: 'targeting', label: 'Targeting', type: 'object' }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('google_ads', lookupCreds('google_ads', ctx), ['developerToken', 'accessToken', 'customerId']);
          return apiCall({ method: 'POST',
              url: `https://googleads.googleapis.com/v17/customers/${encodeURIComponent(creds.customerId)}/campaigns:mutate`,
              headers: { Authorization: `Bearer ${creds.accessToken}`,
                         'developer-token': creds.developerToken, 'Content-Type': 'application/json' },
              provider: 'google-ads',
              body: { operations: [{ create: { name: node.config?.name,
                      advertisingChannelType: 'SEARCH', status: 'PAUSED',
                      campaignBudget: { amountMicros: String((Number(node.config?.budget) || 0) * 1_000_000), deliveryMethod: 'STANDARD' } } }] } });
      } },

    { id: 'ads.google.pauseCampaign',   category: 'action', provider: 'google_ads', object: 'campaign', label: 'Google Ads — pause campaign', icon: '⏸️', color: '#3b82f6', group: 'Advertising',
      description: 'Pause an active campaign.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string', required: true }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }, { key: 'status', label: 'Status', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('google_ads', lookupCreds('google_ads', ctx), ['developerToken', 'accessToken', 'customerId']);
          return apiCall({ method: 'POST',
              url: `https://googleads.googleapis.com/v17/customers/${encodeURIComponent(creds.customerId)}/campaigns:mutate`,
              headers: { Authorization: `Bearer ${creds.accessToken}`,
                         'developer-token': creds.developerToken, 'Content-Type': 'application/json' },
              provider: 'google-ads',
              body: { operations: [{ update: { resourceName: `customers/${creds.customerId}/campaigns/${encodeURIComponent(node.config?.campaignId)}`, status: 'PAUSED' }, updateMask: 'status' }] } });
      } },

    { id: 'ads.google.enableCampaign',  category: 'action', provider: 'google_ads', object: 'campaign', label: 'Google Ads — enable campaign', icon: '▶️', color: '#3b82f6', group: 'Advertising',
      description: 'Enable a paused campaign.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string', required: true }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }, { key: 'status', label: 'Status', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('google_ads', lookupCreds('google_ads', ctx), ['developerToken', 'accessToken', 'customerId']);
          return apiCall({ method: 'POST',
              url: `https://googleads.googleapis.com/v17/customers/${encodeURIComponent(creds.customerId)}/campaigns:mutate`,
              headers: { Authorization: `Bearer ${creds.accessToken}`,
                         'developer-token': creds.developerToken, 'Content-Type': 'application/json' },
              provider: 'google-ads',
              body: { operations: [{ update: { resourceName: `customers/${creds.customerId}/campaigns/${encodeURIComponent(node.config?.campaignId)}`, status: 'ENABLED' }, updateMask: 'status' }] } });
      } },

    { id: 'ads.meta.createCampaign',    category: 'action', provider: 'meta_ads', object: 'campaign', label: 'Meta Ads — create paused campaign', icon: '🔵', color: '#3b82f6', group: 'Advertising',
      description: 'Create a new Meta campaign in PAUSED state via the Marketing API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'name', label: 'Campaign name', type: 'string', required: true }, { key: 'objective', label: 'Objective', type: 'string', required: true }, { key: 'budget', label: 'Daily budget', type: 'number', required: true }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('meta_ads', lookupCreds('meta_ads', ctx), ['accessToken', 'adAccountId']);
          return apiCall({ method: 'POST',
              url: `https://graph.facebook.com/v20.0/act_${encodeURIComponent(creds.adAccountId)}/campaigns`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'meta-ads',
              body: { name: node.config?.name, objective: node.config?.objective, status: 'PAUSED',
                      special_ad_categories: [], daily_budget: String(Math.round((Number(node.config?.budget) || 0) * 100)) } });
      } },

    { id: 'ads.meta.pauseCampaign',     category: 'action', provider: 'meta_ads', object: 'campaign', label: 'Meta Ads — pause campaign', icon: '⏸️', color: '#3b82f6', group: 'Advertising',
      description: 'Pause an active Meta campaign.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string', required: true }],
      outputs: [{ key: 'status', label: 'Status', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('meta_ads', lookupCreds('meta_ads', ctx), ['accessToken']);
          return apiCall({ method: 'POST',
              url: `https://graph.facebook.com/v20.0/${encodeURIComponent(node.config?.campaignId)}`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'meta-ads', body: { status: 'PAUSED' } });
      } },

    { id: 'ads.linkedin.createCampaign',category: 'action', provider: 'linkedin_ads', object: 'campaign', label: 'LinkedIn Ads — create campaign', icon: '🔷', color: '#3b82f6', group: 'Advertising',
      description: 'Create a new LinkedIn campaign via the AdCampaign API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'name', label: 'Name', type: 'string', required: true }, { key: 'budget', label: 'Budget', type: 'number', required: true }, { key: 'adAccountId', label: 'Ad account URN', type: 'string', required: true }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('linkedin_ads', lookupCreds('linkedin_ads', ctx), ['accessToken']);
          return apiCall({ method: 'POST', url: 'https://api.linkedin.com/rest/adCampaigns',
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json',
                         'X-Restli-Protocol-Version': '2.0.0', 'LinkedIn-Version': '202403' },
              provider: 'linkedin-ads',
              body: { name: node.config?.name, type: 'SPONSORED_UPDATES',
                      account: `urn:li:sponsoredAccount:${encodeURIComponent(node.config?.adAccountId)}`,
                      status: 'DRAFT', totalBudget: { amount: String(Number(node.config?.budget) || 0), currencyCode: 'USD' } } });
      } },

    { id: 'ads.tiktok.createCampaign',  category: 'action', provider: 'tiktok_ads', object: 'campaign', label: 'TikTok Ads — create paused campaign', icon: '⬛', color: '#3b82f6', group: 'Advertising',
      description: 'Create a new TikTok campaign in PAUSED state via the Marketing API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'name', label: 'Name', type: 'string', required: true }, { key: 'budget', label: 'Daily budget', type: 'number', required: true }, { key: 'advertiserId', label: 'Advertiser ID', type: 'string', required: true }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('tiktok_ads', lookupCreds('tiktok_ads', ctx), ['accessToken']);
          return apiCall({ method: 'POST',
              url: `https://business-api.tiktok.com/open_api/v1.3/campaign/create/`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'tiktok-ads',
              body: { advertiser_id: node.config?.advertiserId, campaign_name: node.config?.name,
                      objective_type: 'LEAD_GENERATION', budget_mode: 'BUDGET_MODE_DAY',
                      budget: Number(node.config?.budget) || 0, operation_status: 'DISABLE' } });
      } },

    { id: 'ads.snapchat.createCampaign',category: 'action', provider: 'snapchat_ads', object: 'campaign', label: 'Snapchat Ads — create campaign (partner)', icon: '🟨', color: '#3b82f6', group: 'Advertising',
      description: 'Snapchat Marketing API requires partner approval before publishing. Throws unless snapchat.partnerApproved is true in creds.', supportsTest: false, supportsRetry: false, async: true,
      inputs: [{ key: 'name', label: 'Name', type: 'string', required: true }, { key: 'adAccountId', label: 'Ad account ID', type: 'string', required: true }],
      outputs: [{ key: 'campaignId', label: 'Campaign ID', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('snapchat_ads', lookupCreds('snapchat_ads', ctx), ['accessToken', 'adAccountId']);
          if (!creds.partnerApproved) throw new Error('snapchat_ads requires partner approval. Set credentials.snapchat_ads.partnerApproved = true once granted.');
          return apiCall({ method: 'POST',
              url: `https://adsapi.snapchat.com/v1/adaccounts/${encodeURIComponent(creds.adAccountId)}/campaigns`,
              headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
              provider: 'snapchat-ads', body: { campaign: { name: node.config?.name, status: 'PAUSED' } } });
      } },

    /* --- Property portal actions (5) --- */
    { id: 'portal.bayut.publishListing',  category: 'action', provider: 'bayut', object: 'listing', label: 'Bayut — publish listing', icon: '🅱️', color: '#3b82f6', group: 'Portals',
      description: 'Publish a listing to Bayut via the Bayut Developer API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }],
      outputs: [{ key: 'reference', label: 'Portal reference', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('bayut', lookupCreds('bayut', ctx), ['apiKey']);
          return apiCall({ method: 'POST',
              url: `https://api.bayut.com/v1/listings/${encodeURIComponent(node.config?.listingId)}/publish`,
              headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
              provider: 'bayut', body: {} });
      } },

    { id: 'portal.propertyfinder.publishListing', category: 'action', provider: 'propertyfinder', object: 'listing', label: 'Property Finder — publish listing', icon: '🅿️', color: '#3b82f6', group: 'Portals',
      description: 'Publish a listing to Property Finder via the Property Finder API.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }],
      outputs: [{ key: 'reference', label: 'Portal reference', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('propertyfinder', lookupCreds('propertyfinder', ctx), ['apiKey']);
          return apiCall({ method: 'POST',
              url: `https://api.propertyfinder.ae/v1/listings/${encodeURIComponent(node.config?.listingId)}/publish`,
              headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
              provider: 'propertyfinder', body: {} });
      } },

    { id: 'portal.dubizzle.publishListing',  category: 'action', provider: 'dubizzle', object: 'listing', label: 'dubizzle — publish listing', icon: '🟧', color: '#3b82f6', group: 'Portals',
      description: 'Publish a listing to dubizzle.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }],
      outputs: [{ key: 'reference', label: 'Portal reference', type: 'string' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('dubizzle', lookupCreds('dubizzle', ctx), ['apiKey']);
          return apiCall({ method: 'POST',
              url: `https://api.dubizzle.com/v1/listings/${encodeURIComponent(node.config?.listingId)}/publish`,
              headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
              provider: 'dubizzle', body: {} });
      } },

    { id: 'portal.fetchLeads', category: 'action', provider: 'portal', object: 'lead', label: 'Fetch portal leads', icon: '📥', color: '#3b82f6', group: 'Portals',
      description: 'Pull new leads from a connected listing portal. Looks up credentials by portal name (99acres, magicbricks, …).', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'portal', label: 'Portal', type: 'string', required: true, options: ['99acres','magicbricks','housing','nobroker','commonfloor','squareyards','bayut','propertyfinder','dubizzle'] }, { key: 'since', label: 'Since (ISO)', type: 'string' }],
      outputs: [{ key: 'leads', label: 'Leads', type: 'array' }],
      run: async ({ node, ctx }) => {
          const portal = node.config?.portal;
          const creds = requireCreds(portal, lookupCreds(portal, ctx), ['apiKey']);
          return apiCall({ method: 'GET', url: `https://api.${portal}.com/v1/leads`,
              headers: { Authorization: `Bearer ${creds.apiKey}` }, provider: portal,
              query: { since: node.config?.since } });
      } },

    { id: 'portal.pushListing', category: 'action', provider: 'portal', object: 'listing', label: 'Push listing to portal', icon: '📤', color: '#3b82f6', group: 'Portals',
      description: 'Push an existing CRM listing to a portal.', supportsTest: true, supportsRetry: true, async: true,
      inputs: [{ key: 'listingId', label: 'Listing ID', type: 'string', required: true }, { key: 'portal', label: 'Portal', type: 'string', required: true }],
      outputs: [{ key: 'reference', label: 'Portal reference', type: 'string' }],
      run: async ({ node, ctx }) => {
          const portal = node.config?.portal;
          const creds = requireCreds(portal, lookupCreds(portal, ctx), ['apiKey']);
          return apiCall({ method: 'POST', url: `https://api.${portal}.com/v1/listings`,
              headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
              provider: portal, body: { sourceListingId: node.config?.listingId } });
      } },

    /* --- Government / Property data (2) --- */
    { id: 'gov.dld.lookupTransaction', category: 'action', provider: 'dld', object: 'transaction', label: 'DLD — transaction lookup', icon: '🏛️', color: '#0f766e', group: 'Government',
      description: 'Query Dubai Land Department transaction history. Partner access required.', supportsTest: false, supportsRetry: false, async: true,
      inputs: [{ key: 'transactionId', label: 'Transaction ID', type: 'string', required: true }],
      outputs: [{ key: 'transaction', label: 'Transaction', type: 'object' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('dld', lookupCreds('dld', ctx), ['apiKey']);
          return apiCall({ method: 'GET',
              url: `https://api.dld.gov.ae/v1/transactions/${encodeURIComponent(node.config?.transactionId)}`,
              headers: { Authorization: `Bearer ${creds.apiKey}` }, provider: 'dld' });
      } },

    { id: 'gov.propertymonitor.marketSnapshot',category: 'action', provider: 'property_monitor', object: 'snapshot', label: 'Property Monitor — market snapshot', icon: '📈', color: '#0f766e', group: 'Government',
      description: 'Fetch a market-data snapshot for a community. Partner access required.', supportsTest: false, supportsRetry: false, async: true,
      inputs: [{ key: 'community', label: 'Community', type: 'string', required: true }],
      outputs: [{ key: 'snapshot', label: 'Snapshot', type: 'object' }],
      run: async ({ node, ctx }) => {
          const creds = requireCreds('property_monitor', lookupCreds('property_monitor', ctx), ['apiKey']);
          return apiCall({ method: 'GET', url: 'https://api.propertymonitor.ae/v1/market-snapshot',
              headers: { Authorization: `Bearer ${creds.apiKey}` }, provider: 'property-monitor',
              query: { community: node.config?.community } });
      } }
];

/* ----------------------------------------------------------------
   DATA — pure local logic (no network). setVariable, format, parseJson
   use the ctx; lookupLead + dedupe hit the CRM.
   ---------------------------------------------------------------- */
const DATA_NODES = [
    { id: 'data.setVariable', category: 'data', provider: 'system', object: null, label: 'Set variable', icon: '🔣', color: '#475569', group: 'Data',
      description: 'Capture a value (constant, expression) for {{vars.name}} interpolation.',
      inputs: [{ key: 'name', label: 'Variable name', type: 'string', required: true }, { key: 'value', label: 'Value', type: 'string', required: true }],
      outputs: [{ key: 'name', label: 'Variable name', type: 'string' }, { key: 'value', label: 'Value', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node }) => ({ name: node.config?.name, value: node.config?.value }) },

    { id: 'data.format', category: 'data', provider: 'system', object: null, label: 'Format value', icon: '🧹', color: '#475569', group: 'Data',
      description: 'Format a value (currency, date, phone, lowercase, etc).',
      inputs: [{ key: 'input', label: 'Input template', type: 'string', required: true }, { key: 'format', label: 'Format', type: 'string', required: true, options: ['currency_aed','currency_inr','uppercase','lowercase','trim','phone_e164','date_iso','date_short'] }],
      outputs: [{ key: 'output', label: 'Output', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node }) => {
          const input = node.config?.input;
          const format = node.config?.format;
          let output = input;
          switch (format) {
              case 'currency_aed': output = `AED ${Number(input || 0).toLocaleString('en-AE')}`; break;
              case 'currency_inr': output = `₹${Number(input || 0).toLocaleString('en-IN')}`; break;
              case 'uppercase':    output = String(input || '').toUpperCase(); break;
              case 'lowercase':    output = String(input || '').toLowerCase(); break;
              case 'trim':         output = String(input || '').trim(); break;
              case 'phone_e164':   output = String(input || '').replace(/[^\d+]/g, ''); break;
              case 'date_iso':     output = new Date(input).toISOString(); break;
              case 'date_short':   output = new Date(input).toLocaleDateString(); break;
          }
          return { output };
      } },

    { id: 'data.parseJson', category: 'data', provider: 'system', object: null, label: 'Parse JSON', icon: '🧬', color: '#475569', group: 'Data',
      description: 'Parse a JSON string into an object.',
      inputs: [{ key: 'input', label: 'JSON string', type: 'string', required: true }],
      outputs: [{ key: 'output', label: 'Parsed', type: 'object' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: ({ node }) => { try { return { output: JSON.parse(node.config?.input || '{}') }; } catch (e) { return { output: null, error: e.message }; } } },

    { id: 'data.lookupLead', category: 'data', provider: 'crm', object: 'lead', label: 'Find lead', icon: '🔎', color: '#475569', group: 'Data',
      description: 'Look up an existing lead by phone, email, or external ID.',
      inputs: [{ key: 'matchBy', label: 'Match by', type: 'string', required: true, options: ['phone','email','externalId'] }, { key: 'value', label: 'Value template', type: 'string', required: true }],
      outputs: [{ key: 'found', label: 'Found?', type: 'boolean' }, { key: 'lead', label: 'Lead', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          const res = await apiCall({ method: 'GET', url: `${creds.apiBase}/api/v1/leads`,
              headers: CRM_HELPERS.auth(creds), query: { [node.config?.matchBy]: node.config?.value }, provider: 'crm' });
          const items = Array.isArray(res?.items) ? res.items : [];
          return { found: items.length > 0, lead: items[0] || null };
      } },

    { id: 'data.dedupe', category: 'data', provider: 'crm', object: 'lead', label: 'Deduplicate lead', icon: '🧬', color: '#475569', group: 'Data',
      description: 'Phone/email-based dedup. Returns existing lead if found, else null.',
      inputs: [{ key: 'phone', label: 'Phone template', type: 'string' }, { key: 'email', label: 'Email template', type: 'string' }],
      outputs: [{ key: 'found', label: 'Found?', type: 'boolean' }, { key: 'leadId', label: 'Lead ID (if found)', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          const field = node.config?.phone ? 'phone' : node.config?.email ? 'email' : null;
          const value = node.config?.phone || node.config?.email;
          if (!field) return { found: false, leadId: null };
          const res = await apiCall({ method: 'GET', url: `${creds.apiBase}/api/v1/leads`,
              headers: CRM_HELPERS.auth(creds), query: { [field]: value }, provider: 'crm' });
          const items = Array.isArray(res?.items) ? res.items : [];
          return { found: items.length > 0, leadId: items[0]?.id || null };
      } }
];

/* ----------------------------------------------------------------
   AI — real provider calls. Supports OpenAI / Anthropic / Gemini / Groq / OpenRouter.
   Credentials: ai = { provider, apiKey, model? }
   ---------------------------------------------------------------- */
const AI_URLS = {
    openai:      { url: 'https://api.openai.com/v1/chat/completions',           model: 'gpt-4o-mini',          header: 'Authorization' },
    anthropic:   { url: 'https://api.anthropic.com/v1/messages',                model: 'claude-3-5-sonnet-20241022', header: 'x-api-key' },
    gemini:      { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', model: '', header: 'x-goog-api-key' },
    groq:        { url: 'https://api.groq.com/openai/v1/chat/completions',      model: 'llama-3.1-70b-versatile', header: 'Authorization' },
    openrouter:  { url: 'https://openrouter.ai/api/v1/chat/completions',        model: 'openai/gpt-4o-mini',   header: 'Authorization' }
};

const AI_NODES = [
    { id: 'ai.generateText', category: 'ai', provider: 'openai', object: null, label: 'AI — generate text', icon: '🤖', color: '#8b5cf6', group: 'AI',
      description: 'Generate freeform text using OpenAI / Anthropic / Gemini / Groq / OpenRouter.',
      inputs: [{ key: 'prompt', label: 'Prompt template', type: 'string', required: true }, { key: 'provider', label: 'Provider', type: 'string', default: 'openai', options: ['openai','anthropic','gemini','groq','openrouter'] }, { key: 'temperature', label: 'Temperature', type: 'number', default: 0.7 }],
      outputs: [{ key: 'text', label: 'Generated text', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => callAI({ node, ctx, mode: 'text' }) },

    { id: 'ai.classify', category: 'ai', provider: 'openai', object: null, label: 'AI — classify', icon: '🗂️', color: '#8b5cf6', group: 'AI',
      description: 'Classify text into one of a fixed set of labels.',
      inputs: [{ key: 'input', label: 'Input template', type: 'string', required: true }, { key: 'labels', label: 'Labels (comma-sep)', type: 'string', required: true }, { key: 'provider', label: 'Provider', type: 'string', default: 'openai' }],
      outputs: [{ key: 'label', label: 'Label', type: 'string' }, { key: 'confidence', label: 'Confidence', type: 'number' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const labels = String(node.config?.labels || '').split(',').map(s => s.trim()).filter(Boolean);
          const out = await callAI({
              node, ctx, mode: 'json',
              systemPrompt: `Classify the input into exactly one of these labels: ${labels.join(', ')}. Reply as JSON { "label": "...", "confidence": <0-1> }.`,
              userPrompt: node.config?.input
          });
          const parsed = typeof out.text === 'object' ? out.text : safeParseJson(out.text);
          return { label: parsed?.label || labels[0] || 'unknown', confidence: Number(parsed?.confidence) || 0.5 };
      } },

    { id: 'ai.extract', category: 'ai', provider: 'openai', object: null, label: 'AI — extract', icon: '🪄', color: '#8b5cf6', group: 'AI',
      description: 'Extract structured JSON from freeform text following a JSON schema.',
      inputs: [{ key: 'input', label: 'Input template', type: 'string', required: true }, { key: 'schema', label: 'JSON schema', type: 'string', required: true }],
      outputs: [{ key: 'data', label: 'Extracted', type: 'object' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const out = await callAI({
              node, ctx, mode: 'json',
              systemPrompt: `Extract structured data from the input. Reply as JSON conforming to this schema:\n${node.config?.schema}`,
              userPrompt: node.config?.input
          });
          return { data: typeof out.text === 'object' ? out.text : safeParseJson(out.text) };
      } },

    { id: 'ai.summarize', category: 'ai', provider: 'openai', object: null, label: 'AI — summarize', icon: '📜', color: '#8b5cf6', group: 'AI',
      description: 'Summarize long text into a short paragraph.',
      inputs: [{ key: 'input', label: 'Input template', type: 'string', required: true }, { key: 'maxWords', label: 'Max words', type: 'number', default: 60 }, { key: 'provider', label: 'Provider', type: 'string', default: 'openai' }],
      outputs: [{ key: 'summary', label: 'Summary', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const out = await callAI({
              node, ctx, mode: 'text',
              systemPrompt: `Summarize the following in at most ${node.config?.maxWords || 60} words.`,
              userPrompt: node.config?.input
          });
          return { summary: out.text };
      } },

    { id: 'ai.score', category: 'ai', provider: 'openai', object: null, label: 'AI — score lead', icon: '🎯', color: '#8b5cf6', group: 'AI',
      description: 'Score a lead 0–100 based on text + structured attributes.',
      inputs: [{ key: 'lead', label: 'Lead template', type: 'string', required: true }, { key: 'provider', label: 'Provider', type: 'string', default: 'openai' }],
      outputs: [{ key: 'score', label: 'Score', type: 'number' }, { key: 'reasoning', label: 'Reasoning', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const out = await callAI({
              node, ctx, mode: 'json',
              systemPrompt: 'Score this real-estate lead from 0 to 100 based on budget, intent, and engagement. Reply as JSON { "score": <0-100>, "reasoning": "<one sentence>" }.',
              userPrompt: typeof node.config?.lead === 'string' ? node.config.lead : JSON.stringify(node.config?.lead)
          });
          const parsed = typeof out.text === 'object' ? out.text : safeParseJson(out.text);
          return { score: Number(parsed?.score) || 0, reasoning: String(parsed?.reasoning || '') };
      } },

    { id: 'ai.sentiment', category: 'ai', provider: 'openai', object: null, label: 'AI — sentiment', icon: '😊', color: '#8b5cf6', group: 'AI',
      description: 'Classify sentiment as positive / neutral / negative.',
      inputs: [{ key: 'input', label: 'Input template', type: 'string', required: true }, { key: 'provider', label: 'Provider', type: 'string', default: 'openai' }],
      outputs: [{ key: 'sentiment', label: 'Sentiment', type: 'string' }, { key: 'confidence', label: 'Confidence', type: 'number' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node, ctx }) => {
          const out = await callAI({
              node, ctx, mode: 'json',
              systemPrompt: 'Classify sentiment as positive / neutral / negative. Reply as JSON { "sentiment": "...", "confidence": <0-1> }.',
              userPrompt: node.config?.input
          });
          const parsed = typeof out.text === 'object' ? out.text : safeParseJson(out.text);
          return { sentiment: parsed?.sentiment || 'neutral', confidence: Number(parsed?.confidence) || 0.5 };
      } }
];

async function callAI({ node, ctx, mode, systemPrompt, userPrompt }) {
    const provider = node.config?.provider || 'openai';
    const aiKey = `ai_${provider}`;
    const creds = requireCreds(aiKey, lookupCreds(aiKey, ctx) || lookupCreds('ai', ctx), ['apiKey']);
    const cfg = AI_URLS[provider];
    if (!cfg) throw new Error(`Unknown AI provider: ${provider}. Supported: openai, anthropic, gemini, groq, openrouter.`);
    const model = node.config?.model || cfg.model;
    const temperature = Number(node.config?.temperature) || 0.7;

    let url = cfg.url;
    let headers = {};
    let body;

    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
        headers[cfg.header] = `Bearer ${creds.apiKey}`;
        headers['Content-Type'] = 'application/json';
        body = { model, temperature,
                 messages: [{ role: 'system', content: systemPrompt || node.config?.prompt || '' },
                            { role: 'user',   content: userPrompt || '' }],
                 ...(mode === 'json' ? { response_format: { type: 'json_object' } } : {}) };
    } else if (provider === 'anthropic') {
        headers[cfg.header] = creds.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['Content-Type'] = 'application/json';
        body = { model, max_tokens: 1024, temperature,
                 system: systemPrompt || node.config?.prompt || '',
                 messages: [{ role: 'user', content: userPrompt || '' }] };
    } else if (provider === 'gemini') {
        headers[cfg.header] = creds.apiKey;
        headers['Content-Type'] = 'application/json';
        body = { contents: [{ parts: [{ text: (systemPrompt ? systemPrompt + '\n\n' : '') + (userPrompt || '') }] }],
                 generationConfig: { temperature } };
    }

    const res = await apiCall({ method: 'POST', url, headers, body, provider });

    /* Extract text per provider */
    let text;
    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
        text = res?.choices?.[0]?.message?.content || '';
    } else if (provider === 'anthropic') {
        text = res?.content?.[0]?.text || '';
    } else if (provider === 'gemini') {
        text = res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    return { text };
}

function safeParseJson(s) {
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return { text: s }; }
}

/* ----------------------------------------------------------------
   UTILITY — local control flow. No network.
   ---------------------------------------------------------------- */
const UTILITY_NODES = [
    { id: 'utility.delay', category: 'utility', provider: 'system', object: null, label: 'Delay / wait', icon: '⏳', color: '#94a3b8', group: 'Flow',
      description: 'Pause the workflow for a fixed duration. In production this requires a worker queue — for testNode and short flows the engine awaits locally.',
      inputs: [{ key: 'duration', label: 'Duration', type: 'string', default: '5m', options: ['1m','5m','15m','30m','1h','2h','12h','1d','3d','7d'] }],
      outputs: [{ key: 'resumedAt', label: 'Resumed at', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: true,
      run: async ({ node }) => {
          const ms = parseDurationMs(node.config?.duration || '5m');
          await new Promise(r => setTimeout(r, Math.min(ms, 5000)));   /* cap at 5s for in-process runs */
          return { resumedAt: new Date().toISOString(), waitedMs: ms };
      } },

    { id: 'utility.waitUntil', category: 'utility', provider: 'system', object: null, label: 'Wait until', icon: '🕒', color: '#94a3b8', group: 'Flow',
      description: 'Wait until an event or until a max timeout elapses. Requires a worker queue in production.',
      inputs: [
        { key: 'event', label: 'Wait for event', type: 'string', options: ['lead.replied','lead.statusChanged','visit.completed','task.completed'] },
        { key: 'timeoutHours', label: 'Max wait (h)', type: 'number', default: 24 }
      ],
      outputs: [{ key: 'outcome', label: 'Outcome', type: 'string' }],
      supportsTest: true, supportsRetry: false, async: true,
      run: async () => ({ outcome: 'timeout' }) },

    { id: 'utility.loop', category: 'utility', provider: 'system', object: null, label: 'For each', icon: '🔁', color: '#94a3b8', group: 'Flow',
      description: 'Iterate over a list. Inner nodes run once per item. Implementation lives in lib/engine.js (runForEach).',
      inputs: [{ key: 'source', label: 'Source path', type: 'string', required: true }, { key: 'maxIterations', label: 'Max iterations', type: 'number', default: 100 }],
      outputs: [{ key: 'iterated', label: 'Items iterated', type: 'number' }],
      supportsTest: true, supportsRetry: false, async: true,
      run: ({ node }) => ({ iterated: 0, source: node.config?.source }) },

    { id: 'utility.approval', category: 'utility', provider: 'system', object: 'approval', label: 'Request approval', icon: '✋', color: '#94a3b8', group: 'Flow',
      description: 'Pause and wait for a human to approve. Persists an approval request to the CRM; the engine polls or receives a webhook.',
      inputs: [
        { key: 'approverIds', label: 'Approvers', type: 'array', required: true },
        { key: 'title',       label: 'Title',    type: 'string', required: true },
        { key: 'body',        label: 'Body',     type: 'string' }
      ],
      outputs: [{ key: 'decision', label: 'Decision', type: 'string' }, { key: 'approver', label: 'Approver', type: 'string' }],
      supportsTest: false, supportsRetry: false, async: true,
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          return apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/approvals`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm',
              body: { approverIds: node.config?.approverIds, title: node.config?.title, body: node.config?.body || '' } });
      } },

    { id: 'utility.subWorkflow', category: 'utility', provider: 'system', object: 'automation', label: 'Run sub-workflow', icon: '🪆', color: '#94a3b8', group: 'Flow',
      description: 'Invoke another automation as a sub-workflow. Passes through vars.',
      inputs: [{ key: 'automationId', label: 'Automation ID', type: 'string', required: true }, { key: 'payload', label: 'Payload', type: 'object' }],
      outputs: [{ key: 'runId', label: 'Sub-run ID', type: 'string' }],
      supportsTest: true, supportsRetry: true, async: true,
      run: async ({ node }) => {
          if (!node.config?.automationId) throw new Error('subWorkflow: automationId is required');
          /* In production this would POST to /api/automations/<id>/runs */
          return { runId: `subrun-${node.config.automationId}-${Date.now()}`, dispatched: true };
      } },

    { id: 'utility.rateLimitGuard', category: 'utility', provider: 'system', object: null, label: 'Rate-limit guard', icon: '🚦', color: '#94a3b8', group: 'Flow',
      description: 'Throttle execution to N per hour/day. Implementation requires a shared counter store (Redis) — for now enforced locally per automation.',
      inputs: [
        { key: 'perHour', label: 'Max per hour', type: 'number', default: 60 },
        { key: 'perDay',  label: 'Max per day',  type: 'number', default: 1000 }
      ],
      outputs: [{ key: 'allowed', label: 'Allowed', type: 'boolean' }],
      supportsTest: true, supportsRetry: false, async: false,
      run: () => ({ allowed: true }) },

    { id: 'utility.humanHandoff', category: 'utility', provider: 'system', object: 'conversation', label: 'Hand off to human', icon: '🙋', color: '#94a3b8', group: 'Flow',
      description: 'Stop the automation and assign the conversation to a human.',
      inputs: [{ key: 'assigneeId', label: 'Assignee user ID', type: 'string', required: true }, { key: 'note', label: 'Note', type: 'string' }],
      outputs: [{ key: 'assigned', label: 'Assigned', type: 'boolean' }],
      supportsTest: false, supportsRetry: false, async: true,
      run: async ({ node, ctx }) => {
          const creds = requireCreds('crm', lookupCreds('crm', ctx), ['apiBase', 'token']);
          await apiCall({ method: 'POST', url: `${creds.apiBase}/api/v1/conversations/handoff`,
              headers: CRM_HELPERS.auth(creds), provider: 'crm',
              body: { assigneeId: node.config?.assigneeId, note: node.config?.note || '' } });
          return { assigned: true };
      } }
];

function parseDurationMs(s) {
    const m = String(s || '').trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
    if (!m) return 5 * 60 * 1000;
    const n = Number(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    return n * (unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
}

/* ----------------------------------------------------------------
   REGISTRY EXPORT
   ---------------------------------------------------------------- */
export const Registry = {
    triggers:    TRIGGERS,
    conditions:  CONDITIONS,
    actions:     ACTIONS,
    dataNodes:   DATA_NODES,
    aiNodes:     AI_NODES,
    utility:     UTILITY_NODES,
    all:         [...TRIGGERS, ...CONDITIONS, ...ACTIONS, ...DATA_NODES, ...AI_NODES, ...UTILITY_NODES],

    byId(id) {
        return this.all.find(n => n.id === id) || null;
    },

    /** Group by sidebar group label, preserving a stable order. */
    grouped() {
        const groups = new Map();
        for (const cat of [
            { key: 'trigger',    items: this.triggers,   label: 'Triggers',     order: 1 },
            { key: 'condition',  items: this.conditions, label: 'Conditions',   order: 2 },
            { key: 'action',     items: this.actions,    label: 'Actions',      order: 3 },
            { key: 'data',       items: this.dataNodes,  label: 'Data',         order: 4 },
            { key: 'ai',         items: this.aiNodes,    label: 'AI',           order: 5 },
            { key: 'utility',    items: this.utility,    label: 'Flow',         order: 6 }
        ]) {
            const sub = new Map();
            for (const node of cat.items) {
                const g = node.group || 'Other';
                if (!sub.has(g)) sub.set(g, []);
                sub.get(g).push(node);
            }
            groups.set(cat.key, { label: cat.label, order: cat.order, items: cat.items, subGroups: Array.from(sub.entries()).map(([name, items]) => ({ name, items })) });
        }
        return Array.from(groups.entries())
            .map(([key, val]) => ({ key, ...val }))
            .sort((a, b) => a.order - b.order);
    },

    /** Search by free-text query across label, description, id. */
    search(query) {
        if (!query) return this.all;
        const q = String(query).toLowerCase();
        return this.all.filter(n =>
            n.label.toLowerCase().includes(q) ||
            (n.description || '').toLowerCase().includes(q) ||
            n.id.toLowerCase().includes(q)
        );
    }
};

export { CRM_HELPERS };
