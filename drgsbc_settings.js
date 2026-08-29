// ================================================================
// drgsbc_settings.js
// Logic for the standalone Settings page (drgsbc_settings.html).
//
// This is a careful port of v16's own Settings tab code — markup,
// CSS classes, and JS logic are copied from drgsbc_dashboard_v16.html
// wherever possible, NOT rewritten from scratch, to minimize the risk
// of subtle bugs. Adaptations made for standalone operation:
//   - currentUser/currentUserRole (monolith globals)  → getActiveSession()
//   - DB.nxFetch (monolith method, auto-logs to audit) → nxFetch() from
//     core/services.js (same auth header pattern, no audit auto-log —
//     see note near AUDIT LOG section below)
//   - inline onclick="fn()" attributes → addEventListener / .onclick=
//     (this file uses ES module imports, which inline onclick can't
//     reach — see pages/_template.js for why that's the pattern here)
//   - syncSidebarNav() / rbacApplyUI() (toggle OTHER monolith pages'
//     nav buttons) → dropped, nothing to sync on a single-page tool
//
// COLUMNS tab is intentionally NOT included — it configures the
// Holdings dashboard table's visible columns and has no meaning
// without that table present. See the scope note in the HTML.
// ================================================================

import { showToast, getActiveSession, isAdminRole, nxFetch, getDbConfig, renderAuthGate, ROLE_COLOR, dbConfigParseText } from './core/services.js';

/* ================================================================
   SESSION BADGE + ADMIN GATING
   ================================================================ */
function renderSessionBadge() {
  const el = document.getElementById('sessionBadge');
  const session = getActiveSession();
  if (session) {
    el.classList.remove('warn');
    el.textContent = `${(session.user || '').toUpperCase()} · ${(session.role || '').toUpperCase()}`;
  } else {
    el.classList.add('warn');
    el.textContent = 'NOT SIGNED IN — click your name in the Shell top bar to sign in';
  }
}

function spInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function spFmtList(arr) {
  return Array.isArray(arr) && arr.length ? arr.join(', ') : '—';
}

/**
 * Replaces the old static "Standalone Settings..." explainer banner.
 * That banner's whole reason to exist was explaining what was hidden
 * and how to unlock it for someone NOT signed in — but the hard login
 * gate added later means an unsigned-in person never reaches this
 * page's content at all anymore, so that explanation became dead
 * text. Showing the actual signed-in user's own profile here is more
 * useful in the spot it occupied.
 */
function renderUserProfileCard() {
  const card = document.getElementById('userProfileCard');
  const session = getActiveSession();
  if (!session) { card.innerHTML = ''; return; }

  const profile = session.profile || {};
  const roleColor = ROLE_COLOR[session.role] || 'var(--accent-blue)';

  card.innerHTML = `
    <div class="upc-avatar" style="background:${roleColor};">${spInitials(session.user)}</div>
    <div class="upc-main">
      <div class="upc-name-row">
        <span class="upc-name">${session.user || ''}</span>
        <span class="upc-role-pill" style="background:${roleColor};">${(session.role || '').toUpperCase()}</span>
      </div>
      <div class="upc-details">
        <div><div class="upc-detail-label">USERNAME</div><div class="upc-detail-value">${profile.username || '—'}</div></div>
        <div><div class="upc-detail-label">DESIGNATION</div><div class="upc-detail-value">${profile.designation || '—'}</div></div>
        <div><div class="upc-detail-label">TEAM</div><div class="upc-detail-value">${profile.team || '—'}</div></div>
        <div><div class="upc-detail-label">PROCESSING DEPOTS</div><div class="upc-detail-value">${spFmtList(profile.depots)}</div></div>
        <div><div class="upc-detail-label">PLAN HEADS</div><div class="upc-detail-value">${spFmtList(profile.planHeads)}</div></div>
      </div>
    </div>
  `;
}

function applyAdminGating() {
  const session = getActiveSession();
  const admin = isAdminRole(session);
  document.getElementById('stab_roles_btn').style.display = admin ? '' : 'none';
  document.getElementById('stab_audit_btn').style.display = admin ? '' : 'none';
  document.getElementById('stab_users_btn').style.display = admin ? '' : 'none';
  // If the currently-active tab just got hidden (role changed/logged out
  // in another tab), fall back to Themes rather than leave a dead panel up.
  const activeBtn = document.querySelector('.stab.active');
  if (activeBtn && activeBtn.style.display === 'none') switchStab('themes');
}

/* ================================================================
   TAB SWITCHING
   ================================================================ */
function switchStab(name) {
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.stab === name));
  document.querySelectorAll('.stab-content').forEach(c => c.classList.toggle('active', c.id === 'stab-' + name));
  if (name === 'audit') buildAuditUI();
  if (name === 'users') usersRenderTable(_usersCache); // show cached data immediately; user can REFRESH for live
  if (name === 'roles') buildRoleMatrix();
}

document.getElementById('settingsTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.stab');
  if (btn) switchStab(btn.dataset.stab);
});

/* ================================================================
   THEMES  (copied from v16's THEMES / AURORA_FAMILY / buildThemeUI / applyTheme)
   ================================================================ */
const THEMES = [
  { id:'cyber',   name:'Cyber Blue',  colors:['#04080f','#00b4d8','#00f5d4'] },
  { id:'dark',    name:'Dark Mode',   colors:['#111111','#4f9cf9','#7dd8f8'] },
  { id:'grey',    name:'Steel Grey',  colors:['#1c1c1e','#9e9e9e','#c8c8c8'] },
  { id:'light',   name:'Light',       colors:['#f0f4f8','#1565c0','#0288d1'] },
  { id:'saffron', name:'Saffron',     colors:['#1a1000','#ff8f00','#ffcc02'] },
  { id:'aurora',        name:'Aurora (Sidebar)',         colors:['#F4F6FB','#6C5CE7','#00B8D9'] },
  { id:'aurora-dark',   name:'Midnight (Sidebar)',       colors:['#14161F','#8B7CF6','#22D3EE'] },
  { id:'aurora-grey',   name:'Elephant Grey (Sidebar)',  colors:['#EDEFF2','#5B6B79','#7C93A3'] },
  { id:'aurora-nature', name:'Nature (Sidebar)',         colors:['#F1F6F1','#3F8F5B','#56A89A'] },
];
const AURORA_FAMILY = new Set(['aurora','aurora-dark','aurora-grey','aurora-nature']);
let currentTheme = localStorage.getItem('drgsbc_theme') || 'cyber';

function buildThemeUI() {
  const grid = document.getElementById('themeGrid');
  grid.innerHTML = '';
  THEMES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'theme-card' + (currentTheme === t.id ? ' active' : '');
    card.innerHTML = `
      <div class="theme-preview" style="background:linear-gradient(135deg,${t.colors[0]} 40%,${t.colors[1]});border:1px solid ${t.colors[1]}44;">
        <div style="position:absolute;bottom:6px;left:8px;width:40%;height:6px;background:${t.colors[1]};opacity:0.8;border-radius:1px;"></div>
        <div style="position:absolute;bottom:6px;right:8px;width:25%;height:6px;background:${t.colors[2]};opacity:0.6;border-radius:1px;"></div>
      </div>
      <div class="theme-name">${t.name}</div>`;
    card.onclick = () => applyTheme(t.id);
    grid.appendChild(card);
  });
}

