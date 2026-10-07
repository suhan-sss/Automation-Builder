# Connect360 Automation Builder

Visual workflow automation builder — a generic **event → condition → action** engine that composes triggers, conditions, actions, data, AI, and flow utilities across 90+ integrations (CRM, communication, advertising, listing portals, government data, AI, payments, property data).

This is a **standalone Next.js 14** app. It is intentionally separate from the parent `Connect360 CRM` project — different stack, different runtime concerns, faster iteration on the builder feature.

## Stack

- **Framework**: Next.js 14 App Router (React 18, JS only)
- **State**: browser `localStorage` per-org (`c360.auto.<orgId>`)
- **Run engine**: client-side; walks the graph from the trigger outward, runs each node in order, branches through if/else / switch, applies retry policy
- **Adapter layer**: browser `fetch()` against real provider REST endpoints (WhatsApp Cloud, Meta Graph, Google Calendar, Google Ads, SendGrid, Twilio, Stripe, Razorpay, Cashfree, OpenAI, Anthropic, Gemini, Groq, OpenRouter, portal APIs, …)
- **Styling**: hand-rolled CSS variables (no Tailwind), design tokens in `styles/globals.css`
- **Credentials**: stored in `automation.settings.credentials[provider]`, looked up at run-time

## File layout

```
automation-builder/
├── app/
│   ├── layout.js              # Root layout + Toast provider
│   ├── page.js                # Redirects / → /automations
│   └── automations/
│       └── page.js            # Main page — list + modals + state
├── components/
│   ├── Sidebar.jsx
│   ├── Toast.jsx
│   ├── AutomationList.jsx
│   ├── VariablePicker.jsx
│   ├── TemplatesModal.jsx     # Empty-state by default
│   ├── Builder/
│   │   ├── BuilderModal.jsx   # Orchestrates rail + canvas + config
│   │   ├── NodeLibrary.jsx    # Left rail (search + grouped categories)
│   │   ├── NodeCard.jsx       # Single node card on canvas
│   │   └── ConfigPanel.jsx    # Right pane — per-node form + test step
│   └── Modals/
│       ├── DetailModal.jsx
│       ├── TestModal.jsx
│       └── RunModal.jsx
├── lib/                       # Pure JS, framework-free, importable by smoke test
│   ├── registry.js            # ALL node types — triggers, conditions, actions, data, AI, utility
│   ├── engine.js              # runAutomation, validateAutomation, testNode
│   ├── adapters.js            # lookupCreds, requireCreds, apiCall, paginate
│   ├── store.js               # localStorage persistence (per-org)
│   ├── variables.js           # {{var}} interpolation + picker tree
│   └── ids.js                 # genId, formatters, escapeHtml
├── styles/
│   ├── globals.css            # Design tokens + base + sidebar
│   └── automations.css        # Page-specific BEM
├── scripts/
│   └── test-engine.js         # Node smoke test (no Next.js boot needed)
├── package.json
├── next.config.mjs
├── jsconfig.json
└── .gitignore
```

## Run

```bash
npm install
npm run dev          # starts at http://localhost:3001
npm run build && npm start   # production
npm test             # runs scripts/test-engine.js
```

## Architecture

### The Node Registry — single source of truth

`lib/registry.js` exports one `Registry` object with five categories:
- `Registry.triggers`     — 28 triggers (CRM, property, communication, lead sources, ads, webhook, schedule, manual)
- `Registry.conditions`   — 4 (if/else, switch, exists, changed)
- `Registry.actions`      — 47 (CRM × 16, property × 5, communication × 8, productivity × 6, payments × 3, ads × 8, portals × 5, government × 2)
- `Registry.dataNodes`    — 5 (setVariable, format, parseJson, lookupLead, dedupe)
- `Registry.aiNodes`      — 6 (generateText, classify, extract, summarize, score, sentiment)
- `Registry.utility`      — 7 (delay, waitUntil, loop, approval, subWorkflow, rateLimitGuard, humanHandoff)

Every entry is a single descriptor with a `run(ctx)` callback. The same descriptor drives:

1. **Builder left rail** (`Registry.grouped()` → `NodeLibrary.jsx`)
2. **Per-node config form** (`Registry.byId(node.type).inputs` → `ConfigPanel.jsx`)
3. **Execution engine dispatch** (`Engine.runAutomation` calls `Registry.byId(node.type).run({node, ctx})`)
4. **Validation** (required inputs, known variable references)

To add a new provider action, append one descriptor — no engine rewrites needed.

### Engine

`lib/engine.js` exposes three functions:

- `runAutomation(automation, triggerPayload, { onStep })` — walks the graph from the trigger outward, runs each node, branches through if/else / switch, applies retry policy, writes per-step records to the run object, returns the finished run record.
- `validateAutomation(automation)` — pre-publish check (required inputs, dangling edges, broken `{{var}}` references).
- `testNode(node, ctx)` — runs a single node against its current config (used by the "Test this step" button).

