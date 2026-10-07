/* ============================================================
   ids.js — id generation + formatters
   Framework-free. Imported by smoke test + browser bundle.
   Uses globalThis.crypto.getRandomValues (available in modern
   browsers and Node ≥ 15.6); falls back to Math.random only
   if even that is missing.
   ============================================================ */

let _cryptoRef = null;
function _crypto() {
    if (_cryptoRef !== null) return _cryptoRef;
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        _cryptoRef = globalThis.crypto;
        return _cryptoRef;
    }
    _cryptoRef = {
        getRandomValues(arr) {
            for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
            return arr;
        }
    };
    return _cryptoRef;
}

export function genId(prefix) {
    const buf = new Uint8Array(6);
    _crypto().getRandomValues(buf);
    let out = '';
    for (const b of buf) out += b.toString(36).padStart(2, '0');
    return `${prefix}-${out.slice(0, 10)}`;
}

export function nowIso() {
    return new Date().toISOString();
}

export function fmtNum(n) {
    if (n == null) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
}

export function fmtMs(n) { return n == null ? '—' : `${n}ms`; }

export function fmtPct(n) {
    if (n == null) return '—';
    return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

export function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtRelative(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return iso;
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30)  return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

export function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* Compact, deterministic short-token used in URLs and webhook tokens. */
export function shortToken(bytes = 12) {
    const buf = new Uint8Array(bytes);
    _crypto().getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}