function applyTheme(id) {
  currentTheme = id;
  document.documentElement.setAttribute('data-theme', id); // this page + theme_sync.js convention
  document.body.setAttribute('data-theme', id);              // also matches v16's own convention (body, not html)
  const isAuroraFamily = AURORA_FAMILY.has(id);
  document.body.classList.toggle('aurora-family', isAuroraFamily);
  const layout = isAuroraFamily ? 'sidebar' : 'top';
  document.body.setAttribute('data-layout', layout);
  localStorage.setItem('drgsbc_theme', id);
  localStorage.setItem('drgsbc_layout', layout);
  buildThemeUI();
  showToast('THEME APPLIED: ' + THEMES.find(t => t.id === id).name.toUpperCase());

  // Best-effort cross-device persistence — same as v16's applyTheme(),
  // adapted to use nxFetch() instead of the monolith's DB.nxFetch.
  const session = getActiveSession();
  const cfg = getDbConfig();
  if (session?.user && cfg?.nexus?.url && cfg?.nexus?.key) {
    nxFetch(`user_roles?username=eq.${encodeURIComponent(session.user)}`, {
      method: 'PATCH',
      body: { theme_preference: id },
      prefer: 'return=minimal',
    }).catch(() => {});
  }
}

/* ================================================================
   FONT SETTINGS  (copied from v16's FONT_OPTIONS / buildFontUI / etc.)
   ================================================================ */
const FONT_OPTIONS = [
  { id: 'exo2',      name: 'Exo 2',          family: "'Exo 2', sans-serif",        sample: 'Dashboard · Default UI' },
  { id: 'inter',     name: 'Inter',           family: "'Inter', sans-serif",         sample: 'Clean · Modern · Neutral' },
  { id: 'roboto',    name: 'Roboto',          family: "'Roboto', sans-serif",        sample: 'Classic · Readable' },
  { id: 'noto',      name: 'Noto Sans',       family: "'Noto Sans', sans-serif",     sample: 'Wide Language Support' },
  { id: 'ibmplex',   name: 'IBM Plex Sans',   family: "'IBM Plex Sans', sans-serif", sample: 'Technical · Structured' },
  { id: 'dmsans',    name: 'DM Sans',         family: "'DM Sans', sans-serif",       sample: 'Geometric · Modern' },
  { id: 'nunito',    name: 'Nunito',          family: "'Nunito', sans-serif",        sample: 'Rounded · Friendly' },
  { id: 'sourcecode',name: 'Source Code Pro', family: "'Source Code Pro', monospace",sample: 'Monospace · Technical' },
];
const DEFAULT_FONT = { id: 'exo2', size: 13 };
let currentFontSettings = { id: 'exo2', size: 13 };

function loadFontSettings() {
  try {
    const saved = localStorage.getItem('drgsbc_font');
    if (saved) {
      const p = JSON.parse(saved);
      currentFontSettings = { id: p.id || DEFAULT_FONT.id, size: p.size || DEFAULT_FONT.size };
    }
  } catch {}
}

function buildFontUI() {
  loadFontSettings();
  const grid = document.getElementById('fontGrid');
  grid.innerHTML = '';
  FONT_OPTIONS.forEach(f => {
    const card = document.createElement('div');
    card.className = 'font-card' + (currentFontSettings.id === f.id ? ' active' : '');
    card.innerHTML = `
      <div class="font-card-name" style="font-family:${f.family}">${f.name}</div>
      <div class="font-card-sample" style="font-family:${f.family}">${f.sample}</div>`;
    card.onclick = () => {
      currentFontSettings.id = f.id;
      document.querySelectorAll('#fontGrid .font-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      updateFontPreview();
    };
    grid.appendChild(card);
  });
  const slider = document.getElementById('fontSizeSlider');
  const val = document.getElementById('fontSizeVal');
  slider.value = currentFontSettings.size;
  val.textContent = currentFontSettings.size + 'px';
  updateSizePresetBtns(currentFontSettings.size);
  updateFontPreview();
}

function updateFontPreview() {
  const font = FONT_OPTIONS.find(f => f.id === currentFontSettings.id) || FONT_OPTIONS[0];
  const preview = document.getElementById('fontPreviewText');
  preview.style.fontFamily = font.family;
  preview.style.fontSize = currentFontSettings.size + 'px';
}

function previewFontSize(val) {
  currentFontSettings.size = parseInt(val);
  document.getElementById('fontSizeVal').textContent = val + 'px';
  updateSizePresetBtns(parseInt(val));
  updateFontPreview();
}

function setFontSize(val) {
  currentFontSettings.size = val;
  document.getElementById('fontSizeSlider').value = val;
  document.getElementById('fontSizeVal').textContent = val + 'px';
  updateSizePresetBtns(val);
  updateFontPreview();
}

function updateSizePresetBtns(size) {
  document.querySelectorAll('.font-size-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
  });
}

function applyFontSettings(save = true) {
  const font = FONT_OPTIONS.find(f => f.id === currentFontSettings.id) || FONT_OPTIONS[0];
  document.documentElement.style.setProperty('--ui-font', font.family);
  document.documentElement.style.setProperty('--ui-font-size', currentFontSettings.size + 'px');
  if (save) {
    localStorage.setItem('drgsbc_font', JSON.stringify(currentFontSettings));
    showToast('FONT APPLIED: ' + font.name.toUpperCase() + ' · ' + currentFontSettings.size + 'PX');
  }
}

function resetFontSettings() {
  currentFontSettings = { ...DEFAULT_FONT };
  localStorage.removeItem('drgsbc_font');
  document.documentElement.style.removeProperty('--ui-font');
  document.documentElement.style.removeProperty('--ui-font-size');
  buildFontUI();
  showToast('FONT RESET TO DEFAULT');
}

document.getElementById('fontSizeSlider').addEventListener('input', (e) => previewFontSize(e.target.value));
document.querySelectorAll('.font-size-preset').forEach(btn => {
  btn.addEventListener('click', () => setFontSize(parseInt(btn.dataset.size)));
});
document.getElementById('btnApplyFont').addEventListener('click', () => applyFontSettings(true));
document.getElementById('btnResetFont').addEventListener('click', resetFontSettings);

/* ================================================================
   STATUS COLOURS  (copied from v16's DEFAULT_STATUS_COLORS / buildStatusColorUI / etc.)
   NOTE: in v16 itself, statusColors is never persisted to localStorage
   anywhere — it resets to DEFAULT_STATUS_COLORS on every page load.
   That's a pre-existing characteristic, not something introduced here;
   ported as-is rather than silently "fixed" without being asked.
   ================================================================ */
const DEFAULT_STATUS_COLORS = {
  'Indent Under Prep': { text:'#ffd60a', bg:'rgba(255,214,10,0.12)',  border:'rgba(255,214,10,0.3)'  },
  'Indent Submitted':  { text:'#00b4d8', bg:'rgba(0,180,216,0.12)',   border:'rgba(0,180,216,0.3)'   },
  'PO/LOA Issued':     { text:'#a78bfa', bg:'rgba(139,92,246,0.12)',  border:'rgba(139,92,246,0.3)'  },
  'Item Delivered':    { text:'#06d6a0', bg:'rgba(6,214,160,0.12)',   border:'rgba(6,214,160,0.3)'   },
  'Bill Submitted':    { text:'#00f5d4', bg:'rgba(0,245,212,0.12)',   border:'rgba(0,245,212,0.3)'   },
  'Bill Passed':       { text:'#34d399', bg:'rgba(52,211,153,0.12)',  border:'rgba(52,211,153,0.3)'  },
  'Work completed':    { text:'#10b981', bg:'rgba(16,185,129,0.12)',  border:'rgba(16,185,129,0.3)'  },
  'Dropped':           { text:'#ff3860', bg:'rgba(255,56,96,0.12)',   border:'rgba(255,56,96,0.3)'   },
  'On Hold':           { text:'#9ca3af', bg:'rgba(156,163,175,0.12)', border:'rgba(156,163,175,0.3)' },
  'Sanctioned':        { text:'#60a5fa', bg:'rgba(96,165,250,0.12)',  border:'rgba(96,165,250,0.3)'  },
  'DE Under Prep':     { text:'#fbbf24', bg:'rgba(251,191,36,0.12)',  border:'rgba(251,191,36,0.3)'  },
  'DE Vetted':         { text:'#34d399', bg:'rgba(52,211,153,0.10)',  border:'rgba(52,211,153,0.3)'  },
  'Tender Called':     { text:'#a78bfa', bg:'rgba(167,139,250,0.12)', border:'rgba(167,139,250,0.3)' },
  'Re-Tendered':       { text:'#fb923c', bg:'rgba(251,146,60,0.12)',  border:'rgba(251,146,60,0.3)'  },
  'Indent Placed':     { text:'#38bdf8', bg:'rgba(56,189,248,0.12)',  border:'rgba(56,189,248,0.3)'  },
  'Indent placed':     { text:'#38bdf8', bg:'rgba(56,189,248,0.12)',  border:'rgba(56,189,248,0.3)'  },
  'PO/LOA issued':     { text:'#a78bfa', bg:'rgba(139,92,246,0.12)',  border:'rgba(139,92,246,0.3)'  },
  'Work Completed':    { text:'#10b981', bg:'rgba(16,185,129,0.12)',  border:'rgba(16,185,129,0.3)'  },
};
let statusColors = JSON.parse(JSON.stringify(DEFAULT_STATUS_COLORS));

