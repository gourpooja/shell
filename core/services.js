// ================================================================
// core/services.js
// Shared utilities for all shell page modules.
// Import only what you need:
//   import { pgFetch, showToast, fmtDate, getActiveSession } from '../core/services.js';
//
// Add new shared helpers here as pages need them — that way a fix
// (e.g. to the PostgREST base URL) happens in ONE place instead of
// being copy-pasted across every page module.
// ================================================================

// PostgREST endpoint — same host the dashboard itself calls (DB.config.nexus.url
// once a user logs in, but pages that don't need RBAC-scoped queries can just
// hit this directly). If this ever moves, it changes here once.
const PG_BASE = 'http://10.205.50.15:3000';

/**
 * Fetch wrapper for PostgREST. Throws on non-2xx so callers can
 * catch() and show a toast instead of silently failing.
 *
 * Example:
 *   const rows = await pgFetch('/sanction_header?limit=5');
 *   const updated = await pgFetch('/process_detail?id=eq.123', {
 *     method: 'PATCH',
 *     headers: { Prefer: 'return=representation' },
 *     body: JSON.stringify({ pending_with: 'AEN' })
 *   });
 */
export async function pgFetch(path, options = {}) {
  const res = await fetch(`${PG_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PostgREST ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Shows a small toast in the bottom-right corner. Reuses one element
 * across calls so rapid-fire toasts don't stack up.
 *   showToast('Saved');
 *   showToast('Could not save', 'error');
 */
export function showToast(message, type = 'success') {
  let el = document.querySelector('.shell-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast shell-toast';
    document.body.appendChild(el);
  }
  const colors = {
    success: 'var(--accent-green)',
    error: 'var(--accent-red)',
    info: 'var(--accent-blue)',
  };
  el.style.background = colors[type] || colors.success;
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

/**
 * Formats an ISO date string for display (DD MMM YYYY, en-IN style).
 * Returns an em-dash for null/undefined so table cells don't show "Invalid Date".
 */
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Reads the saved Nexus (PostgREST) connection config — the same
 * localStorage.drgsbc_db_config key v16's Settings → Database tab
 * writes to (and Tree Explorer already reads). Shape:
 *   { nexus: { url, key }, sheets: { url } }
 * Returns null if nothing's been configured yet.
 */
export function getDbConfig() {
  try {
    const raw = localStorage.getItem('drgsbc_db_config');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Parses the plain-text DB config file format (KEY = value lines,
 * '#' comments, blank lines ignored) into a flat object of uppercase
 * keys — e.g. { NEXUS_URL: '...', NEXUS_ANON_KEY: '...', SHEETS_URL: '...' }.
 * Shared by Settings' Database tab and the login modal's first-time
 * setup view, so both accept the exact same file unmodified.
 */
export function dbConfigParseText(text) {
  const result = {};
  text.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) return;
    const key = trimmed.slice(0, eqIdx).trim().toUpperCase().replace(/\s+/g, '_');
    result[key] = trimmed.slice(eqIdx + 1).trim();
  });
  return result;
}

/**
 * Authenticated fetch wrapper for the user's configured Nexus
 * (PostgREST) connection — sends apikey/Authorization headers, same
 * as v16's own DB.nxFetch(). Use this (not pgFetch) for anything that
 * needs to respect the user's saved connection/credentials — RBAC
 * matrix, Users CRUD, Audit log Nexus sync, etc. Throws a clear error
 * if no connection is configured yet, or on non-2xx response.
 *
 * Every call is recorded via auditRecord() — same as v16's DB.nxFetch,
 * which calls auditRecord() on every request and lets auditRecord's
 * own method whitelist (POST/PATCH/DELETE/LOGIN/LOGIN_FAIL/LOGOUT)
 * filtering out GETs. Do NOT call auditRecord() separately at write call sites —
 * it's already covered here, centrally, for every page that uses
 * nxFetch.
 *
 * Example:
 *   const rows = await nxFetch('/user_roles?select=username,role');
 *   await nxFetch('/user_roles?username=eq.ashishk', {
 *     method: 'PATCH', body: { theme_preference: 'dark' }
 *   });
 */
export async function nxFetch(path, options = {}) {
  const cfg = getDbConfig();
  if (!cfg || !cfg.nexus || !cfg.nexus.url || !cfg.nexus.key) {
    throw new Error('No Nexus connection configured — open the Database tab first.');
  }
  const { method = 'GET', body, headers = {}, prefer } = options;
  const base = cfg.nexus.url.replace(/\/+$/, '');
  const cleanPath = String(path).replace(/^\/+/, '');
  const res = await fetch(`${base}/${cleanPath}`, {
    method,
    headers: {
      apikey: cfg.nexus.key,
      Authorization: `Bearer ${cfg.nexus.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const errMsg = text || res.statusText;
    auditRecord(method, cleanPath, body, 'ERROR', errMsg).catch(() => {});
    throw new Error(`Nexus ${res.status}: ${errMsg}`);
  }
  auditRecord(method, cleanPath, body, 'OK', '').catch(() => {});
  return res.status === 204 ? null : res.json();
}


/**
 * True if the given session's role is admin or master — mirrors v16's
 * own ROLES_ADMIN_SETTINGS gate (Set(['admin','master'])). Use this to
 * decide whether to show Roles/Audit/Users-style sensitive controls.
 * Pass the result of getActiveSession() (or null).
 */
export function isAdminRole(session) {
  return !!session && (session.role === 'admin' || session.role === 'master');
}

/* ================================================================
   SHA-256 — ported verbatim from v16. Web Crypto's crypto.subtle
   requires a secure context (HTTPS or localhost); this NAS is served
   over plain HTTP, so in practice every standalone page falls through
   to the pure-JS implementation below, same as v16 itself does. Kept
   byte-for-byte identical to v16's version since this gates real
   password checks — not a place to "clean up" or rewrite.
   ================================================================ */
export async function sha256(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { /* fall through */ }
  }
  // Genuine, correct SHA-256 — verified byte-for-byte against Node's
  // crypto module across many inputs, including the padding boundary
  // cases right around the 56-byte threshold. This is the canonical
  // hash used for WRITING any new password (see changePassword below).
  //
  // NOTE: don't be tempted to add sha256PureJS as a "fallback" here
  // the way an earlier version of this file did. sha256PureJS is NOT
  // correct SHA-256 (its padding step appends spaces instead of the
  // standard 0x80 + zero-byte sequence) and prioritizing it here once
  // caused every login to fail, because it always returns a 64-char
  // string and so this fallback never got reached. It turns out v16's
  // own real environment actually has Web Crypto available and was
  // never relying on sha256PureJS in practice — see performLogin()
  // below for why both candidates are still checked there anyway.
  return sha256Reliable(str);
}