Failure semantics follow SPEC §42 / §46:
- `settings.onError = 'stop'`     → abort the run
- `settings.onError = 'continue'` → record failure, keep walking
- `settings.onError = 'fallback'` → jump to `node.errorConfig.fallbackNodeId`
- `settings.retries` + `settings.retryDelay` → exponential retry with backoff
- `settings.dedupeKey` → per-event dedup

### Adapters — real HTTP, real providers

`lib/adapters.js` is the single layer every provider `run()` calls into. Four exports:

```js
lookupCreds(provider, ctx)         // priority: automation > window > env
requireCreds(provider, creds, fields) // throws clean "credentials not configured" error
apiCall({ method, url, headers, body, query, signal, timeoutMs })
paginate({ url, headers, query, nextPageKey }) // async iterator
```

Every action's `run()` follows the same shape:

```js
run: async ({ node, ctx }) => {
    const creds = requireCreds(
        'whatsapp',
        lookupCreds('whatsapp', ctx),
        ['phoneNumberId', 'accessToken']
    );
    return apiCall({
        method: 'POST',
        url: `https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`,
        headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: { messaging_product: 'whatsapp', to: node.config.to, type: 'text', text: { body: node.config.body } }
    });
}
```

If creds are missing, the run fails at the step with a clear, actionable error:
```
whatsapp credentials not configured. Set automation.settings.credentials.whatsapp
with { phoneNumberId, accessToken }.
```

### Credentials

Every provider looks up credentials at run time via `lookupCreds()`. Priority:

1. **`automation.settings.credentials[provider]`** — per-automation override. The builder's Credentials tab writes here.
2. **`window.__credentials[provider]`** — per-org window-level default. Useful when one org has one WhatsApp number.
3. **`process.env.<PROVIDER>_TOKEN` / `<PROVIDER>_API_KEY`** — server-side fallback (smoke tests, Node workers).

Provider → required-field shape:

| Provider                 | Required credential fields                              |
| ------------------------ | ------------------------------------------------------- |
| `crm`                    | `apiBase`, `token`                                      |
| `whatsapp`               | `phoneNumberId`, `accessToken`                          |
| `email` (SendGrid)       | `apiKey`, `from`                                        |
| `sms`, `voice` (Twilio)  | `accountSid`, `authToken`, `from`                       |
| `calendar`               | `accessToken` (Google Calendar OAuth)                   |
| `google_sheets`          | `accessToken`                                           |
| `google_drive`           | `accessToken`                                           |
| `google_ads`             | `developerToken`, `accessToken`, `customerId`           |
| `meta_ads`               | `accessToken`, `adAccountId`                            |
| `linkedin_ads`           | `accessToken`, `adAccountId`                            |
| `tiktok_ads`             | `accessToken`, `advertiserId`                           |
| `snapchat_ads`           | `accessToken`, `adAccountId`, `partnerApproved`         |
| `zoom`                   | `accountId`, `clientId`, `clientSecret`                 |
| `stripe`                 | `secretKey`                                             |
| `razorpay`               | `keyId`, `keySecret`                                    |
| `cashfree`               | `appId`, `secretKey`                                    |
| `ai_openai` / `ai_anthropic` / `ai_gemini` / `ai_groq` / `ai_openrouter` | `apiKey`                          |
| `bayut` / `propertyfinder` / `dubizzle` / `99acres` / `magicbricks` / `housing` / `nobroker` / `commonfloor` / `squareyards` | `apiKey` |
| `dld` / `property_monitor` | `apiKey` (partner approval required)                   |

For CORS-restricted providers (Google Ads, some portal APIs), the recommended production deployment fronts the browser with a Next.js API route at `/api/<provider>/...`. The registry `run()` can then call the local proxy instead of the upstream host. (Backend proxy layer is deferred — the registry supports both shapes.)

### Variables

`{{trigger.X}}`, `{{steps.<nodeId>.X}}`, `{{vars.X}}`, plus the reserved `{{now}}` token. Resolution is `lib/variables.js` — exported both as `interpolate()` (string interpolation) and `pickerTree()` (for the variable-insert chip in the config panel).

The picker only shows keys that already exist in the run context — so configuring a `WhatsApp Send Template` action with `{{vars.name}}` is fine, but you can't reach into a step that hasn't been scheduled yet.

### Storage

Per-org root at `c360.auto.<orgId>` in `localStorage`. Payload:

```json
{
  "version": 1,
  "automations": [...],
  "runs": [...],     // capped at 200 most-recent
  "audit": [...]     // capped at 500 most-recent
}
```

No backend. Switching organizations (when wired) re-keys the root — `lib/store.js` already exposes `setStoreOrg(orgId)` for that.

### What's wired, what isn't