function buildStatusColorUI() {
  const grid = document.getElementById('statusColorGrid');
  grid.innerHTML = '';
  Object.keys(statusColors).forEach(status => {
    const sc = statusColors[status];
    const row = document.createElement('div');
    row.className = 'status-color-row';
    row.innerHTML = `
      <span class="status-color-label">${status}</span>
      <div class="color-pair">
        <div class="color-input-wrap"><input type="color" data-status="${status}" data-prop="text" value="${hexFromColor(sc.text)}" title="Text"><span>TEXT</span></div>
        <div class="color-input-wrap"><input type="color" data-status="${status}" data-prop="bgsolid" value="${hexFromBg(sc.bg)}" title="BG"><span>BG</span></div>
      </div>
      <span class="badge" id="badge-prev-${status.replace(/[\s\/]/g,'_')}" style="background:${sc.bg};color:${sc.text};border:1px solid ${sc.border};">${status.split(' ')[0]}</span>`;
    grid.appendChild(row);
  });
  grid.querySelectorAll('input[type="color"]').forEach(inp => {
    inp.addEventListener('input', () => updateBadgePreview(inp.dataset.status));
  });
}

function updateBadgePreview(status) {
  const t = document.querySelector(`input[data-status="${status}"][data-prop="text"]`).value;
  const bg = document.querySelector(`input[data-status="${status}"][data-prop="bgsolid"]`).value;
  const badge = document.getElementById('badge-prev-' + status.replace(/[\s\/]/g,'_'));
  if (badge) {
    badge.style.color = t;
    badge.style.background = hexToRgba(bg, 0.15);
    badge.style.borderColor = hexToRgba(bg, 0.4);
  }
}

function saveStatusColors() {
  document.querySelectorAll('#statusColorGrid input[type="color"]').forEach(inp => {
    const status = inp.dataset.status;
    if (!statusColors[status]) return;
    if (inp.dataset.prop === 'text') statusColors[status].text = inp.value;
    if (inp.dataset.prop === 'bgsolid') {
      statusColors[status].bg = hexToRgba(inp.value, 0.15);
      statusColors[status].border = hexToRgba(inp.value, 0.4);
    }
  });
  showToast('STATUS COLOURS APPLIED (this tab/session only)');
}

function resetStatusColors() {
  statusColors = JSON.parse(JSON.stringify(DEFAULT_STATUS_COLORS));
  buildStatusColorUI();
  showToast('COLOURS RESET TO DEFAULT');
}

function hexFromColor(c) {
  if (c.startsWith('#')) return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('') : '#ffffff';
}
function hexFromBg(bg) {
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
  return bg.startsWith('#') ? bg : '#333333';
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

document.getElementById('btnSaveColors').addEventListener('click', saveStatusColors);
document.getElementById('btnResetColors').addEventListener('click', resetStatusColors);

/* ================================================================
   DATABASE  (copied from v16's DB object + Settings → Database actions,
   adapted: DB.config is local here; DB.nxFetch/nxFetchRaw → nxFetch()
   from core/services.js; saveConfig() reads form fields same as v16)
   ================================================================ */
const dbState = { nexus: { url: '', key: '' }, sheets: { url: '' } };

function dbLoadConfigIntoForm() {
  const cfg = getDbConfig();
  if (cfg) {
    if (cfg.nexus) Object.assign(dbState.nexus, cfg.nexus);
    if (cfg.sheets) Object.assign(dbState.sheets, cfg.sheets);
  }
  document.getElementById('cfgNxUrl').value = dbState.nexus.url || '';
  document.getElementById('cfgNxKey').value = dbState.nexus.key || '';
  document.getElementById('cfgGsUrl').value = dbState.sheets.url || '';
}

function dbSaveConfigFromForm() {
  dbState.nexus = {
    url: document.getElementById('cfgNxUrl').value.trim(),
    key: document.getElementById('cfgNxKey').value.trim(),
  };
  dbState.sheets = { url: document.getElementById('cfgGsUrl').value.trim() };
  localStorage.setItem('drgsbc_db_config', JSON.stringify(dbState));
}

function saveDbConfig() {
  dbSaveConfigFromForm();
  const msg = document.getElementById('dbConfigMsg');
  msg.style.color = 'var(--accent-green)';
  msg.textContent = '✓ CONFIG SAVED — Reload data to apply.';
  showToast('DB CONFIG SAVED');
  setTimeout(() => msg.textContent = '', 4000);
}

function clearDbConfig() {
  localStorage.removeItem('drgsbc_db_config');
  dbState.nexus = { url: '', key: '' };
  dbState.sheets = { url: '' };
  dbLoadConfigIntoForm();
  const msg = document.getElementById('dbConfigMsg');
  msg.style.color = 'var(--accent-red)';
  msg.textContent = '✕ CONFIG CLEARED';
  showToast('DB CONFIG CLEARED');
  setTimeout(() => msg.textContent = '', 3000);
}

const DB_TOGGLE = { nx: true, gs: true };

function toggleConnection(which) {
  DB_TOGGLE[which] = !DB_TOGGLE[which];
  const btn = document.getElementById(which + 'ToggleBtn');
  const dot = document.getElementById(which === 'nx' ? 'nxStatusDot' : 'gsStatusDot');
  const val = document.getElementById(which === 'nx' ? 'nxStatusVal' : 'gsStatusVal');
  if (DB_TOGGLE[which]) {
    btn.textContent = 'ON'; btn.style.borderColor = 'var(--accent-green)'; btn.style.color = 'var(--accent-green)';
    dot.style.background = '#555'; val.textContent = 'NOT TESTED'; val.style.color = '';
    showToast((which === 'nx' ? 'NEXUS' : 'SHEETS') + ' CONNECTION ENABLED');
  } else {
    btn.textContent = 'OFF'; btn.style.borderColor = 'var(--accent-red)'; btn.style.color = 'var(--accent-red)';
    dot.style.background = 'var(--accent-red)'; val.textContent = 'CONNECTION SWITCHED OFF'; val.style.color = 'var(--accent-red)';
    showToast((which === 'nx' ? 'NEXUS' : 'SHEETS') + ' CONNECTION SWITCHED OFF');
  }
}

async function testNexusConnection() {
  const dot = document.getElementById('nxStatusDot');
  const val = document.getElementById('nxStatusVal');
  dbSaveConfigFromForm();
  dot.style.background = '#ffd60a';
  val.textContent = 'TESTING...';
  try {
    await nxFetch('master_dashboard_view?select=code&limit=1');
    dot.style.background = '#06d6a0';
    val.textContent = '✓ CONNECTED';
    showToast('NEXUS CONNECTION OK');
  } catch (e) {
    dot.style.background = '#ff3860';
    val.textContent = '✕ ' + e.message.slice(0, 40);
    showToast('NEXUS FAILED: ' + e.message.slice(0, 30));
  }
}

async function testSheetsConnection() {
  const dot = document.getElementById('gsStatusDot');
  const val = document.getElementById('gsStatusVal');
  dbSaveConfigFromForm();
  dot.style.background = '#ffd60a';
  val.textContent = 'TESTING...';
  try {
    if (!dbState.sheets.url) throw new Error('No Sheets URL configured');
    const resp = await fetch(dbState.sheets.url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await resp.json();
    dot.style.background = '#06d6a0';
    val.textContent = '✓ CONNECTED';
    showToast('SHEETS CONNECTION OK');
  } catch (e) {
    dot.style.background = '#ff3860';
    val.textContent = '✕ ' + e.message.slice(0, 40);
    showToast('SHEETS FAILED: ' + e.message.slice(0, 30));
  }
}

function dbConfigGenerateText() {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  return [
    '# DRGSBC Dashboard — Database Configuration',
    '# Generated: ' + now + ' IST',
    '# Edit this file in any text editor and reload it in Settings → Database',
    '# Lines starting with # are ignored',
    '',
    '# Nexus (Primary Database)',
    'NEXUS_URL      = ' + (dbState.nexus.url || ''),
    'NEXUS_ANON_KEY = ' + (dbState.nexus.key || ''),
    '',
    '# Google Sheets Fallback (Apps Script Web App URL)',
    'SHEETS_URL        = ' + (dbState.sheets.url || ''),
    '',
    '# Do NOT share this file — it contains your database credentials',
  ].join('\n');
}

function dbConfigDownload() {
  const text = dbConfigGenerateText();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'drgsbc_db.config.txt';
  a.click();
  showToast('CONFIG FILE DOWNLOADED');
}

function dbConfigLoadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = dbConfigParseText(e.target.result);
      const urlVal = parsed['NEXUS_URL'] || '';
      const keyVal = parsed['NEXUS_ANON_KEY'] || '';
      const gsVal = parsed['SHEETS_URL'] || '';
      if (!urlVal && !keyVal && !gsVal) { showToast('CONFIG FILE: NO VALID KEYS FOUND'); return; }

      document.getElementById('cfgNxUrl').value = urlVal;
      document.getElementById('cfgNxKey').value = keyVal;
      document.getElementById('cfgGsUrl').value = gsVal;
      dbState.nexus.url = urlVal; dbState.nexus.key = keyVal; dbState.sheets.url = gsVal;

      const preview = document.getElementById('cfgFilePreview');
      preview.style.display = '';
      preview.innerHTML = `
        <div style="font-family:Share Tech Mono,monospace;font-size:9px;color:var(--accent-green);letter-spacing:1px;margin-bottom:6px;">✓ CONFIG FILE LOADED — ${file.name}</div>
        <div style="font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">URL: ${urlVal ? urlVal.slice(0,40)+'…' : '(not set)'}</div>
        <div style="font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">KEY: ${keyVal ? keyVal.slice(0,20)+'…[hidden]' : '(not set)'}</div>
        <div style="font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">SHEETS: ${gsVal ? gsVal.slice(0,40)+'…' : '(not set)'}</div>
        <div style="font-family:Share Tech Mono,monospace;font-size:10px;color:var(--accent-gold);margin-top:6px;">Click SAVE DB CONFIG to persist these settings.</div>`;
      showToast('CONFIG FILE LOADED — ' + file.name);
    } catch (err) {
      showToast('CONFIG FILE PARSE ERROR: ' + err.message.slice(0, 30));
    }
  };
  reader.readAsText(file);
}