// Ported verbatim from v16. NOT correct SHA-256 (see sha256() above) —
// kept only as an explicit legacy candidate for LOGIN VERIFICATION, in
// case some account's password_hash was set at a time or in a browser
// context where Web Crypto wasn't available. Never use this to write
// a new password hash — sha256() above is canonical for that.
export function sha256PureJS(str) {
  function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words = [];
  const asciiBitLength = str.length * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = candidate * candidate; i < 313; i += candidate) isComposite[i] = true;
      hash[primeCounter] = mathPow(candidate, .5) * maxWord | 0;
      k[primeCounter++] = mathPow(candidate, 1 / 3) * maxWord | 0;
    }
  }
  str += '';
  while (str.length % 64 - 56) str += ' ';
  for (let i = 0; i < str.length; i++) {
    const j = str.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4 * 8);
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength | 0);
  for (let j = 0; j < words.length;) {
    const W = words.slice(j, j += 16);
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w = W[i % 16];
      if (i < 16) { W[i % 16] += 0; }
      else {
        W[i % 16] += rightRotate(W[(i + 1) % 16], 7) ^ rightRotate(W[(i + 1) % 16], 18) ^ (W[(i + 1) % 16] >>> 3);
        W[i % 16] += W[(i + 9) % 16];
        W[i % 16] += rightRotate(W[(i + 14) % 16], 17) ^ rightRotate(W[(i + 14) % 16], 19) ^ (W[(i + 14) % 16] >>> 10);
      }
      const t1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25))
        + ((hash[4] & hash[5]) ^ (~hash[4] & hash[6])) + k[i] + W[i % 16];
      const t2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22))
        + ((hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]));
      hash = [((t1 + t2) | 0), hash[0], hash[1], hash[2], ((hash[3] + t1) | 0), hash[4], hash[5], hash[6]];
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