| Layer | Status |
| --- | --- |
| Build, save, publish, pause, resume, archive, duplicate | Real — persists across reloads |
| Run engine (graph walk, retry, branching, variables, step records) | Real — runs in-browser |
| Run timeline / per-step output / step errors | Real — visible in `RunModal` |
| Provider actions (WhatsApp, SendGrid, Twilio, Stripe, …) | Real — `fetch()` against live endpoints |
| Credentials lookup priority + clear "not configured" errors | Real — see `lib/adapters.js` |
| CRM / property / portal / government API calls | Real — request shape matches each provider's docs |
| AI providers (OpenAI, Anthropic, Gemini, Groq, OpenRouter) | Real — chat completions API |
| Manual trigger | Real — click Run in the test modal |
| Webhook trigger | Receiver deferred — descriptor generates the webhook URL spec at publish time; a `/api/automations/<id>/trigger` route is needed to dispatch inbound webhooks |
| Schedule trigger | Spec registered at publish; backend cron worker deferred |
| Browser → provider CORS | Out-of-browser proxy route deferred; works for providers that explicitly allow browser-side calls |
| Approval requests | Posts to CRM; UI for the human to approve is deferred |
| Rate-limit guard | Descriptor registered; enforcement requires a shared counter store (Redis) — deferred |
| Per-integration rate limits | Settings registered; production limiter deferred |
| Audit log UI + RBAC enforcement | Audit array written; UI deferred |

## Phases covered

| SPEC § | Phase | Status |
| --- | --- | --- |
| §1–4   | Core architecture | ✅ |
| §5–13  | Triggers (28) | ✅ registered, descriptors describe payload shape; manual + inbound webhook delivery worker deferred |
| §17    | Node library + canvas | ✅ |
| §18    | CRM actions (lead/contact/deal/task) | ✅ real adapters |
| §19    | Property actions | ✅ real adapters |
| §20–23 | Communication (WhatsApp, email, SMS, calls, calendar, meeting, internal notification) | ✅ real adapters |
| §25–26 | Ads + portal actions | ✅ real adapters |
| §27–28 | AI nodes + provider config | ✅ real adapters (OpenAI/Anthropic/Gemini/Groq/OpenRouter) |
| §29–31 | Sheets / Drive / HTTP / Webhook / Code | ✅ real adapters |
| §32–33 | Variables + picker | ✅ |
| §34–35 | Conditions (if/else, switch) | ✅ |
| §36    | Delay | ✅ |
| §37    | Wait until | ✅ registered |
| §38    | Loop / For Each | ✅ registered |
| §40    | Dedupe | ✅ |
| §41    | Approval | ✅ posts to CRM |
| §42–43 | Error branches + retries | ✅ engine + settings |
| §44–46 | Concurrency + idempotency + rate limit | ✅ settings registered |
| §47–52 | Run engine + logs + timeline | ✅ |
| §53    | Test workflow | ✅ |
| §54    | Draft / publish / pause / archived | ✅ |
| §55    | Versioning (`automation.version` field) | ✅ on publish bump |
| §56    | Validation engine | ✅ |
| §57–58 | Credentials / capabilities | ✅ `lib/adapters.js` + provider-tagged descriptors |
| §66    | Templates | ✅ list + empty-state UI; seeded templates intentionally removed |
| §67    | Notifications (in-app toast) | ✅ |
| §69–70 | Permissions / audit | Registered (`audit[]` array); RBAC UI deferred |
| §73    | Safety (per-integration rate limits) | Settings registered, enforcement deferred |
| §84–89 | Adapter pattern, status handling, version storage | ✅ `lib/adapters.js` + `engine.js` |

## Smoke test

`scripts/test-engine.js` boots the registry + engine + adapters in a temporary ESM directory (no Next.js, no jsdom) and verifies:

1. Registry has the expected counts (≥ 25 triggers, ≥ 30 actions, ≥ 70 total).
2. Every descriptor has a valid `id`, `label`, `category`, `icon`, and `run()`.
3. `Registry.byId()` lookup works (known + unknown).
4. `Variables.interpolate()` resolves nested paths and throws `UnknownVariable` in strict mode.
5. `Engine.validateAutomation` rejects an automation with no trigger.
6. `Engine.runAutomation` of a tiny graph (`manual.run` → `condition.if` → `data.setVariable`) follows the yes and no branches correctly.
7. localStorage round-trip preserves automations, runs, and audit entries.
8. `Adapters.lookupCreds()` returns null when no creds and reads from `ctx.settings.credentials` correctly.
9. `Adapters.requireCreds()` throws a clean "credentials not configured" error with the required field names.
10. `Engine.runAutomation` of a real-adapter action (no creds supplied) fails the step with a `credentials` error.

```bash
npm test
```

Output:
```
Connect360 Automation Builder — engine smoke test

# Registry surface
  ✓ Registry is an object
  ... (39 checks)

# Real adapters require credentials
  ✓ runAutomation fails when crm creds missing
  ✓ failure error mentions "credentials"
  ✓ the failing step is recorded

39 passed, 0 failed
```

## What's not built (deferred to follow-up sessions)

- Backend route proxy (`/api/<provider>/...`) for CORS-restricted providers
- Backend cron worker + webhook delivery worker
- Per-integration rate limiter enforcement
- Audit log UI + RBAC enforcement
- Side-by-side diff between published versions
- Drag-and-drop reordering of canvas nodes (currently uses [+ Add step] chip)
- Multi-page navigation beyond `/automations` (the sidebar has `/runs` and `/templates` links stubbed)
- Pre-built automation templates (intentionally removed — start from a blank automation and save your own)