async function runDiagnostic() {
  const panel = document.getElementById('diagPanel');
  panel.style.display = '';
  panel.innerHTML = '⏳ Running diagnostic...';
  dbSaveConfigFromForm();

  const lines = [];
  const log = (txt, color = '') => {
    lines.push(color ? `<span style="color:${color}">${txt}</span>` : txt);
    panel.innerHTML = lines.join('<br>');
  };

  const { url, key } = dbState.nexus;
  if (!url || !key) { log('✕ No URL/Key saved — fill fields and SAVE DB CONFIG first', 'var(--accent-red)'); return; }

  log('URL: ' + url);
  log('Key: ' + key.slice(0, 20) + '...[truncated]');
  log('');

  log('TEST 1: Basic Nexus network reachability...');
  try {
    const r1 = await fetch(url.replace(/\/+$/, '') + '/sanction_header?select=sanction_id&limit=0', {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    const ok1 = r1.ok || r1.status === 206;
    log('  → HTTP ' + r1.status + ' ' + r1.statusText + (ok1 ? ' ✓' : ''), ok1 ? 'var(--accent-green)' : 'var(--accent-red)');
    if (r1.status === 401) log('  → ⚠ 401 = Wrong API key. Use the anon/public key starting with eyJ...', 'var(--accent-red)');
    if (!ok1) { log('  → Cannot proceed — fix connectivity first.', 'var(--accent-red)'); return; }
  } catch (e) { log('  → NETWORK ERROR: ' + e.message, 'var(--accent-red)'); return; }

  log('TEST 2: Read sanction_header (1 row)...');
  try {
    const d2 = await nxFetch('sanction_header?select=sanction_id&limit=1');
    log('  → rows: ' + (Array.isArray(d2) ? d2.length : '?') + (Array.isArray(d2) && d2.length ? ' · first id: ' + JSON.stringify(d2[0]) : ''), 'var(--accent-green)');
  } catch (e) { log('  → ERROR: ' + e.message, 'var(--accent-red)'); }

  log('TEST 3: Read master_dashboard_view (1 row)...');
  try {
    const d3 = await nxFetch('master_dashboard_view?select=code&limit=1');
    log('  → rows: ' + (Array.isArray(d3) ? d3.length : '?'), Array.isArray(d3) ? 'var(--accent-green)' : 'var(--accent-red)');
    if (Array.isArray(d3) && d3.length === 0) {
      log('  → ⚠ VIEW EXISTS BUT RETURNED 0 ROWS', 'var(--accent-gold)');
      log('  → Likely cause: RLS (Row Level Security) blocking anon reads', 'var(--accent-gold)');
      log('  → FIX: In pgAdmin (or psql) on the Synology Postgres container, run:', 'var(--accent-gold)');
      log('     CREATE POLICY "anon_read" ON master_dashboard_view FOR SELECT USING (true);', 'var(--accent-cyan)');
    }
  } catch (e) { log('  → ERROR: ' + e.message, 'var(--accent-red)'); }

  log('');
  log('Diagnostic complete.', 'var(--accent-cyan)');
}

async function triggerGSheetSync() {
  const btn = document.getElementById('btnGsheetSync');
  const msg = document.getElementById('gsheet_sync_msg');
  const TRIGGER_URL = 'http://10.205.50.15:9999/sync/DRGSBC_SYNC_2026';
  btn.disabled = true;
  btn.textContent = '⌛ SYNCING...';
  msg.style.color = 'var(--text-muted)';
  msg.textContent = 'Contacting sync server...';
  try {
    const res = await fetch(TRIGGER_URL, { method: 'GET', signal: AbortSignal.timeout(130000) });
    const data = await res.json();
    if (data.status === 'ok') {
      msg.style.color = 'var(--accent-green)';
      msg.textContent = '✅ ' + (data.rows || data.message || 'Sync complete') + ' @ ' + (data.timestamp || '');
      showToast('✅ Google Sheet synced successfully!');
    } else if (data.status === 'busy') {
      msg.style.color = 'var(--accent-gold)';
      msg.textContent = '⚠ Sync already running — try again in a moment';
      showToast('⚠ Sync already in progress');
    } else {
      msg.style.color = 'var(--accent-red)';
      msg.textContent = '✕ Error: ' + (data.message || 'Unknown error');
      showToast('✕ Sync failed: ' + (data.message || ''));
    }
  } catch (e) {
    msg.style.color = 'var(--accent-red)';
    msg.textContent = '✕ Cannot reach sync server — ensure you are on LAN/WARP';
    showToast('✕ Sync server unreachable');
  } finally {
    btn.disabled = false;
    btn.textContent = '↑ SYNC TO GOOGLE SHEET NOW';
  }
}

document.getElementById('btnTestNexus').addEventListener('click', testNexusConnection);
document.getElementById('btnTestSheets').addEventListener('click', testSheetsConnection);
document.getElementById('nxToggleBtn').addEventListener('click', () => toggleConnection('nx'));
document.getElementById('gsToggleBtn').addEventListener('click', () => toggleConnection('gs'));
document.getElementById('btnSaveDb').addEventListener('click', saveDbConfig);
document.getElementById('btnClearDb').addEventListener('click', clearDbConfig);
document.getElementById('btnDiagnose').addEventListener('click', runDiagnostic);
document.getElementById('btnGsheetSync').addEventListener('click', triggerGSheetSync);
document.getElementById('btnDbConfigDownload').addEventListener('click', dbConfigDownload);
document.getElementById('dbConfigFileInput').addEventListener('change', (e) => dbConfigLoadFile(e.target.files[0]));

/* ================================================================
   ROLE CONTROL MATRIX  (copied from v16's ROLE_MATRIX_PAGES /
   DEFAULT_ROLE_PERMISSIONS / buildRoleMatrix / rbac* functions)
   ================================================================ */
const ROLE_MATRIX_PAGES = [
  { id:'page:dash',          label:'Dashboard',            group:'Pages' },
  { id:'page:updation',      label:'Updation (top-level)', group:'Pages' },
  { id:'page:settings',      label:'Settings (top-level)', group:'Pages' },
  { id:'utab:new-sanction',  label:'↳ New Sanction',       group:'Updation Tabs' },
  { id:'utab:edit-sanction', label:'↳ Edit Sanction',      group:'Updation Tabs' },
  { id:'utab:sub-items',     label:'↳ Sub-Items',          group:'Updation Tabs' },
  { id:'utab:summary',       label:'↳ Summary',            group:'Updation Tabs' },
  { id:'utab:process',       label:'↳ Process Detail',     group:'Updation Tabs' },
  { id:'utab:grant',         label:'↳ Grant',              group:'Updation Tabs' },
  { id:'stab:columns',       label:'↳ Columns',            group:'Settings Tabs' },
  { id:'stab:themes',        label:'↳ Themes & Font',      group:'Settings Tabs' },
  { id:'stab:status',        label:'↳ Status Colours',     group:'Settings Tabs' },
  { id:'stab:database',      label:'↳ Database',           group:'Settings Tabs' },
  { id:'stab:roles',         label:'↳ Role Control',       group:'Settings Tabs' },
];
const CONFIGURABLE_ROLES = ['hq-agent','field-agent','analyst'];
const ROLE_LABELS = { 'hq-agent':'HQ-Agent', 'field-agent':'Field-Agent', analyst:'Analyst' };

const DEFAULT_ROLE_PERMISSIONS = {
  'page:dash':          { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
  'page:updation':      { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:false },
  'page:settings':      { admin:true, master:true, 'hq-agent':true,  'field-agent':true,  analyst:true  },
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
let rolePermissions = {};

function rbacLoadPermissions() {
  try {
    const saved = localStorage.getItem('drgsbc_role_perms');
    rolePermissions = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
  } catch { rolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS)); }
}
function rbacSavePermissions() {
  localStorage.setItem('drgsbc_role_perms', JSON.stringify(rolePermissions));
}

function buildRoleMatrix() {
  rbacLoadPermissions();
  const head = document.getElementById('roleMatrixHead');
  const body = document.getElementById('roleMatrixBody');
  if (!head || !body) return;

  head.innerHTML = `
    <th style="font-family:Share Tech Mono,monospace;font-size:9px;letter-spacing:1px;color:var(--accent-blue);padding:10px 14px;text-align:left;min-width:200px;">PAGE / TAB</th>
    <th style="font-family:Share Tech Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--text-muted);padding:10px 10px;text-align:center;">ADMIN</th>
    <th style="font-family:Share Tech Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--text-muted);padding:10px 10px;text-align:center;">MASTER</th>
    ${CONFIGURABLE_ROLES.map(r => `<th style="font-family:Share Tech Mono,monospace;font-size:9px;letter-spacing:1px;color:var(--accent-cyan);padding:10px 14px;text-align:center;">${ROLE_LABELS[r]||r.toUpperCase()}</th>`).join('')}`;

  let lastGroup = '';
  body.innerHTML = ROLE_MATRIX_PAGES.map(pg => {
    const perms = rolePermissions[pg.id] || {};
    let groupHeader = '';
    if (pg.group !== lastGroup) {
      lastGroup = pg.group;
      groupHeader = `<tr><td colspan="${3 + CONFIGURABLE_ROLES.length}" style="background:var(--bg-card);padding:6px 14px;font-family:Share Tech Mono,monospace;font-size:9px;letter-spacing:2px;color:var(--accent-gold);border-top:1px solid var(--border);">${pg.group.toUpperCase()}</td></tr>`;
    }
    const isAdminOnly = pg.id === 'stab:roles' || pg.id === 'stab:audit';
    const rowHtml = `
      <tr style="border-bottom:1px solid rgba(26,58,92,0.3);">
        <td style="padding:9px 14px;font-family:Exo 2,sans-serif;font-size:12px;color:var(--text-secondary);">${pg.label}</td>
        <td style="text-align:center;padding:9px;"><input type="checkbox" checked disabled style="accent-color:var(--accent-cyan);opacity:0.5;" title="Admin always has access"></td>
        <td style="text-align:center;padding:9px;"><input type="checkbox" checked disabled style="accent-color:var(--accent-gold);opacity:0.5;" title="Master always has access"></td>
        ${CONFIGURABLE_ROLES.map(role => {
          const checked = perms[role] !== undefined ? perms[role] : false;
          const disabled = isAdminOnly ? 'disabled title="Role Control is always admin/master only"' : '';
          return `<td style="text-align:center;padding:9px;"><input type="checkbox" data-page="${pg.id}" data-role="${role}" ${checked?'checked':''} ${disabled} style="accent-color:var(--accent-cyan);width:15px;height:15px;cursor:${isAdminOnly?'not-allowed':'pointer'};"></td>`;
        }).join('')}
      </tr>`;
    return groupHeader + rowHtml;
  }).join('');

  body.querySelectorAll('input[data-page]').forEach(cb => {
    cb.addEventListener('change', () => rbacOnCheckChange(cb));
  });
}

function rbacOnCheckChange(cb) {
  const pageId = cb.dataset.page;
  const role = cb.dataset.role;
  if (!rolePermissions[pageId]) rolePermissions[pageId] = { ...DEFAULT_ROLE_PERMISSIONS[pageId] };
  rolePermissions[pageId][role] = cb.checked;

  if (!cb.checked && (pageId === 'page:updation' || pageId === 'page:settings')) {
    const prefix = pageId === 'page:updation' ? 'utab:' : 'stab:';
    ROLE_MATRIX_PAGES.forEach(pg => {
      if (pg.id.startsWith(prefix)) {
        if (!rolePermissions[pg.id]) rolePermissions[pg.id] = { ...DEFAULT_ROLE_PERMISSIONS[pg.id] };
        rolePermissions[pg.id][role] = false;
        const subCb = document.querySelector(`input[data-page="${pg.id}"][data-role="${role}"]`);
        if (subCb) subCb.checked = false;
      }
    });
  }
}

function rbacSaveMatrix() {
  rbacSavePermissions();
  const msgEl = document.getElementById('rbacSaveMsg');
  if (msgEl) { msgEl.style.color = 'var(--accent-green)'; msgEl.textContent = '✓ PERMISSIONS SAVED'; setTimeout(() => { msgEl.textContent = ''; }, 3000); }
  showToast('ROLE PERMISSIONS SAVED — applies next time v16 loads');
}

function rbacResetMatrix() {
  rolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
  rbacSavePermissions();
  buildRoleMatrix();
  showToast('ROLE PERMISSIONS RESET TO DEFAULT');
}

document.getElementById('btnRbacSave').addEventListener('click', rbacSaveMatrix);
document.getElementById('btnRbacReset').addEventListener('click', rbacResetMatrix);

/* ================================================================
   AUDIT LOG  (copied from v16's auditLoad/Save/Clear + buildAuditUI +
   auditExportCSV + auditClearConfirm)
   NOTE: this VIEWS the same localStorage.drgsbc_audit_log v16 writes
   to (same key, same-origin → shared automatically). What's NOT
   ported: auditRecord()/auditGetIP()/auditFlushToNexus() — v16's
   own write-tracking infrastructure that auto-logs every nxFetch
   call it makes. This Settings page's OWN actions (e.g. creating a
   user below) are therefore not auto-added to the audit trail —
   a minor, deliberate parity gap, not an oversight.
   ================================================================ */
const MAX_AUDIT_ENTRIES = 500;

function auditLoad() {
  try {
    const raw = localStorage.getItem('drgsbc_audit_log');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function auditClear() {
  localStorage.removeItem('drgsbc_audit_log');
}

function buildAuditUI() {
  const body = document.getElementById('auditTableBody');
  if (!body) return;
  let entries = auditLoad().slice().reverse();
  const total = entries.length;

  const userSel = document.getElementById('auditFilterUser');
  if (userSel) {
    const cur = userSel.value;
    while (userSel.options.length > 1) userSel.remove(1);
    const users = [...new Set(entries.map(e => e.user).filter(Boolean))].sort();
    users.forEach(u => {
      const o = document.createElement('option');
      o.value = u; o.textContent = u;
      userSel.appendChild(o);
    });
    if ([...userSel.options].some(o => o.value === cur)) userSel.value = cur;
  }

  const fMethod = document.getElementById('auditFilterMethod')?.value || 'ALL';
  const fUser   = document.getElementById('auditFilterUser')?.value   || 'ALL';
  const fStatus = document.getElementById('auditFilterStatus')?.value || 'ALL';
  const fDate   = document.getElementById('auditFilterDate')?.value   || '';

  if (fMethod !== 'ALL') entries = entries.filter(e => e.method === fMethod);
  if (fUser   !== 'ALL') entries = entries.filter(e => e.user   === fUser);
  if (fStatus !== 'ALL') entries = entries.filter(e => e.status === fStatus);
  if (fDate) entries = entries.filter(e => e.ts && e.ts.startsWith(fDate));

  const countEl = document.getElementById('auditEntryCount');
  if (countEl) countEl.textContent = `${entries.length} OF ${total} ENTRIES`;

  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-muted);">NO MATCHING LOG ENTRIES</td></tr>';
    return;
  }

  const methodColors = { POST:'#06d6a0', PATCH:'#00b4d8', DELETE:'#ff3860' };
  const statusColors2 = { OK:'#06d6a0', ERROR:'#ff3860' };

  body.innerHTML = entries.map((e, i) => {
    const mc = methodColors[e.method] || 'var(--text-muted)';
    const sc = statusColors2[e.status] || 'var(--text-muted)';
    return `
    <tr style="border-bottom:1px solid rgba(26,58,92,0.35);">
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${entries.length - i}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-secondary);white-space:nowrap;">${e.ts_local || e.ts?.replace('T',' ').slice(0,19) || '—'}</td>
      <td style="padding:7px 10px;font-family:Exo 2,sans-serif;font-size:11px;color:var(--accent-cyan);font-weight:600;">${e.user || '—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);text-transform:uppercase;">${e.role || '—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${e.ip || '—'}</td>
      <td style="padding:7px 10px;"><span style="font-family:Share Tech Mono,monospace;font-size:9px;color:${mc};background:${mc}22;border:1px solid ${mc}55;padding:2px 7px;border-radius:2px;">${e.method}</span></td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--accent-gold);">${e.table || '—'}</td>
      <td style="padding:7px 10px;font-family:Exo 2,sans-serif;font-size:11px;color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(e.summary||'').replace(/"/g,'&quot;')}">${e.summary || '—'}${e.error ? '<br><span style="color:var(--accent-red);font-size:9px;">✕ '+e.error+'</span>' : ''}</td>
      <td style="padding:7px 10px;"><span style="font-family:Share Tech Mono,monospace;font-size:9px;color:${sc};background:${sc}18;border:1px solid ${sc}44;padding:2px 7px;border-radius:2px;">${e.status}</span></td>
    </tr>`;
  }).join('');
}

function auditExportCSV() {
  const entries = auditLoad().slice().reverse();
  if (!entries.length) { showToast('NO AUDIT ENTRIES TO EXPORT'); return; }
  const headers = ['#','Date Time (IST)','User','Role','IP Address','Method','Table','Filter','Summary','Status','Error'];
  const rows = entries.map((e,i) => [
    i+1, `"${e.ts_local || e.ts || ''}"`, `"${e.user || ''}"`, `"${e.role || ''}"`, `"${e.ip || ''}"`,
    `"${e.method || ''}"`, `"${e.table || ''}"`, `"${(e.filter||'').replace(/"/g,'""')}"`,
    `"${(e.summary||'').replace(/"/g,'""')}"`, `"${e.status || ''}"`, `"${(e.error||'').replace(/"/g,'""')}"`,
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = `DRGSBC_AuditLog_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('AUDIT LOG EXPORTED');
}

function auditClearConfirm() {
  if (!confirm('Clear ALL audit log entries? This cannot be undone.')) return;
  auditClear();
  buildAuditUI();
  showToast('AUDIT LOG CLEARED');
}

document.getElementById('btnAuditExport').addEventListener('click', auditExportCSV);
document.getElementById('btnAuditClear').addEventListener('click', auditClearConfirm);
document.getElementById('btnAuditRefresh').addEventListener('click', buildAuditUI);
['auditFilterMethod','auditFilterUser','auditFilterStatus','auditFilterDate'].forEach(id => {
  document.getElementById(id).addEventListener('change', buildAuditUI);
});
document.getElementById('btnAuditResetFilters').addEventListener('click', () => {
  document.getElementById('auditFilterMethod').value = 'ALL';
  document.getElementById('auditFilterUser').value = 'ALL';
  document.getElementById('auditFilterStatus').value = 'ALL';
  document.getElementById('auditFilterDate').value = '';
  buildAuditUI();
});

/* ================================================================
   PASSWORD HASHING — sha256/sha256Reliable originally ported from
   v16. v16 also had a sha256PureJS fallback that ran ahead of
   sha256Reliable whenever crypto.subtle was unavailable (true for
   this NAS, plain HTTP on a bare IP) — its padding step was wrong
   (missing the mandatory 0x80 marker byte, padded with spaces/empty
   string instead of nulls), so it silently produced a hash that
   never matched what's actually stored, breaking every login and
   every password set/reset on plain HTTP. Removed entirely here;
   sha256Reliable is verified correct against a real SHA-256
   implementation and is now the only fallback.
   ================================================================ */
async function sha256(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    } catch (e) { /* fall through */ }
  }
  // Web Crypto's SubtleCrypto is only available in secure contexts
  // (HTTPS, or http://localhost) — this NAS is served over plain HTTP
  // on a bare IP, so this is the path actually used in practice.
  // sha256Reliable is verified byte-for-byte correct against a real
  // SHA-256 implementation across multiple input lengths.
  return sha256Reliable(str);
}
function sha256Reliable(ascii) {
  function rightRotate(value, amount) { return (value>>>amount) | (value<<(32-amount)); }
  var mathPow = Math.pow, maxWord = mathPow(2,32), i, j, result = '', words = [];
  var asciiBitLength = ascii.length*8, hash = [], k = [], primeCounter = 0, isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = candidate*candidate; i < 313; i += candidate) isComposite[i] = true;
      hash[primeCounter] = (mathPow(candidate,.5)*maxWord)|0;
      k[primeCounter++] = (mathPow(candidate,1/3)*maxWord)|0;
    }
  }
  ascii += '\x80';
  while (ascii.length%64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j>>8) return '';
    words[i>>2] |= j<<((3 - i%4)*8);
  }
  words[words.length] = ((asciiBitLength/maxWord)|0);
  words[words.length] = (asciiBitLength|0);
  for (j = 0; j < words.length;) {
    var W = words.slice(j, j += 16), oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      if (i >= 16) {
        W[i%16] += rightRotate(W[(i+1)%16],7)^rightRotate(W[(i+1)%16],18)^(W[(i+1)%16]>>>3);
        W[i%16] += W[(i+9)%16];
        W[i%16] += rightRotate(W[(i+14)%16],17)^rightRotate(W[(i+14)%16],19)^(W[(i+14)%16]>>>10);
      }
      var t1 = hash[7]+(rightRotate(hash[4],6)^rightRotate(hash[4],11)^rightRotate(hash[4],25))
        +((hash[4]&hash[5])^(~hash[4]&hash[6]))+k[i]+W[i%16];
      var t2 = (rightRotate(hash[0],2)^rightRotate(hash[0],13)^rightRotate(hash[0],22))
        +((hash[0]&hash[1])^(hash[0]&hash[2])^(hash[1]&hash[2]));
      hash = [((t1+t2)|0),hash[0],hash[1],hash[2],((hash[3]+t1)|0),hash[4],hash[5],hash[6]];
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i]+oldHash[i])|0;
  }
  for (i = 0; i < 8; i++) for (j = 3; j+1; j--) { var b=(hash[i]>>(j*8))&255; result+=((b<16)?'0':'')+b.toString(16); }
  return result;
}

/* ================================================================
   USERS  (copied from v16's usersLoad/usersRenderTable/usersOpenForm/
   usersCloseForm/usersSubmitForm/usersDeleteUser)
   Adaptations: DB.config.nexus → getDbConfig(); DB.nxFetch → nxFetch();
   currentUser/currentUserRole/window.currentUserProfile → getActiveSession()
   ================================================================ */
let _usersCache = [];
let _usersPendingCounts = {};

async function usersLoad() {
  const tbody = document.getElementById('usersTableBody');
  const countEl = document.getElementById('usersCount');
  if (!tbody) return;

  const cfg = getDbConfig();
  if (!cfg?.nexus?.url || !cfg?.nexus?.key) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:20px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--accent-red);">⚠ NO DATABASE CONFIGURED — set it up in the Database tab</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:24px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-muted);">⟳ LOADING...</td></tr>`;

  try {
    const rows = await nxFetch('user_roles?select=user_id,username,full_name,email,role,designation,mobile_no,pf_number,team,assigned_plan_heads,assigned_processing_depots,registered_by,created_at,state,password_hash&order=created_at.asc');
    _usersCache = rows || [];
    if (countEl) countEl.textContent = `${_usersCache.length} USERS`;

    try {
      const pendingRows = await nxFetch('user_pending_counts?select=user_id,assigned_sub_item');
      _usersPendingCounts = {};
      (pendingRows||[]).forEach(r => { _usersPendingCounts[r.user_id] = r.assigned_sub_item; });
    } catch { _usersPendingCounts = {}; }

    const session = getActiveSession();
    const banner = document.getElementById('leakageBanner');
    if (banner) {
      if (session?.role === 'admin') {
        try {
          const leakRows = await nxFetch('accountability_leakage?select=sub_item_id');
          const leakCount = (leakRows||[]).length;
          document.getElementById('leakageCount').textContent = leakCount;
          banner.style.display = leakCount > 0 ? '' : 'none';
        } catch { banner.style.display = 'none'; }
      } else {
        banner.style.display = 'none';
      }
    }

    usersRenderTable(_usersCache);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:20px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--accent-red);">✕ LOAD ERROR: ${e.message.slice(0,60)}</td></tr>`;
  }
}

function usersRenderTable(rows) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:30px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-muted);">NO USERS FOUND — click + ADD USER to create one, or REFRESH to load</td></tr>`;
    return;
  }
  const roleColors = { ADMIN:'var(--accent-cyan)', MASTER:'var(--accent-gold)', 'HQ-AGENT':'var(--accent-blue)', 'FIELD-AGENT':'var(--accent-green)', ANALYST:'var(--text-muted)' };
  tbody.innerHTML = rows.map((u, i) => {
    const stateColor = (u.state||'').toLowerCase() === 'active' ? 'var(--accent-green)' : 'var(--accent-red)';
    const roleBg = roleColors[u.role] || 'var(--text-muted)';
    const hasPassword = u.password_hash ? '✓ SET' : '✗ MISSING';
    const pwColor = u.password_hash ? 'var(--accent-green)' : 'var(--accent-red)';
    const depots = Array.isArray(u.assigned_processing_depots) ? u.assigned_processing_depots.join(', ') : (u.assigned_processing_depots||'');
    const planHeads = Array.isArray(u.assigned_plan_heads) ? u.assigned_plan_heads.join(', ') : (u.assigned_plan_heads||'');
    const assignedCount = _usersPendingCounts[u.user_id];
    const assignedDisplay = (u.team === 'Administrators' || u.team === 'Spectators') ? '—' : (assignedCount !== undefined ? assignedCount : '—');
    return `
    <tr style="border-bottom:1px solid rgba(26,58,92,0.35);">
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${i+1}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--accent-cyan);font-weight:600;">${u.username||'—'}</td>
      <td style="padding:7px 10px;font-family:Exo 2,sans-serif;font-size:11px;color:var(--text-primary);font-weight:500;">${u.full_name||'—'}</td>
      <td style="padding:7px 10px;"><span style="font-family:Share Tech Mono,monospace;font-size:8px;color:${roleBg};background:${roleBg}22;border:1px solid ${roleBg}55;padding:2px 7px;border-radius:2px;">${u.role||'—'}</span></td>
      <td style="padding:7px 10px;font-family:Exo 2,sans-serif;font-size:11px;color:var(--text-secondary);">${u.designation||'—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${depots||'—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${planHeads||'—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${u.mobile_no||'—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-muted);">${u.pf_number||'—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:9px;color:var(--accent-gold);">${u.team||'—'}</td>
      <td style="padding:7px 10px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--accent-cyan);font-weight:600;text-align:center;">${assignedDisplay}</td>
      <td style="padding:7px 10px;"><span style="font-family:Share Tech Mono,monospace;font-size:9px;color:${stateColor};text-transform:uppercase;">${u.state||'—'}</span></td>
      <td style="padding:7px 10px;"><span style="font-family:Share Tech Mono,monospace;font-size:9px;color:${pwColor};">${hasPassword}</span></td>
      <td style="padding:7px 10px;white-space:nowrap;">
        <button data-edit-user="${u.username}" style="background:transparent;border:1px solid var(--accent-blue);color:var(--accent-blue);font-family:Share Tech Mono,monospace;font-size:9px;padding:2px 8px;cursor:pointer;margin-right:4px;">EDIT</button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit-user]').forEach(btn => {
    btn.addEventListener('click', () => usersOpenForm(btn.dataset.editUser));
  });
}

function usersOpenForm(username) {
  const wrap = document.getElementById('userFormWrap');
  const titleEl = document.getElementById('userFormTitle');
  const delBtn = document.getElementById('uf_delete_btn');
  const editHid = document.getElementById('uf_editing_username');
  const msgEl = document.getElementById('uf_msg');
  const session = getActiveSession();

  ['uf_username','uf_full_name','uf_email','uf_designation','uf_mobile_no','uf_pf_number','uf_created_at','uf_password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('uf_role').value = '';
  document.getElementById('uf_state').value = 'active';
  document.getElementById('uf_team').value = '';
  document.querySelectorAll('.uf_depot_cb').forEach(cb => cb.checked = false);
  document.querySelectorAll('.uf_ph_cb').forEach(cb => cb.checked = false);
  document.getElementById('uf_registered_by').value = session?.user || '';
  if (msgEl) msgEl.textContent = '';

  if (username) {
    const u = _usersCache.find(r => r.username === username);
    if (!u) { showToast('User not found in cache — click Refresh'); return; }
    titleEl.textContent = 'EDIT USER · ' + username.toUpperCase();
    editHid.value = username;
    delBtn.style.display = '';
    document.getElementById('uf_username').value = u.username || '';
    document.getElementById('uf_username').readOnly = true;
    document.getElementById('uf_username').style.color = 'var(--text-muted)';
    document.getElementById('uf_full_name').value = u.full_name || '';
    document.getElementById('uf_email').value = u.email || '';
    document.getElementById('uf_designation').value = u.designation || '';
    document.getElementById('uf_mobile_no').value = u.mobile_no || '';
    document.getElementById('uf_pf_number').value = u.pf_number || '';
    const depots = u.assigned_processing_depots || [];
    document.querySelectorAll('.uf_depot_cb').forEach(cb => cb.checked = depots.includes(cb.value));
    const planHeads = u.assigned_plan_heads || [];
    document.querySelectorAll('.uf_ph_cb').forEach(cb => cb.checked = planHeads.includes(cb.value));
    document.getElementById('uf_registered_by').value = u.registered_by || '';
    document.getElementById('uf_created_at').value = u.created_at ? new Date(u.created_at).toLocaleString('en-IN') : '';
    document.getElementById('uf_role').value = u.role || '';
    document.getElementById('uf_team').value = u.team || '';
    document.getElementById('uf_state').value = (u.state||'active').toLowerCase();
    document.getElementById('uf_pass_note').textContent = '(leave blank to keep current)';
  } else {
    titleEl.textContent = 'ADD NEW USER';
    editHid.value = '';
    delBtn.style.display = 'none';
    document.getElementById('uf_username').readOnly = false;
    document.getElementById('uf_username').style.color = '';
    document.getElementById('uf_pass_note').textContent = '(required for new user)';
    document.getElementById('uf_created_at').value = new Date().toLocaleString('en-IN');
  }

  wrap.style.display = '';
  wrap.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function usersCloseForm() {
  document.getElementById('userFormWrap').style.display = 'none';
  document.getElementById('uf_msg').textContent = '';
}

async function usersSubmitForm() {
  const btn = document.getElementById('uf_submit_btn');
  const msgEl = document.getElementById('uf_msg');
  const editing = document.getElementById('uf_editing_username').value.trim();

  const username = document.getElementById('uf_username').value.trim();
  const full_name = document.getElementById('uf_full_name').value.trim();
  const password = document.getElementById('uf_password').value.trim();
  const role = document.getElementById('uf_role').value;

  if (!username) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Username is required.'; return; }
  if (!full_name) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Full name is required.'; return; }
  if (!role) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Role is required.'; return; }
  if (!editing && !password) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Password is required for new users.'; return; }

  const mobile_no = document.getElementById('uf_mobile_no').value.trim();
  const pf_number = document.getElementById('uf_pf_number').value.trim();
  if (!mobile_no) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Mobile number is required.'; return; }
  if (!/^[6-9][0-9]{9}$/.test(mobile_no)) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Mobile number must be a valid 10-digit number.'; return; }
  if (!pf_number) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ PF number is required.'; return; }

  const team = document.getElementById('uf_team').value;
  if (!team) { msgEl.style.color='var(--accent-red)'; msgEl.textContent='✕ Team is required.'; return; }

  btn.disabled = true; btn.textContent = 'SAVING...';
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = '⟳ Saving...';

  try {
    const session = getActiveSession();
    const payload = {
      full_name,
      email: document.getElementById('uf_email').value.trim() || null,
      role,
      state: document.getElementById('uf_state').value,
      designation: document.getElementById('uf_designation').value.trim() || null,
      mobile_no, pf_number, team,
      assigned_processing_depots: Array.from(document.querySelectorAll('.uf_depot_cb:checked')).map(cb => cb.value),
      assigned_plan_heads: Array.from(document.querySelectorAll('.uf_ph_cb:checked')).map(cb => cb.value),
      registered_by: session?.profile?.userId || null,
    };
    if (password) payload.password_hash = await sha256(password);

    if (editing) {
      await nxFetch(`user_roles?username=eq.${encodeURIComponent(editing)}`, { method:'PATCH', body: payload, prefer:'return=representation' });
      msgEl.style.color = 'var(--accent-green)'; msgEl.textContent = `✓ User '${editing}' updated successfully.`;
      showToast('USER UPDATED');
    } else {
      payload.username = username;
      await nxFetch('user_roles', { method:'POST', body: payload, prefer:'return=representation' });
      msgEl.style.color = 'var(--accent-green)'; msgEl.textContent = `✓ User '${username}' created successfully.`;
      showToast('USER CREATED');
    }

    btn.disabled = false; btn.textContent = 'SAVE USER';
    await usersLoad();
    setTimeout(() => usersCloseForm(), 1400);
  } catch (e) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ ERROR: ' + e.message.slice(0,70);
    btn.disabled = false; btn.textContent = 'SAVE USER';
  }
}

async function usersDeleteUser() {
  const editing = document.getElementById('uf_editing_username').value.trim();
  if (!editing) return;
  if (!confirm(`Deactivate user '${editing}'? They will be blocked from login but data is preserved.`)) return;
  const msgEl = document.getElementById('uf_msg');
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = '⟳ Deactivating...';
  try {
    await nxFetch(`user_roles?username=eq.${encodeURIComponent(editing)}`, { method:'PATCH', body: { state:'inactive' }, prefer:'return=representation' });
    msgEl.style.color = 'var(--accent-green)'; msgEl.textContent = `✓ '${editing}' deactivated. Login blocked.`;
    showToast('USER DEACTIVATED');
    await usersLoad();
    setTimeout(() => usersCloseForm(), 1200);
  } catch (e) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ ERROR: ' + e.message.slice(0,60);
  }
}

document.getElementById('btnUsersAdd').addEventListener('click', () => usersOpenForm());
document.getElementById('btnUsersRefresh').addEventListener('click', usersLoad);
document.getElementById('uf_submit_btn').addEventListener('click', usersSubmitForm);
document.getElementById('uf_cancel_btn').addEventListener('click', usersCloseForm);
document.getElementById('uf_delete_btn').addEventListener('click', usersDeleteUser);

/* ================================================================
   BOOT
   ================================================================ */
function bootSettingsPage() {
  applyAdminGating();
  renderUserProfileCard();
  buildThemeUI();
  buildFontUI();
  buildStatusColorUI();
  dbLoadConfigIntoForm();
}

renderSessionBadge();
if (renderAuthGate(document.getElementById('pageWrap'), 'page:settings', bootSettingsPage)) {
  bootSettingsPage();
}

// Keep the session badge / admin-gated tabs live if login state changes
// in another same-origin document (the Dashboard iframe, or the shell
// itself) while this page is open.
window.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('drgsbc_')) {
    renderSessionBadge();
    if (renderAuthGate(document.getElementById('pageWrap'), 'page:settings')) {
      applyAdminGating();
      renderUserProfileCard();
    }
  }
});
