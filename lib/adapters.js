/* ============================================================
   adapters.js — real HTTP layer for the automation registry.

   Every provider action's `run()` calls `apiCall({...})` after
   looking up credentials via `lookupCreds('provider', ctx)`. If
   credentials are missing the call throws a clear error before
   any HTTP request is made — the engine surfaces it in the run
   timeline.

   Credential lookup priority:
     1. automation.settings.credentials[provider]   — per-automation override
     2. globalThis.__credentials?.[provider]        — per-org window-level
     3. process.env.<PROVIDER_TOKEN>                — server-side fallback

   Framework-free, importable from the smoke test. Pure ESM.
   ============================================================ */

/* ----------------------------------------------------------------
   1. Credential lookup
   ---------------------------------------------------------------- */

/**
 * Resolve credentials for a provider.
 *
 * @param {string} provider   e.g. 'whatsapp', 'openai', 'crm'
 * @param {object} ctx        the run ctx (ctx.settings or ctx.automation.settings)
 * @returns {object|null}     { source, ...fields } or null
 */
export function lookupCreds(provider, ctx) {
    if (!provider) return null;

    /* 1. Per-automation override (ctx.settings.credentials OR ctx.automation.settings.credentials) */
    const ctxCreds =
        ctx?.settings?.credentials?.[provider] ||
        ctx?.automation?.settings?.credentials?.[provider];
    if (ctxCreds && typeof ctxCreds === 'object') {
        return { source: 'automation', ...ctxCreds };
    }

    /* 2. Window-level org credentials (browser runtime) */
    if (typeof globalThis !== 'undefined' && globalThis.__credentials) {
        const w = globalThis.__credentials[provider];
        if (w && typeof w === 'object') return { source: 'window', ...w };
    }

    /* 3. Environment variable fallback (Node smoke test) */
    if (typeof process !== 'undefined' && process.env) {
        const env = process.env;
        const envKey = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
        if (env[envKey]) return { source: 'env', token: env[envKey] };
        /* Also try a generic <PROVIDER>_API_KEY */
        const apiKey = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
        if (env[apiKey]) return { source: 'env', apiKey: env[apiKey] };
    }

    return null;
}

/**
 * Throw a consistent "credentials not configured" error.
 * Caller is responsible for checking lookupCreds() first.
 */
export function requireCreds(provider, creds, fields = []) {
    if (!creds) {
        throw new Error(
            `${provider} credentials not configured. ` +
            `Set automation.settings.credentials.${provider} or window.__credentials.${provider} ` +
            `with ${fields.length ? `{ ${fields.join(', ')} }` : 'the required fields'}.`
        );
    }
    for (const f of fields) {
        if (creds[f] == null || creds[f] === '') {
            throw new Error(
                `${provider} credential '${f}' is missing. ` +
                `Set automation.settings.credentials.${provider}.${f}.`
            );
        }
    }
    return creds;
}

/* ----------------------------------------------------------------
   2. HTTP call
   ---------------------------------------------------------------- */

/**
 * Make an HTTP request to a provider API. Returns parsed JSON if the
 * response is JSON, otherwise the text body. Throws on non-2xx with
 * a structured error: { provider, status, message, body }.
 *
 * @param {object}  opts
 * @param {string}  opts.method     HTTP verb (default 'GET')
 * @param {string}  opts.url        absolute URL
 * @param {object}  [opts.headers]  additional headers
 * @param {object}  [opts.query]    query-string params (object)
 * @param {object|string}  [opts.body]  request body (auto-JSON.stringify if object)
 * @param {string}  [opts.provider]  provider tag for error messages
 * @param {AbortSignal} [opts.signal]  optional abort signal
 * @param {number}  [opts.timeoutMs]  request timeout (default 30000)
 * @returns {Promise<object|string>}
 */
export async function apiCall(opts) {
    const {
        method = 'GET',
        url,
        headers = {},
        query,
        body,
        provider = 'http',
        signal,
        timeoutMs = 30000
    } = opts || {};

    if (!url) throw new Error(`apiCall: 'url' is required`);

    /* Build URL with query string */
    let fullUrl = url;
    if (query && typeof query === 'object') {
        const qs = Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
        if (qs) fullUrl += (url.includes('?') ? '&' : '?') + qs;
    }

    /* Build headers */
    const finalHeaders = { Accept: 'application/json', ...headers };
    let finalBody = body;
    if (body !== undefined && typeof body === 'object' && !(body instanceof FormData)) {
        finalBody = JSON.stringify(body);
        if (!('Content-Type' in finalHeaders) && !('content-type' in finalHeaders)) {
            finalHeaders['Content-Type'] = 'application/json';
        }
    }

    /* Timeout via AbortSignal */
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const linkedSignal = signal || ctrl.signal;

    let res;
    try {
        res = await fetch(fullUrl, {
            method,
            headers: finalHeaders,
            body: finalBody,
            signal: linkedSignal
        });
    } catch (e) {
        clearTimeout(timer);
        const msg = e.name === 'AbortError' ? `request timed out after ${timeoutMs}ms` : e.message;
        const err = new Error(`${provider} ${method} ${fullUrl} — ${msg}`);
        err.provider = provider;
        err.status = 0;
        err.cause = e;
        throw err;
    }
    clearTimeout(timer);

    /* Parse body */
    const text = await res.text();
    let parsed;
    if (text) {
        try { parsed = JSON.parse(text); }
        catch { parsed = text; }
    } else {
        parsed = null;
    }

    if (!res.ok) {
        const msg = (parsed && parsed.error && parsed.error.message) ||
                    (parsed && parsed.message) ||
                    (typeof parsed === 'string' ? parsed : res.statusText);
        const err = new Error(`${provider} ${method} ${fullUrl} — ${res.status} ${msg}`);
        err.provider = provider;
        err.status = res.status;
        err.body = parsed;
        err.response = res;
        throw err;
    }

    return parsed;
}

/* ----------------------------------------------------------------
   3. Pagination helper (async iterator)
   ---------------------------------------------------------------- */

/**
 * Iterate over a paginated list endpoint. Yields the array of items
 * from each page until the `nextPageKey` is absent from the response.
 *
 * @example
 *   for await (const items of paginate({
 *       url: 'https://api.example.com/items',
 *       headers: { Authorization: 'Bearer ...' },
 *       nextPageKey: 'nextPageToken'
 *   })) { ... }
 *
 * @param {object}  opts
 * @param {string}  opts.url           base URL
 * @param {object}  [opts.headers]     request headers
 * @param {object}  [opts.query]       extra query params (pageToken added per page)
 * @param {string}  [opts.itemsKey='items']     where the items array lives in the response
 * @param {string}  [opts.nextPageKey='nextPageToken']  where the next-page cursor lives
 * @param {number}  [opts.pageSize=100]
 * @param {string}  [opts.provider]
 */
export async function* paginate(opts) {
    const {
        url,
        headers = {},
        query = {},
        itemsKey = 'items',
        nextPageKey = 'nextPageToken',
        pageSize = 100,
        provider = 'http'
    } = opts || {};

    let token = null;
    while (true) {
        const q = { ...query, pageSize };
        if (token) q.pageToken = token;
        const page = await apiCall({ url, headers, query: q, provider });
        const items = page?.[itemsKey] || [];
        yield items;
        const next = page?.[nextPageKey];
        if (!next) break;
        token = next;
    }
}