function sha256Reliable(ascii) {
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  var mathPow = Math.pow, maxWord = mathPow(2, 32), i, j, result = '', words = [];
  var asciiBitLength = ascii.length * 8, hash = [], k = [], primeCounter = 0, isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = candidate * candidate; i < 313; i += candidate) isComposite[i] = true;
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength | 0);
  for (j = 0; j < words.length;) {
    var W = words.slice(j, j += 16), oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      if (i >= 16) {
        W[i % 16] += rightRotate(W[(i + 1) % 16], 7) ^ rightRotate(W[(i + 1) % 16], 18) ^ (W[(i + 1) % 16] >>> 3);
        W[i % 16] += W[(i + 9) % 16];
        W[i % 16] += rightRotate(W[(i + 14) % 16], 17) ^ rightRotate(W[(i + 14) % 16], 19) ^ (W[(i + 14) % 16] >>> 10);
      }
      var t1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25))
        + ((hash[4] & hash[5]) ^ (~hash[4] & hash[6])) + k[i] + W[i % 16];
      var t2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22))
        + ((hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]));
      hash = [((t1 + t2) | 0), hash[0], hash[1], hash[2], ((hash[3] + t1) | 0), hash[4], hash[5], hash[6]];
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? '0' : '') + b.toString(16); }
  return result;
}


/* ================================================================
   AUDIT LOG ENGINE — ported from v16's Section 0B verbatim.
   Records every DB write through nxFetch-style calls, plus
   LOGIN/LOGIN_FAIL/LOGOUT events. Storage: localStorage
   'drgsbc_audit_log' (same key v16 already uses — Settings' Audit
   Log tab reads this same key, so nothing there needs to change).
   ================================================================ */
const MAX_AUDIT_ENTRIES = 500;
let _cachedIP = null;

async function auditGetIP() {
  if (_cachedIP) return _cachedIP;
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    _cachedIP = j.ip || 'unknown';
  } catch (e) { _cachedIP = 'unavailable'; }
  return _cachedIP;
}

function auditLoad() {
  try {
    const raw = localStorage.getItem('drgsbc_audit_log');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function auditSave(entries) {
  const capped = entries.slice(-MAX_AUDIT_ENTRIES);
  localStorage.setItem('drgsbc_audit_log', JSON.stringify(capped));
}

function auditParsePath(path) {
  const [tableRaw, qs] = path.split('?');
  const table = tableRaw.replace(/\//g, '').trim();
  let filter = '';
  if (qs) {
    const filterParts = qs.split('&').filter(p =>
      !p.startsWith('select=') && !p.startsWith('order=') &&
      !p.startsWith('limit=') && !p.startsWith('offset=')
    );
    filter = filterParts.join('&');
  }
  return { table, filter };
}

function auditSummary(method, table, filter, body) {
  const fStr = filter ? ` WHERE ${decodeURIComponent(filter)}` : '';
  if (method === 'POST') {
    const count = Array.isArray(body) ? body.length : 1;
    return `INSERT ${count} row(s) into ${table}`;
  }
  if (method === 'PATCH') {
    const fields = body ? Object.keys(body).filter(k => k !== 'updated_at').join(', ') : '?';
    return `UPDATE ${table}${fStr} — fields: ${fields}`;
  }
  if (method === 'DELETE') return `DELETE from ${table}${fStr}`;
  return `${method} ${table}${fStr}`;
}

/**
 * Records an audit entry for a DB write or a login/logout event.
 * Call this from page modules after any POST/PATCH/DELETE via nxFetch,
 * same as v16 does. method must be one of POST/PATCH/DELETE/LOGIN/
 * LOGIN_FAIL/LOGOUT (anything else is silently ignored, matching v16).
 *   auditRecord('PATCH', 'process_detail?id=eq.42', {pending_with:'AEN'}, 'OK', '')
 */
export async function auditRecord(method, path, body, status, errorMsg) {
  if (!['POST', 'PATCH', 'DELETE', 'LOGIN', 'LOGIN_FAIL', 'LOGOUT'].includes(method)) return;
  const session = getActiveSession();
  const ip = await auditGetIP();
  const now = new Date();
  const { table, filter } = auditParsePath(path);
  const entry = {
    ts: now.toISOString(),
    ts_local: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
    user: session?.user || 'UNKNOWN',
    role: session?.role || 'unknown',
    ip,
    method,
    table,
    filter: filter || '',
    summary: auditSummary(method, table, filter, body),
    status: status === 'OK' ? 'OK' : 'ERROR',
    error: errorMsg || '',
    synced: false,
  };
  const log = auditLoad();
  log.push(entry);
  auditSave(log);

  const unsynced = log.filter(e => !e.synced);
  if (unsynced.length >= 20 && !window._auditFlushBlocked) auditFlushToNexus();
}

/**
 * Batch-flushes unsynced audit entries to the Nexus 'audit_log' table.
 * Silently fails (never throws to the caller) and backs off for 30
 * minutes after a failure so a down DB doesn't get hammered.
 */
export async function auditFlushToNexus() {
  const cfg = getDbConfig();
  if (!cfg?.nexus?.url || !cfg?.nexus?.key) return;
  if (window._auditFlushBlocked) return;
  const log = auditLoad();
  const unsynced = log.filter(e => !e.synced);
  if (!unsynced.length) return;

  try {
    const payload = unsynced.map(e => ({
      ts: e.ts, ts_local: e.ts_local, username: e.user, role: e.role, ip: e.ip,
      method: e.method, tbl: e.table, filter: e.filter || null, summary: e.summary || null,
      status: e.status, error: e.error || null,
    }));
    await nxFetch('audit_log', { method: 'POST', body: payload, prefer: 'return=minimal' });
    auditSave(log.map(e => (!e.synced ? { ...e, synced: true } : e)));
    console.log('[DRGSBC AUDIT] Flushed', unsynced.length, 'entries to NEXUS');
  } catch (e) {
    console.warn('[DRGSBC AUDIT] Flush failed (will retry in 30 min):', e.message);
    window._auditFlushBlocked = true;
    setTimeout(() => { window._auditFlushBlocked = false; }, 30 * 60 * 1000);
  }
}

let _auditFlushTimer = null;
/** Starts the 10-minute periodic audit flush. Call once after login. */
export function auditStartPeriodicFlush() {
  if (_auditFlushTimer) clearInterval(_auditFlushTimer);
  _auditFlushTimer = setInterval(auditFlushToNexus, 10 * 60 * 1000);
}
/** Stops the periodic flush. Call on logout. */
export function auditStopPeriodicFlush() {
  clearInterval(_auditFlushTimer);
  _auditFlushTimer = null;
}

/**
 * Shared role -> accent color mapping, used anywhere a role needs a
 * visual badge (the Shell's top-bar user badge, the Settings page
 * profile panel). Vivid/distinct on purpose — these are meant to read
 * as a clear status indicator, not a subtle accent.
 */
export const ROLE_COLOR = {
  admin: 'var(--accent-red)',
  master: 'var(--accent-red)',
  'hq-agent': 'var(--accent-gold)',
  'field-agent': 'var(--accent-green)',
  analyst: 'var(--accent-cyan)',
};

/* ================================================================
   RBAC — ported from v16's Section 0. Pure client-side permission
   matrix cached in localStorage.drgsbc_role_perms (the SAME key
   Settings' Role Control tab already reads/writes — nothing changes
   there). Falls back to DEFAULT_ROLE_PERMISSIONS if nothing's saved.
   ================================================================ */
const DEFAULT_ROLE_PERMISSIONS = {
  'page:dash':          { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'page:updation':      { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:false },
  'page:settings':      { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'page:tree_explorer': { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'utab:my-space':      { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:false },
  'utab:new-sanction':  { admin:true, master:true, 'hq-agent':true,  'field-agent':false, analyst:false },
  'utab:edit-sanction': { admin:true, master:true, 'hq-agent':true,  'field-agent':false, analyst:false },
  'utab:sub-items':     { admin:true, master:true, 'hq-agent':true,  'field-agent':false, analyst:false },
  'utab:summary':       { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:false },
  'utab:process':       { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:false },
  'utab:grant':         { admin:true, master:true, 'hq-agent':true,  'field-agent':false, analyst:false },
  'utab:chronolog':     { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'chronolog:record':   { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:false },
  'chronolog:edit':     { admin:true, master:true, 'hq-agent':false, 'field-agent':false, analyst:false },
  'stab:columns':       { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'stab:themes':        { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'stab:status':        { admin:true, master:true, 'hq-agent':true,  'field-agent':false, analyst:false },
  'stab:database':      { admin:true, master:true, 'hq-agent':false, 'field-agent':false, analyst:false },
  'stab:roles':         { admin:true, master:true, 'hq-agent':false, 'field-agent':false, analyst:false },
  'stab:users':         { admin:true, master:true, 'hq-agent':false, 'field-agent':false, analyst:false },
};

function rbacLoadPermissions() {
  try {
    const saved = localStorage.getItem('drgsbc_role_perms');
    return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS)); }
}

/**
 * Checks whether the CURRENT session (from getActiveSession()) is
 * permitted to access pageId, e.g. rbacCan('utab:process'). admin/
 * master always pass, matching v16. Returns false if nobody's logged
 * in or the permission key doesn't exist.
 */
export function rbacCan(pageId) {
  const session = getActiveSession();
  if (!session?.role) return false;
  if (session.role === 'admin' || session.role === 'master') return true;
  const perms = rbacLoadPermissions();
  const p = perms[pageId];
  if (!p) return false;
  return !!p[session.role];
}

/**
 * Hard login gate for a standalone page's main content area. Call
 * this BEFORE doing any data fetching or rendering of real content.
 *
 * Returns true if the page should proceed normally. Returns false and
 * replaces `container`'s content with a blocking "sign in required" /
 * "access restricted" panel if not — callers must stop their own init
 * logic in that case (this function only handles the UI, not flow
 * control, since every page's own boot sequence is shaped
 * differently).
 *
 * Also wires a 'storage' listener so that if the person signs in via
 * the Shell's own top-bar (a different document, but same-origin —
 * sessionStorage writes there fire a 'storage' event on every other
 * same-origin window/iframe) while this page is already open, it
 * re-checks and calls onUnlock() instead of leaving the gate up until
 * a manual refresh. onUnlock is optional — pass it if the page has a
 * normal init() to resume; omit it and the person can just re-open
 * the tab if you'd rather keep this simple.
 */
export function renderAuthGate(container, pageId, onUnlock) {
  const check = () => {
    const session = getActiveSession();
    if (session && rbacCan(pageId)) return true;
    const reason = session ? 'forbidden' : 'no-session';
    container.innerHTML = `
      <div style="min-height:50vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;">
        <div style="text-align:center;max-width:380px;">
          <div style="font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:3px;
            color:${reason === 'no-session' ? '#ffd60a' : '#ff3860'};border:1px solid currentColor;
            display:inline-block;padding:6px 14px;margin-bottom:18px;">
            ${reason === 'no-session' ? 'SIGN IN REQUIRED' : 'ACCESS RESTRICTED'}
          </div>
          <div style="font-family:'Exo 2',Inter,sans-serif;font-size:14px;color:#cdd9e5;line-height:1.6;">
            ${reason === 'no-session'
              ? 'You need to be signed in to view this page.'
              : 'Your account role does not have access to this page.'}
          </div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#7a8a9a;margin-top:14px;letter-spacing:1px;">
            ${reason === 'no-session' ? "Sign in using your name in the Shell's top bar." : 'Contact an administrator if you believe this is a mistake.'}
          </div>
        </div>
      </div>
    `;
    return false;
  };

  const ok = check();
  if (!ok && onUnlock) {
    window.addEventListener('storage', function gateListener(e) {
      if (e.key && e.key.startsWith('drgsbc_') && check()) {
        window.removeEventListener('storage', gateListener);
        onUnlock();
      }
    });
  }
  return ok;
}

/* ================================================================
   LOGIN / LOGOUT — the Shell's own auth entry point. Writes the
   exact same four sessionStorage keys v16's doLogin() always has
   (drgsbc_user / drgsbc_role / drgsbc_profile / drgsbc_login_ts), so
   every page using getActiveSession() — including v16 itself, if it's
   still iframed anywhere — picks this session up automatically.
   Requires a Nexus connection to already be configured (Settings →
   Database), same precondition v16 enforces before showing its own
   login form.
   ================================================================ */

/**
 * Attempts to log in against Nexus's user_roles table. On success,
 * writes the session to sessionStorage and returns the session object
 * (same shape as getActiveSession()). On failure, throws an Error with
 * a user-facing message (username not found / account deactivated /
 * incorrect password / not configured / network error) and records a
 * LOGIN_FAIL audit entry where appropriate — caller should catch and
 * display err.message.
 */
export async function performLogin(username, password) {
  username = (username || '').trim();
  password = (password || '').trim();
  if (!username || !password) throw new Error('Enter both username and password.');

  const cfg = getDbConfig();
  if (!cfg?.nexus?.url || !cfg?.nexus?.key) {
    throw new Error('Database not configured — set up Nexus in Settings → Database first.');
  }

  const pwHash = await sha256(password);
  const pwHashLegacy = sha256PureJS(password);
  const path = `user_roles?username=ilike.${encodeURIComponent(username)}&select=user_id,username,full_name,role,state,designation,team,assigned_processing_depots,assigned_plan_heads,password_hash,theme_preference`;
  const users = await nxFetch(path);

  if (!users || !users.length) {
    await auditRecord('LOGIN_FAIL', 'user_roles', { username }, 'ERROR', 'Username not found').catch(() => {});
    throw new Error('Username not found. Contact administrator.');
  }
  const userRec = users[0];

  if ((userRec.state || 'active').toLowerCase() !== 'active') {
    throw new Error('Account deactivated. Contact administrator.');
  }
  if (userRec.password_hash !== pwHash && userRec.password_hash !== pwHashLegacy) {
    await auditRecord('LOGIN_FAIL', 'user_roles', { username }, 'ERROR', 'Wrong password').catch(() => {});
    throw new Error('Incorrect password. Access denied.');
  }

  const user = userRec.full_name || userRec.username;
  const role = (userRec.role || 'analyst').toLowerCase().trim();
  const profile = {
    username: userRec.username,
    userId: userRec.user_id || null,
    designation: userRec.designation || '',
    team: userRec.team || '',
    depots: Array.isArray(userRec.assigned_processing_depots) ? userRec.assigned_processing_depots : [],
    planHeads: Array.isArray(userRec.assigned_plan_heads) ? userRec.assigned_plan_heads : [],
  };

  sessionStorage.setItem('drgsbc_user', user);
  sessionStorage.setItem('drgsbc_role', role);
  sessionStorage.setItem('drgsbc_profile', JSON.stringify(profile));
  sessionStorage.setItem('drgsbc_login_ts', Date.now().toString());

  await auditRecord('LOGIN', 'user_roles', { username, role }, 'OK', '').catch(() => {});
  auditStartPeriodicFlush();

  return { user, role, profile, loginTs: Date.now() };
}

/**
 * Clears the session (sessionStorage) and stops the audit-flush timer.
 * Records a LOGOUT audit entry and flushes any remaining unsynced
 * entries before clearing. Does NOT touch the DOM — callers re-render
 * their own UI after calling this.
 */
export async function performLogout() {
  const session = getActiveSession();
  sessionStorage.removeItem('drgsbc_user');
  sessionStorage.removeItem('drgsbc_role');
  sessionStorage.removeItem('drgsbc_profile');
  sessionStorage.removeItem('drgsbc_login_ts');
  auditStopPeriodicFlush();
  await auditRecord('LOGOUT', 'user_roles', { user: session?.user }, 'OK', 'Manual logout').catch(() => {});
  await auditFlushToNexus().catch(() => {});
}

/**
 * Changes the logged-in user's password. Verifies the current
 * password against user_roles.password_hash before writing the new
 * one — same two-step shape as v16's own Change Password modal
 * (doChangePassword()), just ported onto this Shell's own nxFetch/
 * sha256/session plumbing instead of v16's DB.nxFetch/currentUser.
 *
 * Throws with a user-facing message on any validation or auth
 * failure; callers should catch and display e.message directly.
 */
export async function changePassword(currentPassword, newPassword, confirmPassword) {
  currentPassword = (currentPassword || '').trim();
  newPassword = (newPassword || '').trim();
  confirmPassword = (confirmPassword || '').trim();

  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new Error('All fields are required.');
  }
  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }
  if (newPassword !== confirmPassword) {
    throw new Error('New passwords do not match.');
  }
  if (newPassword === currentPassword) {
    throw new Error('New password must be different from current.');
  }

  const session = getActiveSession();
  const username = session?.profile?.username;
  if (!username) throw new Error('No active session — sign in again first.');

  const cfg = getDbConfig();
  if (!cfg?.nexus?.url || !cfg?.nexus?.key) {
    throw new Error('Database not configured — set up Nexus in Settings → Database first.');
  }

  const currentHash = await sha256(currentPassword);
  const currentHashLegacy = sha256PureJS(currentPassword);
  const newHash = await sha256(newPassword);

  const checkResp = await nxFetch(
    `user_roles?username=ilike.${encodeURIComponent(username)}&select=username,password_hash`
  );
  const matchedUser = checkResp && checkResp[0];
  if (!matchedUser || (matchedUser.password_hash !== currentHash && matchedUser.password_hash !== currentHashLegacy)) {
    await auditRecord('PASSWORD_CHANGE_FAIL', 'user_roles', { username }, 'ERROR', 'Current password incorrect').catch(() => {});
    throw new Error('Current password is incorrect.');
  }

  await nxFetch(
    `user_roles?username=ilike.${encodeURIComponent(username)}`,
    { method: 'PATCH', body: { password_hash: newHash }, prefer: 'return=representation' }
  );

  await auditRecord('PASSWORD_CHANGE', 'user_roles', { username }, 'OK', '').catch(() => {});
}

/**
 * Reads the currently logged-in user's session.
 *
 * performLogin() (above) writes four flat keys to sessionStorage on a
 * successful login:
 *   drgsbc_user      — display name (full_name || username)
 *   drgsbc_role      — lowercase role id, e.g. 'admin', 'hq-agent'
 *   drgsbc_profile   — JSON string: { username, userId, designation, team, depots, planHeads }
 *   drgsbc_login_ts  — login timestamp (ms)
 *
 * sessionStorage (not localStorage) — but since every standalone page
 * and the shell chrome are served from the SAME origin and SAME tab,
 * they all share this same session storage area automatically. No
 * bridging code needed; whichever page's UI the person actually logs
 * in through (today: the Shell's own top-bar login modal), every
 * other page picks up the session via this same function.
 *
 * Returns null if nobody is logged in yet (safe to call anytime).
 */
export function getActiveSession() {
  try {
    const user = sessionStorage.getItem('drgsbc_user');
    if (!user) return null;
    let profile = {};
    try { profile = JSON.parse(sessionStorage.getItem('drgsbc_profile') || '{}'); } catch {}
    return {
      user,
      role: sessionStorage.getItem('drgsbc_role') || 'analyst',
      profile,
      loginTs: parseInt(sessionStorage.getItem('drgsbc_login_ts') || '0', 10),
    };
  } catch {
    return null;
  }
}
