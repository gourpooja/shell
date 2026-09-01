// ================================================================
// drgsbc_updation.js
// Logic for the standalone Updation page (drgsbc_updation.html).
//
// This page owns its OWN internal sub-tab system (utabs), mirroring
// v16's switchUtab() — My Space, New Sanction, Edit Sanction,
// Sub-Items, Process, Grant, Chronolog. Only My Space is fully ported
// so far; the rest render a clear "not yet built here" placeholder
// rather than silently failing. Add a tab to TABS_BUILT as each one
// gets ported.
//
// Ported from v16's buildMySpace()/msShowDetail()/msNavigateTo().
// Adaptations: DB.nxFetch → nxFetch, currentUser/currentUserRole/
// window.currentUserProfile → getActiveSession(), rbacCan() now reads
// the session internally (core/services.js) instead of a global.
//
// NO DEMO DATA FALLBACK — if Nexus isn't configured/reachable, this
// shows an empty/error state, never synthetic data.
// ================================================================

import { showToast, getActiveSession, getDbConfig, nxFetch, rbacCan, renderAuthGate } from './core/services.js';

/* ================================================================
   SESSION BADGE
   ================================================================ */
function renderSessionBadge() {
  const el = document.getElementById('sessionBadge');
  const session = getActiveSession();
  if (session) {
    el.textContent = `${(session.user || '').toUpperCase()} · ${(session.role || '').toUpperCase()}`;
  } else {
    el.textContent = 'NOT SIGNED IN — click your name in the Shell top bar to sign in';
  }
}

function parseMultiVal(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  const s = String(val).trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map(String); } catch {}
  }
  return s.split(',').map(v => v.trim()).filter(Boolean);
}

/* ================================================================
   SUB-TAB SYSTEM
   ================================================================ */
const TAB_LABELS = {
  'my-space': 'MY SPACE', 'new-sanction': 'NEW SANCTION', 'edit-sanction': 'EDIT SANCTION',
  'sub-items': 'SUB-ITEMS', 'process': 'PROCESS', 'grant': 'GRANT', 'chronolog': 'CHRONOLOG',
};
// Grows as each tab gets ported. Everything else shows a placeholder.
const TABS_BUILT = new Set(['my-space', 'process', 'new-sanction', 'edit-sanction', 'grant', 'sub-items', 'chronolog']);

function applyUtabRbac() {
  Object.keys(TAB_LABELS).forEach(name => {
    const btn = document.getElementById('utab_btn_' + name);
    if (btn) btn.style.display = rbacCan('utab:' + name) ? '' : 'none';
  });
}

function renderComingSoon(name) {
  const el = document.getElementById('utab-' + name);
  if (!el) return;
  el.innerHTML = `<div class="coming-soon">
    <div class="coming-soon-icon">🛠</div>
    <div class="coming-soon-text">${TAB_LABELS[name] || name.toUpperCase()} — NOT YET BUILT HERE</div>
    <div class="coming-soon-sub">This tab still lives in the full v16 Dashboard tab for now. It's next in line to be ported into the Shell.</div>
  </div>`;
}

function switchUtab(name) {
  if (!rbacCan('utab:' + name)) {
    showToast('ACCESS DENIED — ROLE DOES NOT PERMIT THIS TAB', 'error');
    return;
  }
  document.querySelectorAll('#utabStrip .stab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.stab-content').forEach(c => c.classList.remove('active'));
  const btn = document.getElementById('utab_btn_' + name);
  const content = document.getElementById('utab-' + name);
  if (btn) btn.classList.add('active');
  if (content) content.classList.add('active');

  if (!TABS_BUILT.has(name)) {
    renderComingSoon(name);
    return;
  }
  if (name === 'my-space') buildMySpace();
  if (name === 'process') pdOnTabOpen();
  if (name === 'new-sanction') nsOnTabOpen();
  if (name === 'edit-sanction') esOnTabOpen();
  if (name === 'grant') gdOnTabOpen();
  if (name === 'sub-items') siOnTabOpen();
  if (name === 'chronolog') clOnTabOpen();
}

document.querySelectorAll('#utabStrip .stab').forEach(btn => {
  btn.addEventListener('click', () => switchUtab(btn.dataset.utab));
});

/* ================================================================
   MY SPACE
   ================================================================ */
let _msAllRows = [];

async function buildMySpace() {
  const session = getActiveSession();
  const profile = session?.profile || {};
  const role    = session?.role || '';
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today); weekOut.setDate(today.getDate() + 7);
  const msgEl   = document.getElementById('ms_load_msg');

  const avatar = document.getElementById('ms_avatar');
  const name   = document.getElementById('ms_name');
  const meta   = document.getElementById('ms_meta');
  const tags   = document.getElementById('ms_assignment_tags');
  if (avatar) avatar.textContent = (session?.user || '?').slice(0, 2).toUpperCase();
  if (name)   name.textContent   = session?.user || '—';
  const myDepots    = parseMultiVal(profile.depots);
  const myPlanHeads = parseMultiVal(profile.planHeads);
  if (meta) meta.textContent = [role.toUpperCase(), profile.designation || '', myDepots.join('/')].filter(Boolean).join(' · ');
  if (tags) {
    tags.innerHTML = '';
    if (myDepots.length) {
      const t = document.createElement('span'); t.className = 'badge';
      t.style.cssText = 'background:rgba(0,180,216,0.12);color:var(--accent-cyan);border:1px solid rgba(0,180,216,0.3);font-size:9px;padding:3px 9px;';
      t.textContent = '⊹ ' + myDepots.join(', '); tags.appendChild(t);
    }
    if (myPlanHeads.length) {
      const t2 = document.createElement('span'); t2.className = 'badge';
      t2.style.cssText = 'background:rgba(255,214,10,0.1);color:var(--accent-gold);border:1px solid rgba(255,214,10,0.3);font-size:9px;padding:3px 9px;';
      t2.textContent = 'PH: ' + myPlanHeads.join(', '); tags.appendChild(t2);
    }
  }

  if (!session) {
    if (msgEl) { msgEl.style.display = ''; msgEl.textContent = '⚠ Sign in to load your items.'; }
    ['ms_stat_total', 'ms_stat_po', 'ms_stat_overdue', 'ms_stat_pending'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '—';
    });
    return;
  }

  const cfg = getDbConfig();
  if (!cfg?.nexus?.url || !cfg?.nexus?.key) {
    if (msgEl) { msgEl.style.display = ''; msgEl.textContent = '⚠ No database configured. Set up Nexus in Settings → Database.'; }
    return;
  }
  if (msgEl) { msgEl.style.display = ''; msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = '⟳ Loading your data...'; }

  try {
    const isAdmin = role === 'admin';

    const pdRows = await nxFetch(
      `process_detail?select=process_id,sub_item_id,process_stage,delivery_due_on,next_process_due_on,pending_with,remarks,loa_po_date&order=next_process_due_on.asc`
    );
    if (!pdRows.length) {
      _msAllRows = [];
      ['ms_stat_total', 'ms_stat_po', 'ms_stat_overdue', 'ms_stat_pending'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '0';
      });
      if (msgEl) { msgEl.style.display = ''; msgEl.style.color = 'var(--accent-green)'; msgEl.textContent = '✓ No items assigned to your depot.'; }
      return;
    }

    const subIds = [...new Set(pdRows.map(r => r.sub_item_id))];
    const subRows = await nxFetch(
      `sanction_sub_item?sub_item_id=in.(${subIds.join(',')})&select=sub_item_id,sub_item_name,qty,total_value,consignee_depot,processing_depot,line_item_id`
    );
    const subMap = {}; subRows.forEach(s => subMap[s.sub_item_id] = s);

    const lineIds = [...new Set(subRows.map(r => r.line_item_id).filter(Boolean))];
    let lineMap = {};
    if (lineIds.length) {
      const lineRows = await nxFetch(
        `sanction_line_item?line_item_id=in.(${lineIds.join(',')})&select=line_item_id,item_name,item_description,sanction_id`
      );
      lineRows.forEach(l => lineMap[l.line_item_id] = l);
      const sancIds = [...new Set(lineRows.map(r => r.sanction_id).filter(Boolean))];
      if (sancIds.length) {
        const sancRows = await nxFetch(
          `sanction_header?sanction_id=in.(${sancIds.join(',')})&select=sanction_id,under_power,plan_head`
        );
        const sancMap = {}; sancRows.forEach(s => sancMap[s.sanction_id] = s);
        lineRows.forEach(l => {
          if (lineMap[l.line_item_id]) {
            lineMap[l.line_item_id]._under_power = (sancMap[l.sanction_id] || {}).under_power || '—';
            lineMap[l.line_item_id]._plan_head   = (sancMap[l.sanction_id] || {}).plan_head   || '';
          }
        });
      }
    }

    // "My Items" jurisdiction filter — same logic as v16, including the
    // String() fix for the plan_head text/numeric mismatch.
    let allowedSubIds;
    if (isAdmin) {
      allowedSubIds = new Set(subRows.map(s => s.sub_item_id));
    } else {
      allowedSubIds = new Set(
        subRows.filter(s => {
          const line = lineMap[s.line_item_id] || {};
          const planHead = line._plan_head ?? null;
          const depotOk = !myDepots.length
            || myDepots.includes(s.processing_depot)
            || myDepots.includes(s.consignee_depot);
          const planHeadOk = !myPlanHeads.length || myPlanHeads.includes(String(planHead));
          return depotOk && planHeadOk;
        }).map(s => s.sub_item_id)
      );
    }

    _msAllRows = pdRows
      .filter(pd => allowedSubIds.has(pd.sub_item_id))
      .map(pd => {
        const sub  = subMap[pd.sub_item_id] || {};
        const line = lineMap[sub.line_item_id] || {};
        const d    = pd.next_process_due_on ? new Date(pd.next_process_due_on) : null;
        if (d) d.setHours(0, 0, 0, 0);
        return {
          ...pd,
          sub_item_name:    sub.sub_item_name    || '—',
          item_description: line.item_description || '',
          qty:              sub.quantity         ?? '—',
          total_value:      sub.total_value       ?? '—',
          consignee_depot:  sub.consignee_depot  || '—',
          processing_depot: sub.processing_depot || '—',
          line_item_id:     sub.line_item_id,
          item_name:        line.item_name       || '—',
          under_power:      line._under_power    || '—',
          _dueDate:         d,
          _isOverdue:       d ? d <= weekOut : false,
        };
      });

    const myTeam = (profile.team || '').toLowerCase();
    const poItems = _msAllRows.filter(r => r.loa_po_date);
    const overdue = _msAllRows.filter(r => r._isOverdue);
    const pending = _msAllRows.filter(r => {
      if ((r.pending_with || '').toLowerCase() !== myTeam) return false;
      if (myTeam === 'owner sse' && myDepots.length) return myDepots.includes(r.processing_depot);
      return true;
    });

    const s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    s('ms_stat_total', _msAllRows.length);
    s('ms_stat_po', poItems.length);
    s('ms_stat_overdue', overdue.length);
    s('ms_stat_pending', pending.length);

    if (msgEl) msgEl.style.display = 'none';
  } catch (e) {
    if (msgEl) { msgEl.style.display = ''; msgEl.style.color = 'var(--accent-red)'; msgEl.textContent = '✕ Load error: ' + e.message.slice(0, 60); }
  }
}

function msShowDetail(filter) {
  const session  = getActiveSession();
  const profile  = session?.profile || {};
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const myTeam   = (profile.team || '').toLowerCase();
  const myDepots = parseMultiVal(profile.depots);

  let rows = _msAllRows;
  let title = 'ALL MY ITEMS';
  let accentColor = 'var(--accent-cyan)';

  if (filter === 'po') {
    rows = _msAllRows.filter(r => r.loa_po_date);
    title = 'PO / LOA ISSUED'; accentColor = 'var(--accent-blue)';
  } else if (filter === 'overdue') {
    rows = _msAllRows.filter(r => r._isOverdue);
    title = 'OVERDUE / DUE THIS WEEK'; accentColor = 'var(--accent-red)';
  } else if (filter === 'pending') {
    rows = _msAllRows.filter(r => {
      if ((r.pending_with || '').toLowerCase() !== myTeam) return false;
      if (myTeam === 'owner sse' && myDepots.length) return myDepots.includes(r.processing_depot);
      return true;
    });
    title = 'PENDING WITH ME'; accentColor = 'var(--accent-gold)';
  }

  document.querySelectorAll('.ms-stat-card').forEach((card) => {
    card.style.borderColor = card.dataset.msfilter === filter ? accentColor : 'var(--border)';
  });

  const titleEl = document.getElementById('ms_detail_title');
  if (titleEl) { titleEl.textContent = title + ' (' + rows.length + ')'; titleEl.style.color = accentColor; }

  const body = document.getElementById('ms_detail_body');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;font-family:\'Share Tech Mono\',monospace;font-size:10px;color:var(--text-muted);">NO ITEMS IN THIS CATEGORY</td></tr>';
  } else {
    body.innerHTML = rows.map((r, i) => {
      // Always route to Process > Procurement for editing — the single
      // consistent landing page regardless of whether a process_detail
      // row already exists for this sub-item.
      const targetTab = 'process';
      const canEdit   = rbacCan('utab:' + targetTab);

      let rowStyle = 'border-bottom:1px solid rgba(26,58,92,0.35);';
      if (r._isOverdue && r._dueDate) {
        const daysLate = Math.round((today - r._dueDate) / 86400000);
        rowStyle += daysLate > 0 ? 'background:rgba(255,56,96,0.04);' : 'background:rgba(255,214,10,0.04);';
      }

      const nameShort = r.item_name.length > 28 ? r.item_name.slice(0, 25) + '...' : r.item_name;
      const totalFmt  = typeof r.total_value === 'number' ? '₹' + r.total_value.toLocaleString('en-IN') : (r.total_value || '—');

      const safeName = String(r.sub_item_name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const subLink = canEdit
        ? `<a href="#" class="ms-nav-link" data-subid="${r.sub_item_id}" data-target="${targetTab}" data-name="${safeName}" style="color:var(--accent-cyan);text-decoration:underline;cursor:pointer;" title="${r.item_description || r.sub_item_name}">${r.sub_item_name.length > 30 ? r.sub_item_name.slice(0, 27) + '...' : r.sub_item_name}</a>`
        : `<span title="${r.item_description || r.sub_item_name}">${r.sub_item_name.length > 30 ? r.sub_item_name.slice(0, 27) + '...' : r.sub_item_name}</span>`;

      const stageColor = {
        'PO/LOA Issued': 'var(--accent-blue)', 'Bill Passed': 'var(--accent-green)',
        'Item Delivered': 'var(--accent-cyan)', 'Indent Submitted': 'var(--text-secondary)',
        'Dropped': 'var(--text-muted)', 'Inactive': 'var(--text-muted)'
      }[r.process_stage] || 'var(--text-secondary)';

      const actionBtn = canEdit
        ? `<button class="ms-nav-link" data-subid="${r.sub_item_id}" data-target="${targetTab}" data-name="${safeName}" title="Edit this item" style="background:transparent;border:1px solid var(--accent-blue);color:var(--accent-blue);padding:2px 7px;cursor:pointer;font-size:12px;border-radius:2px;">✎</button>`
        : '—';

      return `<tr style="${rowStyle}">
        <td style="padding:7px 8px;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">${i + 1}</td>
        <td style="padding:7px 8px;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);white-space:nowrap;">${r.under_power || '—'}</td>
        <td style="padding:7px 8px;font-family:'Exo 2',sans-serif;font-size:11px;color:var(--text-secondary);" title="${r.item_name}">${nameShort}</td>
        <td style="padding:7px 8px;font-family:'Exo 2',sans-serif;font-size:11px;color:var(--text-primary);">${subLink}</td>
        <td style="padding:7px 8px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-secondary);text-align:right;">${r.qty || '—'}</td>
        <td style="padding:7px 8px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-cyan);text-align:right;white-space:nowrap;">${totalFmt}</td>
        <td style="padding:7px 8px;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">${r.consignee_depot || '—'}</td>
        <td style="padding:7px 8px;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">${r.processing_depot || '—'}</td>
        <td style="padding:7px 8px;"><span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:${stageColor};">${r.process_stage || '—'}</span></td>
        <td style="padding:7px 8px;font-family:'Exo 2',sans-serif;font-size:11px;color:var(--text-muted);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${r.remarks || ''}">${r.remarks || '—'}</td>
        <td style="padding:7px 8px;text-align:center;">${actionBtn}</td>
      </tr>`;
    }).join('');

    // Delegate clicks for the links/buttons just rendered.
    body.querySelectorAll('.ms-nav-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        msNavigateTo(el.dataset.subid, el.dataset.target, el.dataset.name);
      });
    });
  }

  document.getElementById('ms_detail_section').style.display = '';
  document.getElementById('ms_detail_section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.querySelectorAll('.ms-stat-card').forEach(card => {
  card.addEventListener('click', () => msShowDetail(card.dataset.msfilter));
});
document.getElementById('ms_detail_close').addEventListener('click', () => {
  document.getElementById('ms_detail_section').style.display = 'none';
  document.querySelectorAll('.ms-stat-card').forEach(c => c.style.borderColor = 'var(--border)');
});

/**
 * Switches to the target utab and (for Process) pre-fills/fetches the
 * specific sub-item, same as v16's msNavigateTo().
 */
function msNavigateTo(subItemId, targetTab, subItemName) {
  switchUtab(targetTab);
  window._msTargetSubItemId = String(subItemId);

  if (!TABS_BUILT.has(targetTab)) {
    showToast(TAB_LABELS[targetTab] + ' isn\'t built in the Shell yet — use the Dashboard tab for now.', 'info');
    return;
  }

  if (targetTab === 'process' && subItemName) {
    setTimeout(() => {
      if (typeof pdSwitchSubTab === 'function') pdSwitchSubTab('procurement');
      const input = document.getElementById('pd_f_subitem');
      if (input) {
        input.value = subItemName;
        pdFetchData();
        showToast('FETCHING ' + subItemName.slice(0, 40).toUpperCase());
      }
    }, 150);
  } else {
    showToast('NAVIGATED TO ' + targetTab.toUpperCase());
  }
}

/* ================================================================
   NEW SANCTION
   ================================================================
   submitSanction() writes sanction_header → sanction_line_item →
   sanction_sub_item as three sequential inserts (matching v16's
   DB.createSanction transaction shape — PostgREST has no real
   multi-table transaction support, so this mirrors the same
   best-effort sequential approach v16 uses).

   NOTE ON A SCHEMA NAMING INCONSISTENCY IN v16 ITSELF: every READ
   path in v16 (Process tab, Dashboard, My Space) consistently uses
   a `qty` column on sanction_line_item/sanction_sub_item — and in a
   couple of places v16 even has defensive fallback code like
   `r.qty != null ? r.qty : r.quantity`, which only makes sense if at
   some point the schema was renamed from `quantity` to `qty` and a
   few call sites were never updated. The actual WRITE payloads in
   v16's submitSanction()/DB.createSanction(), though, still send a
   `quantity` field. I'm preserving that literal behavior here rather
   than guessing — flagged clearly in the delivery notes so it can be
   checked against the real NAS schema rather than silently "fixed"
   on a guess that could break a working insert.
   ================================================================ */
let _nsInitialized = false;
let lineItemCount = 0;
let totalItemsRendered = 0;

function nsOnTabOpen() {
  if (_nsInitialized) return;
  _nsInitialized = true;

  populateFinancialYears();

  const dateInput = document.getElementById('sancDate');
  if (dateInput) {
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
    dateInput.max = localDate.toISOString().split('T')[0];
  }

  if (totalItemsRendered === 0) addLineItemUI();
  nsPopulatePlanHeads();
}

function populateFinancialYears() {
  const select = document.getElementById('sancYear');
  if (!select) return;
  select.innerHTML = '';
  const today = new Date();
  const currentYear  = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentFY    = currentMonth >= 3 ? currentYear : currentYear - 1; // Indian FY: Apr–Mar
  for (let i = -5; i <= 2; i++) {
    const startYear = currentFY + i;
    const endYear   = (startYear + 1).toString().slice(-2);
    const fyStr     = `${startYear}-${endYear}`;
    const opt       = document.createElement('option');
    opt.value = fyStr; opt.textContent = fyStr;
    if (i === 0) opt.selected = true;
    select.appendChild(opt);
  }
}

// Seeds the Plan Head datalist from distinct values already in the DB
// (in addition to the 3 hardcoded common ones in the markup).
async function nsPopulatePlanHeads() {
  try {
    const cfg = getDbConfig();
    if (!cfg?.nexus?.url || !cfg?.nexus?.key) return;
    const rows = await nxFetch('sanction_header?select=plan_head&order=plan_head');
    const heads = [...new Set((rows || []).map(r => r.plan_head).filter(Boolean).map(String))].sort();
    const dl = document.getElementById('planHeadOptions');
    if (!dl || !heads.length) return;
    const existing = new Set(Array.from(dl.options).map(o => o.value));
    heads.forEach(h => {
      if (!existing.has(h)) { const o = document.createElement('option'); o.value = h; dl.appendChild(o); }
    });
  } catch (e) { console.warn('nsPopulatePlanHeads:', e.message); }
}

function updateDateDisplay() {
  const val = document.getElementById('sancDate').value;
  const display = document.getElementById('sancDateDisplay');
  if (!val) { display.textContent = ''; return; }
  const d = new Date(val);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  display.textContent = `[ ${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()} ]`;
}
document.getElementById('sancDate').addEventListener('input', updateDateDisplay);
document.getElementById('sancDate').addEventListener('change', updateDateDisplay);

function addLineItemUI() {
  lineItemCount++;
  totalItemsRendered++;
  const id = lineItemCount;
  const container = document.getElementById('lineItemsContainer');
  // Default LI code is based on the actual row count currently in the
  // DOM, not the monotonic totalItemsRendered counter — that counter
  // never resets after a full-form reset (container wiped via
  // innerHTML='' bypasses removeLineItemUI()'s decrement), so it would
  // keep climbing across sanctions instead of restarting at SW-1 for
  // each new one. Same approach updateItemBadges() already uses for
  // the "ITEM N" badge.
  const liCodePos = container.querySelectorAll('.table-panel').length + 1;
  const div = document.createElement('div');
  div.className = 'table-panel';
  div.style.cssText = 'padding:16px;margin-bottom:16px;position:relative;';
  div.id = `lineItem_${id}`;

  const removeBtnHtml = totalItemsRendered > 1
    ? `<button data-ns-action="remove" data-id="${id}" style="position:absolute;top:12px;right:16px;background:transparent;border:none;color:var(--accent-red);cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:10px;">✖ REMOVE</button>`
    : '';

  // Default "Submitted On" = current Sanctioned On date, per v16.
  const sancDateVal = document.getElementById('sancDate')?.value || '';

  div.innerHTML = `
    <div class="badge" style="position:absolute;top:-10px;left:16px;background:var(--accent-blue);color:var(--bg-dark);">ITEM ${totalItemsRendered}</div>
    ${removeBtnHtml}
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px;align-items:end;margin-top:10px;margin-bottom:8px;">
      <div class="form-group">
        <label class="form-label">ITEM NAME *</label>
        <input class="form-input" type="text" id="itemName_${id}" placeholder="Name" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">LI CODE</label>
        <input class="form-input" type="text" id="itemLiCode_${id}" value="SW-${liCodePos}" placeholder="SW-${liCodePos}" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">PROCESSING DEPOT *</label>
        <select class="form-input" id="itemProcDepot_${id}" style="font-size:12px;padding:8px 10px;">
          <option value="SBC">SBC</option><option value="YPR">YPR</option>
          <option value="SMVB">SMVB</option><option value="SGT">SGT</option>
          <option value="BAND">BAND</option><option value="SBC-HQ">SBC-HQ</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">DEPARTMENT</label>
        <select class="form-input" id="itemDept_${id}" style="font-size:12px;padding:8px 10px;">
          <option value="Mechanical" selected>Mechanical</option>
          <option value="Civil">Civil</option>
          <option value="Electrical">Electrical</option>
          <option value="S&T">S&T</option>
          <option value="TRD">TRD</option>
          <option value="Contingency">Contingency</option>
          <option value="D&G Charges">D&G Charges</option>
          <option value="EnHM">EnHM</option>
          <option value="Others">Others</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:0.7fr 0.7fr 1fr 1fr 1fr 1fr;gap:8px;align-items:end;">
      <div class="form-group">
        <label class="form-label">UNIT *</label>
        <input class="form-input" type="text" list="unitOptions" id="itemUnit_${id}" placeholder="Unit" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">QTY *</label>
        <input class="form-input" type="number" step="0.01" id="itemQty_${id}" data-ns-calc="1" placeholder="0" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">BASE PRICE *</label>
        <input class="form-input" type="number" step="0.01" id="itemBase_${id}" data-ns-calc="1" placeholder="0.00" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">TAX &amp; OTHERS</label>
        <input class="form-input" type="number" step="0.01" id="itemTax_${id}" data-ns-calc="1" placeholder="0.00" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">UNIT PRICE</label>
        <input class="form-input" type="number" id="itemPrice_${id}" placeholder="0.00" readonly style="background:rgba(0,0,0,.2);font-size:12px;color:var(--accent-green);">
      </div>
      <div class="form-group">
        <label class="form-label">TOTAL (Rs.)</label>
        <input class="form-input" type="number" id="itemTotal_${id}" placeholder="0.00" readonly style="background:rgba(0,0,0,.2);font-size:12px;color:var(--accent-cyan);font-weight:700;">
      </div>
    </div>
    <div class="estimate-row" id="estimateRow_${id}" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
      <div class="form-group">
        <label class="form-label">LIVE ESTIMATE</label>
        <select class="form-input" id="itemLiveEst_${id}" style="font-size:12px;padding:8px 10px;">
          <option value="Abstract" selected>Abstract</option>
          <option value="Detailed">Detailed</option>
          <option value="Revised">Revised</option>
          <option value="M-Modified">M-Modified</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">SUBMITTED ON</label>
        <input class="form-input" type="date" id="itemSubmitOn_${id}" value="${sancDateVal}" style="font-size:12px;">
      </div>
      <div class="form-group">
        <label class="form-label">VETTED ON</label>
        <input class="form-input" type="date" id="itemVettedOn_${id}" style="font-size:12px;">
      </div>
    </div>`;
  container.appendChild(div);

  if (document.getElementById('editEstimateToggle')?.checked) {
    const er = document.getElementById(`estimateRow_${id}`);
    if (er) er.style.display = 'grid';
  }
  updateItemBadges();
}

function toggleEditEstimate(show) {
  document.querySelectorAll('.estimate-row').forEach(el => { el.style.display = show ? 'grid' : 'none'; });
}
document.getElementById('editEstimateToggle').addEventListener('change', (e) => toggleEditEstimate(e.target.checked));

function removeLineItemUI(id) {
  const item = document.getElementById(`lineItem_${id}`);
  if (item) { item.remove(); totalItemsRendered--; updateItemBadges(); calcHeaderTotal(); }
}

function updateItemBadges() {
  document.getElementById('lineItemsContainer').querySelectorAll('.table-panel').forEach((item, index) => {
    const badge = item.querySelector('.badge');
    if (badge) badge.innerText = `ITEM ${index + 1}`;
  });
}

function calcRow(id) {
  const qty  = parseFloat(document.getElementById(`itemQty_${id}`).value)  || 0;
  const base = parseFloat(document.getElementById(`itemBase_${id}`).value) || 0;
  const tax  = parseFloat(document.getElementById(`itemTax_${id}`).value)  || 0;
  const unitPrice = base + tax;
  document.getElementById(`itemPrice_${id}`).value = unitPrice.toFixed(2);
  document.getElementById(`itemTotal_${id}`).value = (qty * unitPrice).toFixed(2);
  calcHeaderTotal();
}

function calcHeaderTotal() {
  let grand = 0;
  document.getElementById('lineItemsContainer').querySelectorAll('.table-panel').forEach(item => {
    const id = item.id.split('_')[1];
    grand += parseFloat(document.getElementById(`itemTotal_${id}`).value) || 0;
  });
  document.getElementById('sancTotalCost').value = grand.toFixed(2);
}

document.getElementById('lineItemsContainer').addEventListener('input', (e) => {
  if (e.target.dataset.nsCalc) {
    const id = e.target.id.split('_')[1];
    calcRow(id);
  }
});
document.getElementById('lineItemsContainer').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ns-action="remove"]');
  if (btn) removeLineItemUI(btn.dataset.id);
});
document.getElementById('ns_add_item_btn').addEventListener('click', () => addLineItemUI());

async function submitSanction() {
  const underPower = document.getElementById('sancUnderPower').value.trim();
  const detail      = document.getElementById('sancDetail').value.trim();
  const date        = document.getElementById('sancDate').value;
  const year        = document.getElementById('sancYear').value;
  const allocation  = document.getElementById('sancAllocation').value;
  const wid         = document.getElementById('sancWid').value.trim();
  const totalCost   = parseFloat(document.getElementById('sancTotalCost').value) || 0;

  if (!underPower || !detail || !date || !wid) {
    showToast('FILL ALL REQUIRED FIELDS', 'error');
    return;
  }

  const lineItems = [];
  document.getElementById('lineItemsContainer').querySelectorAll('.table-panel').forEach(item => {
    const id = item.id.split('_')[1];
    const liName = (document.getElementById(`itemName_${id}`)?.value || '').trim();
    if (!liName) return;
    const _qty   = parseFloat(document.getElementById(`itemQty_${id}`)?.value)   || 0;
    const _price = parseFloat(document.getElementById(`itemPrice_${id}`)?.value) || 0;
    const _total = parseFloat(document.getElementById(`itemTotal_${id}`)?.value) || (_qty * _price) || 0;
    lineItems.push({
      item_name: liName,
      item_description: liName,
      unit: (document.getElementById(`itemUnit_${id}`)?.value || '').trim(),
      // See the file-header note: v16's actual write payload uses
      // `quantity`, not `qty`, even though every read path expects
      // `qty`. Preserved as-is pending schema confirmation.
      quantity: _qty,
      unit_rate: _price,
      total_value: _total,
      department: document.getElementById(`itemDept_${id}`)?.value || 'Mechanical',
      live_estimate: document.getElementById(`itemLiveEst_${id}`)?.value || 'Abstract',
      e_submitted_on: document.getElementById(`itemSubmitOn_${id}`)?.value || date || null,
      e_vetted_on: document.getElementById(`itemVettedOn_${id}`)?.value || null,
      _processing_depot: document.getElementById(`itemProcDepot_${id}`)?.value || 'SBC',
      _consignee_depot: document.getElementById(`itemProcDepot_${id}`)?.value || 'SBC',
      _vetted_cost: _total,
      // Can be duplicate, can be null — pre-filled with an incremental
      // default (SW-1, SW-2, ...) but freely editable/overwritable.
      li_code: (document.getElementById(`itemLiCode_${id}`)?.value || '').trim() || null,
    });
  });

  const plan_head_val = document.getElementById('sancPlanHead')?.value?.trim() || '';

  const _nsChk = canEditRecord({ plan_head: Number(plan_head_val) || plan_head_val, processing_depot: null });
  if (!_nsChk.ok) {
    document.getElementById('sanctionSubmitStatus').style.color = 'var(--accent-red)';
    document.getElementById('sanctionSubmitStatus').textContent = '✕ BLOCKED: ' + _nsChk.reason;
    showToast('SANCTION BLOCKED — OUTSIDE YOUR PLAN HEAD ASSIGNMENT', 'error');
    return;
  }

  const origSancName = (document.getElementById('sancOriginalName')?.value || '').trim() || null;
  const _codeSuffix = Date.now().toString().slice(-6);
  const sanctionCode = `SBC/${plan_head_val}/${year}/${_codeSuffix}`;

  const sanctionPayload = {
    code: sanctionCode,
    under_power: underPower,
    original_sanction_name: origSancName || detail,
    sanction_year: year,
    plan_head: plan_head_val,
    allocation_type: allocation,
    sanctioned_amount: totalCost,
    sanctioned_on: date || null,
    // Now recorded as its own column. Left in remarks too (unchanged
    // below) for backward visibility — remove that portion of the
    // remarks concatenation if you'd rather not have it duplicated.
    wid: wid || null,
    remarks: detail + (wid ? ` · WID: ${wid}` : '') + (date ? ` · Sanctioned: ${date}` : ''),
    state: 'Active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const statusEl = document.getElementById('sanctionSubmitStatus');
  const btn = document.getElementById('btnSubmitSanction');
  btn.disabled = true;
  btn.textContent = 'SUBMITTING...';
  statusEl.textContent = '';

  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      const saved = await nsCreateSanction(sanctionPayload, lineItems);
      const newId = saved?.sanction_id || saved?.id || '?';
      statusEl.style.color = 'var(--accent-green)';
      statusEl.textContent = `✓ SAVED TO NEXUS DB — Sanction ID: ${newId}`;
      showToast('SANCTION SUBMITTED → NEXUS');
      setTimeout(() => {
        document.getElementById('sancUnderPower').value = '';
        document.getElementById('sancDetail').value = '';
        document.getElementById('sancDate').value = '';
        document.getElementById('sancWid').value = '';
        document.getElementById('sancTotalCost').value = '';
        document.getElementById('lineItemsContainer').innerHTML = '';
        addLineItemUI();
        statusEl.textContent = '';
      }, 2500);
    } else {
      statusEl.style.color = 'var(--accent-red)';
      statusEl.textContent = '✕ NO DATABASE CONFIGURED — Settings → Database';
      showToast('NO DB CONFIGURED', 'error');
    }
  } catch (e) {
    statusEl.style.color = 'var(--accent-red)';
    statusEl.textContent = '✕ ERROR: ' + e.message;
    showToast('SUBMIT ERROR: ' + e.message.slice(0, 30), 'error');
  }

  btn.disabled = false;
  btn.textContent = 'SUBMIT SANCTION';
}
document.getElementById('btnSubmitSanction').addEventListener('click', submitSanction);

// Sequential 3-step write: header → line items → sub-items. PostgREST
// has no real cross-table transaction, so (matching v16) this is a
// best-effort sequence, not an atomic transaction — if step 2 or 3
// fails, the header row from step 1 has already been committed.
async function nsCreateSanction(sanctionData, lineItems) {
  const headerResult = await nxFetch('sanction_header', { method: 'POST', body: sanctionData, prefer: 'return=representation' });
  if (!headerResult || !headerResult.length) throw new Error('sanction_header insert returned no data — check RLS policy.');
  const sancRow = headerResult[0];

  const newSanctionId = sancRow.sanction_id || sancRow.id;
  if (!newSanctionId) throw new Error('Could not determine sanction_id: ' + JSON.stringify(sancRow));

  if (lineItems.length) {
    const itemsForLI = lineItems.map(li => {
      const clean = { ...li, sanction_id: newSanctionId };
      delete clean._processing_depot; delete clean._consignee_depot; delete clean._vetted_cost;
      return clean;
    });
    const liResult = await nxFetch('sanction_line_item', { method: 'POST', body: itemsForLI, prefer: 'return=representation' });

    if (Array.isArray(liResult) && liResult.length === lineItems.length) {
      const subItems = liResult.map((liRow, idx) => ({
        line_item_id: liRow.line_item_id,
        sub_item_name: lineItems[idx].item_name,
        consignee_depot: lineItems[idx]._consignee_depot || 'SBC',
        processing_depot: lineItems[idx]._processing_depot || 'SBC',
        // Same naming note as above — v16 writes `quantity` here too.
        quantity: lineItems[idx].quantity || 0,
        vetted_cost: lineItems[idx]._vetted_cost || 0,
        total_value: lineItems[idx]._vetted_cost || 0,
        status: 'Indent Under Prep',
        under_power: sanctionData.under_power || '',
        state: 'Active',
      }));
      await nxFetch('sanction_sub_item', { method: 'POST', body: subItems, prefer: 'return=minimal' });
    }
  }

  return sancRow;
}

/* ================================================================
   EDIT SANCTION
   ================================================================
   Reads:  sanction_header, sanction_line_item
   Writes: sanction_header (PATCH), sanction_line_item (POST new /
           PATCH edit / PATCH qty=0 for delete + cascade sub_items)

   THREE FIXES vs v16, found while porting:

   1. esResetDisplay() is called twice in v16's esOnFilterChange()
      (when filters are cleared, or match nothing) but is never
      defined anywhere in the 11k-line file — an unguarded
      ReferenceError on a fairly common path (clearing any filter
      dropdown). Written from scratch here, based on what the two
      call sites clearly need it to do.

   2. esFillHeaderStrip() reads `s.total_cost` from the raw
      sanction_header row, but v16 has its own comment elsewhere
      confirming that column was removed in a schema migration —
      `sanctioned_amount` is the real one now. Every other place in
      v16 that needs this value reads it from a pre-remapped object
      (`total_cost: row.sanctioned_amount`); this was the one
      leftover direct reference to the old name, so the Total Cost
      field in the header strip would have always shown "—".

   3. esHasUnsavedChanges() checks whether ES.actions has any keys —
      but ES.actions is populated with 'Retain' for every line item
      the moment a sanction is loaded, before any edit happens. That
      makes the check true essentially always, so the RESET button's
      "unsaved changes" confirm would fire even with zero edits made.
      Fixed to check for an action that's actually NOT 'Retain', or a
      populated editValues entry, or an in-progress new-item row.

   A naming note carried over from New Sanction applies here too:
   every write in this file uses `qty` (not `quantity`) against both
   sanction_line_item and sanction_sub_item — which, unlike New
   Sanction's createSanction(), v16 itself does consistently here.
   That's actually more evidence `qty` is the real column name and
   New Sanction's `quantity` is the stale one.
   ================================================================ */
const ES = {
  sanctions: [],
  filtered: null,
  lineItems: [],
  actions: {},
  editValues: {},
  newItemSeq: 0,
  multiMode: false,   // true when 2+ sanctions match the current filters (read-only union view)
  liSanction: {},      // line_item_id → owning sanction_header row, used for the per-row badge in multi mode
};

function truncOpt(v, max = 50) {
  return v && v.length > max ? v.slice(0, max) + '...' : v;
}

async function esLoadFilters() {
  const upSel = document.getElementById('es_under_power');
  const yrSel = document.getElementById('es_year');
  upSel.innerHTML = '<option value="">-- SELECT --</option>';
  yrSel.innerHTML = '<option value="">-- SELECT --</option>';

  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      ES.sanctions = await nxFetch('sanction_header?select=*&order=sanction_year.desc,under_power.asc');
    } else {
      ES.sanctions = [];
      showToast('No DB — configure Nexus first', 'error');
      return;
    }
    const ups = [...new Set(ES.sanctions.map(r => r.under_power).filter(Boolean))].sort();
    const yrs = [...new Set(ES.sanctions.map(r => r.sanction_year).filter(Boolean))].sort().reverse();
    ups.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = truncOpt(v, 40); upSel.appendChild(o); });
    yrs.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; yrSel.appendChild(o); });
    showToast('SANCTIONS LOADED · ' + ES.sanctions.length + ' RECORDS');
  } catch (e) { showToast('LOAD ERROR: ' + e.message.slice(0, 40), 'error'); }
}
document.getElementById('es_refresh_btn').addEventListener('click', esLoadFilters);

function esOnFilterChange() {
  const up = document.getElementById('es_under_power').value;
  const yr = document.getElementById('es_year').value;
  const alloc = document.getElementById('es_allocation').value;
  const allFilled = up && yr && alloc;

  document.getElementById('es_add_new_item_btn').style.display = allFilled ? '' : 'none';

  if (!up && !yr && !alloc) { esResetDisplay(); return; }

  const matches = ES.sanctions.filter(r =>
    (!up || r.under_power === up) &&
    (!yr || r.sanction_year === yr) &&
    (!alloc || r.allocation_type === alloc)
  );

  if (matches.length === 0) {
    esResetDisplay();
    document.getElementById('es_header_strip').style.display = 'none';
    showToast('NO SANCTIONS MATCH THESE FILTERS', 'error');
    return;
  }

  if (matches.length === 1) {
    ES.multiMode = false;
    const s = matches[0];
    ES.filtered = s;
    esFillHeaderStrip(s);
    esFetchLineItems(s.sanction_id);
    return;
  }

  // 2+ matches — union view: all matched sanctions' line items shown
  // together, read-only, header strip hidden until filters narrow to one.
  ES.multiMode = true;
  ES.filtered = null;
  document.getElementById('es_header_strip').style.display = 'none';
  document.getElementById('esh_alias_banner').style.display = 'none';
  document.getElementById('es_add_new_item_btn').style.display = 'none';
  esFetchLineItemsMulti(matches);
}
['es_under_power', 'es_year', 'es_allocation'].forEach(id => {
  document.getElementById(id).addEventListener('change', esOnFilterChange);
});

// Hides the header strip / alias banner / line items section and
// clears selection state — used whenever the filter combination
// stops resolving to a single sanction. (Written from scratch — see
// file-header note: this didn't exist anywhere in v16.)
function esResetDisplay() {
  document.getElementById('es_header_strip').style.display = 'none';
  document.getElementById('esh_alias_banner').style.display = 'none';
  document.getElementById('es_items_section').style.display = 'none';
  document.getElementById('es_items_body').innerHTML = '';
  ES.filtered = null;
  ES.lineItems = [];
  ES.actions = {};
  ES.editValues = {};
  ES.multiMode = false;
  ES.liSanction = {};
}

function esFillHeaderStrip(s) {
  document.getElementById('esh_id').textContent = s.sanction_id;
  document.getElementById('esh_up').textContent = s.under_power || '—';
  document.getElementById('esh_yr').textContent = s.sanction_year || '—';
  document.getElementById('esh_alloc').textContent = s.allocation_type || '—';
  document.getElementById('esh_ph').textContent = s.plan_head || '—';
  // Fixed: v16 reads s.total_cost here, a column that no longer
  // exists — sanctioned_amount is the real one (see file-header note).
  document.getElementById('esh_cost').textContent = s.sanctioned_amount
    ? 'Rs. ' + Number(s.sanctioned_amount).toLocaleString('en-IN') : '—';
  document.getElementById('es_header_strip').style.display = '';
  esLoadAliasBanner(s.sanction_id, s.original_sanction_name);
}

async function esLoadAliasBanner(sanctionId, canonicalName) {
  const banner = document.getElementById('esh_alias_banner');
  const nameEl = document.getElementById('esh_alias_canonical');
  const listEl = document.getElementById('esh_alias_list');
  if (!banner) return;

  if (!canonicalName) { banner.style.display = 'none'; return; }

  nameEl.textContent = canonicalName;
  listEl.innerHTML = '<span style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--text-muted);">LOADING...</span>';
  banner.style.display = '';

  try {
    const aliases = await nxFetch(`sanction_alias?canonical_name=eq.${encodeURIComponent(canonicalName)}&order=sanction_year.asc`);

    if (!aliases || !aliases.length) {
      listEl.innerHTML = '<span style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--text-muted);">NO ALIASES RECORDED YET</span>';
      return;
    }

    listEl.innerHTML = aliases.map(a => {
      const isCurrent = String(a.sanction_id) === String(sanctionId);
      return `<div style="display:inline-flex;align-items:center;gap:6px;
        background:${isCurrent ? 'rgba(255,214,10,0.15)' : 'var(--bg-card)'};
        border:1px solid ${isCurrent ? 'var(--accent-warn)' : 'var(--border)'};
        border-radius:4px;padding:4px 10px;">
        <span style="font-family:'Share Tech Mono',monospace;font-size:10px;
          color:${isCurrent ? 'var(--accent-warn)' : 'var(--text-muted)'};">
          ${a.sanction_year}
        </span>
        <span style="font-family:'Share Tech Mono',monospace;font-size:10px;
          color:${isCurrent ? 'var(--accent-warn)' : 'var(--text-secondary)'};font-weight:700;">
          → ${a.sanction_code}
        </span>
        ${isCurrent ? '<span style="font-family:\'Share Tech Mono\',monospace;font-size:8px;color:var(--accent-warn);">← CURRENT</span>' : ''}
      </div>`;
    }).join('');
  } catch (e) {
    // sanction_alias table might not exist on every install — hide gracefully.
    banner.style.display = 'none';
    console.warn('esLoadAliasBanner:', e.message);
  }
}

async function esFetchLineItems(sanctionId) {
  const tbody = document.getElementById('es_items_body');
  tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px;font-family:\'Share Tech Mono\',monospace;font-size:10px;color:var(--text-muted);">⏳ LOADING LINE ITEMS...</td></tr>';
  document.getElementById('es_items_section').style.display = '';
  ES.actions = {}; ES.editValues = {}; ES.newItemSeq = 0; ES.liSanction = {};

  try {
    ES.lineItems = await nxFetch(`sanction_line_item?select=*&sanction_id=eq.${sanctionId}&order=line_item_id.asc`);
    ES.lineItems.forEach(li => { ES.actions[li.line_item_id] = 'Retain'; });
    document.getElementById('es_items_count').textContent = '— ' + ES.lineItems.length + ' ITEMS';
    esRenderLineItems();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:20px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-red);">ERROR: ${e.message}</td></tr>`;
  }
}

// 2+ sanctions matched the current filters — fetch every matched
// sanction's line items in one query and show them as a single
// read-only union table. Nothing in the union is left out, and the
// header strip stays hidden (there's no single sanction to attach it
// to) until the filters narrow back down to exactly one match.
async function esFetchLineItemsMulti(sanctionRows) {
  const tbody = document.getElementById('es_items_body');
  tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px;font-family:\'Share Tech Mono\',monospace;font-size:10px;color:var(--text-muted);">⏳ LOADING LINE ITEMS...</td></tr>';
  document.getElementById('es_items_section').style.display = '';
  ES.actions = {}; ES.editValues = {}; ES.newItemSeq = 0; ES.liSanction = {};

  const sancMap = {};
  sanctionRows.forEach(s => { sancMap[s.sanction_id] = s; });
  const ids = sanctionRows.map(s => s.sanction_id).join(',');

  try {
    ES.lineItems = await nxFetch(`sanction_line_item?select=*&sanction_id=in.(${ids})&order=sanction_id.asc,line_item_id.asc`);
    ES.lineItems.forEach(li => {
      ES.actions[li.line_item_id] = 'Retain';
      ES.liSanction[li.line_item_id] = sancMap[li.sanction_id] || null;
    });
    document.getElementById('es_items_count').textContent =
      `— ${ES.lineItems.length} ITEMS ACROSS ${sanctionRows.length} SANCTIONS (READ-ONLY — NARROW FILTERS TO EDIT)`;
    esRenderLineItems();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:20px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-red);">ERROR: ${e.message}</td></tr>`;
  }
}

function esRenderLineItems() {
  const tbody = document.getElementById('es_items_body');
  const rows = [];

  ES.lineItems.forEach((li, i) => {
    const action = ES.multiMode ? 'Retain' : (ES.actions[li.line_item_id] || 'Retain');
    const ev = ES.multiMode ? {} : (ES.editValues[li.line_item_id] || {});
    const isEdit = !ES.multiMode && action === 'Edit';
    const isDel = !ES.multiMode && action === 'Delete';
    const rowStyle = isDel ? 'opacity:0.5;background:rgba(255,56,96,0.05);' : '';

    // Lines created via New Sanction only populate quantity/unit_rate/
    // total_amount (not qty/base_price/tax_and_others/processing_depot,
    // which are Edit-Sanction-specific columns). Fall back so display
    // doesn't show nulls for items that were never touched here.
    const fbQty = li.qty != null ? li.qty : (li.quantity || 0);
    const fbTotal = li.total_value != null ? li.total_value : (li.total_amount || 0);
    const fbBase = li.base_price != null ? li.base_price : (li.unit_rate != null ? li.unit_rate : (fbQty > 0 ? fbTotal / fbQty : fbTotal));
    const fbTax = li.tax_and_others != null ? li.tax_and_others : 0;
    const fbDepot = li.processing_depot || '';

    const qty = isEdit ? (ev.qty ?? fbQty) : fbQty;
    const base = isEdit ? (ev.base_price ?? fbBase) : fbBase;
    const tax = isEdit ? (ev.tax_and_others ?? fbTax) : fbTax;
    const up = parseFloat(base || 0) + parseFloat(tax || 0);
    const total = parseFloat(qty || 0) * up;

    const liveEst = ev.live_estimate ?? li.live_estimate ?? 'Abstract';
    const submitOn = ev.e_submitted_on ?? li.e_submitted_on ?? '';
    const vettedOn = ev.e_vetted_on ?? li.e_vetted_on ?? '';

    // Multi mode: small cyan badge under the item name showing which
    // sanction this row belongs to, since the header strip is hidden
    // and rows from several sanctions are interleaved in one table.
    const sanc = ES.multiMode ? ES.liSanction[li.line_item_id] : null;
    const sancBadge = sanc
      ? `<div style="margin-top:3px;font-family:'Share Tech Mono',monospace;font-size:8px;color:var(--accent-cyan);letter-spacing:0.5px;">
           ${sanc.sanction_year || '—'} · ${sanc.allocation_type || '—'} · #${sanc.sanction_id}
         </div>`
      : '';

    rows.push(`<tr style="${rowStyle}" data-li-id="${li.line_item_id}">
      <td class="pd-ro muted">${i + 1}</td>
      <td class="pd-ro" style="font-weight:600;color:var(--text-primary);">${li.item_name || '—'}</td>
      <td class="pd-ro muted">${li.li_code || '—'}</td>
      <td class="pd-ro muted">${li.unit || '—'}</td>
      <td class="pd-cell">${isEdit
        ? `<input class="pd-inp" type="number" step="0.01" value="${qty || ''}" style="width:80px;" data-es-edit="qty">`
        : `<span class="pd-ro muted">${qty || '—'}</span>`}</td>
      <td class="pd-cell">${isEdit
        ? `<input class="pd-inp" type="number" step="0.01" value="${base || ''}" style="width:90px;" data-es-edit="base_price">`
        : `<span class="pd-ro muted">${base || '—'}</span>`}</td>
      <td class="pd-cell">${isEdit
        ? `<input class="pd-inp" type="number" step="0.01" value="${tax || ''}" style="width:90px;" data-es-edit="tax_and_others">`
        : `<span class="pd-ro muted">${tax || '—'}</span>`}</td>
      <td class="pd-ro" style="color:var(--accent-green);">${up > 0 ? up.toFixed(2) : '—'}</td>
      <td class="pd-ro" style="color:var(--accent-cyan);font-weight:700;">${total > 0 ? 'Rs.' + total.toLocaleString('en-IN') : '—'}</td>
      <td class="pd-cell">${isEdit
        ? `<select class="pd-inp f-select" style="min-width:100px;font-size:11px;" data-es-edit="processing_depot">
            ${['SBC', 'YPR', 'SMVB', 'SGT', 'BAND', 'SBC-HQ'].map(d => `<option value="${d}" ${(ev.processing_depot || fbDepot) === d ? 'selected' : ''}>${d}</option>`).join('')}
           </select>`
        : `<span class="pd-ro muted">${fbDepot || '—'}</span>`}</td>
      <td class="pd-cell">${ES.multiMode
        ? `<span class="pd-ro muted">${liveEst || '—'}</span>`
        : `<select class="pd-inp f-select" style="min-width:100px;font-size:11px;" data-es-estimate="live_estimate">
            ${['Abstract', 'Detailed', 'Revised', 'M-Modified'].map(o => `<option value="${o}" ${liveEst === o ? 'selected' : ''}>${o}</option>`).join('')}
           </select>`}</td>
      <td class="pd-cell">${ES.multiMode
        ? `<span class="pd-ro muted">${submitOn || '—'}</span>`
        : `<input class="pd-inp" type="date" value="${submitOn || ''}" style="width:115px;" data-es-estimate="e_submitted_on">`}</td>
      <td class="pd-cell">${ES.multiMode
        ? `<span class="pd-ro muted">${vettedOn || '—'}</span>`
        : `<input class="pd-inp" type="date" value="${vettedOn || ''}" min="${submitOn || ''}" style="width:115px;" data-es-estimate="e_vetted_on">`}</td>
      <td class="pd-cell">${ES.multiMode
        ? `<span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:1px;">VIEW ONLY</span>`
        : `<select class="f-select" style="min-width:100px;font-size:11px;" data-es-action-select="1">
            <option ${action === 'Retain' ? 'selected' : ''}>Retain</option>
            <option ${action === 'Edit' ? 'selected' : ''}>Edit</option>
            <option ${action === 'Delete' ? 'selected' : ''}>Delete</option>
           </select>`}</td>
      <td class="pd-cell"></td>
    </tr>`);
  });

  // New items live only in the DOM. Detach them before clearing tbody so
  // their live .value properties survive — outerHTML only captures the
  // value *attribute*, not what the user typed into the value *property*.
  const liveNewRows = [...document.querySelectorAll('[data-es-new]')];

  tbody.innerHTML = rows.join('');
  liveNewRows.forEach(r => tbody.appendChild(r));
}

function esSetAction(lineItemId, action) {
  const prev = ES.actions[lineItemId];
  if (prev === action) return; // no change — skip re-render, preserves new-row typed values
  ES.actions[lineItemId] = action;
  if (action === 'Retain' && prev === 'Edit') delete ES.editValues[lineItemId];
  esRenderLineItems();
}

function esUpdateEdit(lineItemId, field, value) {
  if (!ES.editValues[lineItemId]) ES.editValues[lineItemId] = {};
  // Fixed: this was blanket parseFloat-ing every data-es-edit field,
  // including processing_depot's <select> — parseFloat('YPR') || 0
  // silently corrupted any depot pick into the number 0, which then
  // fell through to the wrong default on re-render/submit.
  const NUMERIC_EDIT_FIELDS = new Set(['qty', 'base_price', 'tax_and_others']);
  ES.editValues[lineItemId][field] = NUMERIC_EDIT_FIELDS.has(field) ? (parseFloat(value) || 0) : value;
}

// Live Estimate / Submitted On / Vetted On are always editable. Editing
// any of them auto-promotes a 'Retain' row to 'Edit'. Re-render is only
// triggered on that actual transition — *not* on every keystroke —
// because a full re-render replaces the tbody via innerHTML, and any
// in-progress "+ NEW ITEM" rows would lose their live-typed values
// (outerHTML reflects the value *attribute*, not what the user typed
// into the value *property*). Matches v16's own documented reasoning
// for doing it this way.
function esUpdateEstimate(lineItemId, field, value) {
  if (!ES.editValues[lineItemId]) ES.editValues[lineItemId] = {};
  ES.editValues[lineItemId][field] = value;

  const li = ES.lineItems.find(x => String(x.line_item_id) === String(lineItemId));
  let needsRerender = false;
  if (li) {
    const ev = ES.editValues[lineItemId];
    const origLE = li.live_estimate || 'Abstract';
    const origSO = li.e_submitted_on || '';
    const origVO = li.e_vetted_on || '';
    const changed =
      (ev.live_estimate !== undefined && ev.live_estimate !== origLE) ||
      (ev.e_submitted_on !== undefined && ev.e_submitted_on !== origSO) ||
      (ev.e_vetted_on !== undefined && ev.e_vetted_on !== origVO);
    if (changed && (ES.actions[lineItemId] || 'Retain') === 'Retain') {
      ES.actions[lineItemId] = 'Edit';
      needsRerender = true;
    }
  }
  if (needsRerender) esRenderLineItems();
}

function esFillAllEstimate(checked) {
  if (!ES.lineItems.length) return;
  const first = ES.lineItems[0];
  const firstId = first.line_item_id;
  const firstEv = ES.editValues[firstId] || {};
  const fillValues = {
    live_estimate: firstEv.live_estimate ?? first.live_estimate ?? 'Abstract',
    e_submitted_on: firstEv.e_submitted_on ?? first.e_submitted_on ?? '',
    e_vetted_on: firstEv.e_vetted_on ?? first.e_vetted_on ?? '',
  };

  ES.lineItems.forEach((li, idx) => {
    if (idx === 0) return; // row 1 is the source, left untouched
    if (checked) {
      if (!ES.editValues[li.line_item_id]) ES.editValues[li.line_item_id] = {};
      Object.assign(ES.editValues[li.line_item_id], fillValues);
      const changed =
        fillValues.live_estimate !== (li.live_estimate || 'Abstract') ||
        fillValues.e_submitted_on !== (li.e_submitted_on || '') ||
        fillValues.e_vetted_on !== (li.e_vetted_on || '');
      if (changed && (ES.actions[li.line_item_id] || 'Retain') === 'Retain') {
        ES.actions[li.line_item_id] = 'Edit';
      }
    } else {
      const ev = ES.editValues[li.line_item_id];
      if (ev) {
        delete ev.live_estimate; delete ev.e_submitted_on; delete ev.e_vetted_on;
        if (Object.keys(ev).length === 0) {
          delete ES.editValues[li.line_item_id];
          if (ES.actions[li.line_item_id] === 'Edit') delete ES.actions[li.line_item_id];
        }
      }
    }
  });
  esRenderLineItems();
}
document.getElementById('es_fill_all_estimate').addEventListener('change', (e) => esFillAllEstimate(e.target.checked));

function esAddNewLineItem() {
  ES.newItemSeq++;
  const seq = ES.newItemSeq;
  // Default continues from the count of line items already under this
  // sanction (existing + any other in-progress new rows), so it doesn't
  // restart at SW-1 and collide with codes assigned at sanction creation.
  const liCodePos = ES.lineItems.length + document.querySelectorAll('[data-es-new]').length + 1;
  const tbody = document.getElementById('es_items_body');
  const tr = document.createElement('tr');
  tr.id = `es_new_${seq}`;
  tr.setAttribute('data-es-new', '1');
  tr.innerHTML = `
    <td class="pd-ro muted">NEW</td>
    <td class="pd-cell"><input class="pd-inp" type="text" id="es_ni_name_${seq}" placeholder="Item name *" style="min-width:160px;"></td>
    <td class="pd-cell"><input class="pd-inp" type="text" id="es_ni_licode_${seq}" value="SW-${liCodePos}" placeholder="SW-${liCodePos}" style="width:80px;"></td>
    <td class="pd-cell"><input class="pd-inp" type="text" id="es_ni_unit_${seq}" list="unitOptions" placeholder="Unit" style="width:70px;"></td>
    <td class="pd-cell"><input class="pd-inp" type="number" step="0.01" id="es_ni_base_${seq}" placeholder="0.00" style="width:90px;" data-es-new-calc="${seq}"></td>
    <td class="pd-cell"><input class="pd-inp" type="number" step="0.01" id="es_ni_tax_${seq}"  placeholder="0.00" style="width:90px;" data-es-new-calc="${seq}"></td>
    <td class="pd-cell"><input class="pd-inp" type="number" id="es_ni_up_${seq}"    placeholder="0.00" style="width:80px;color:var(--accent-green);" readonly></td>
    <td class="pd-cell"><input class="pd-inp" type="number" id="es_ni_total_${seq}" placeholder="0.00" style="width:100px;color:var(--accent-cyan);font-weight:700;" readonly></td>
    <td class="pd-cell">
      <select class="pd-inp f-select" id="es_ni_pdepot_${seq}" style="min-width:90px;font-size:11px;">
        <option value="SBC">SBC</option><option value="YPR">YPR</option>
        <option value="SMVB">SMVB</option><option value="SGT">SGT</option>
        <option value="BAND">BAND</option><option value="SBC-HQ">SBC-HQ</option>
      </select>
    </td>
    <td class="pd-cell">
      <select class="pd-inp f-select" id="es_ni_liveest_${seq}" style="min-width:100px;font-size:11px;">
        <option value="Abstract" selected>Abstract</option>
        <option value="Detailed">Detailed</option>
        <option value="Revised">Revised</option>
        <option value="M-Modified">M-Modified</option>
      </select>
    </td>
    <td class="pd-cell"><input class="pd-inp" type="date" id="es_ni_submiton_${seq}" style="width:115px;"></td>
    <td class="pd-cell"><input class="pd-inp" type="date" id="es_ni_vettedon_${seq}" style="width:115px;"></td>
    <td class="pd-cell">
      <select class="f-select" style="min-width:80px;font-size:11px;" disabled>
        <option selected>New</option>
      </select>
    </td>
    <td class="pd-cell">
      <button class="btn-warn" data-es-action="remove-new" data-seq="${seq}" style="font-size:10px;padding:3px 8px;">✖</button>
    </td>`;
  tbody.appendChild(tr);
}
document.getElementById('es_add_new_item_btn').addEventListener('click', esAddNewLineItem);

function esCalcNew(seq) {
  const base = parseFloat(document.getElementById(`es_ni_base_${seq}`)?.value) || 0;
  const tax = parseFloat(document.getElementById(`es_ni_tax_${seq}`)?.value) || 0;
  const qty = parseFloat(document.getElementById(`es_ni_qty_${seq}`)?.value) || 0;
  const up = base + tax;
  const total = qty * up;
  const elUp = document.getElementById(`es_ni_up_${seq}`);
  const elT = document.getElementById(`es_ni_total_${seq}`);
  if (elUp) elUp.value = up.toFixed(2);
  if (elT) elT.value = total.toFixed(2);
}

// ── Single delegated listener for the whole line-items tbody, covering
//    both existing-row edit cells (data-es-edit/data-es-estimate/
//    data-es-action-select) and new-item rows (data-es-new-calc). ──
document.getElementById('es_items_body').addEventListener('change', (e) => {
  const el = e.target;
  const row = el.closest('tr[data-li-id]');
  if (row) {
    const liId = row.dataset.liId;
    if (el.dataset.esEdit)     { esUpdateEdit(liId, el.dataset.esEdit, el.value); return; }
    if (el.dataset.esEstimate) { esUpdateEstimate(liId, el.dataset.esEstimate, el.value); return; }
    if (el.dataset.esActionSelect) { esSetAction(liId, el.value); return; }
  }
});
document.getElementById('es_items_body').addEventListener('input', (e) => {
  if (e.target.dataset.esNewCalc) esCalcNew(e.target.dataset.esNewCalc);
});
document.getElementById('es_items_body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-es-action="remove-new"]');
  if (btn) document.getElementById(`es_new_${btn.dataset.seq}`)?.remove();
});
document.getElementById('es_edit_estimate_toggle').addEventListener('change', (e) => {
  document.getElementById('es_items_table').classList.toggle('es-hide-estimate', !e.target.checked);
});

async function esSubmitChanges() {
  if (!ES.filtered) { showToast('SELECT A SANCTION FIRST', 'error'); return; }

  const msgEl = document.getElementById('es_submit_msg');
  const btn = document.getElementById('es_submit_btn');
  btn.disabled = true; btn.textContent = 'SUBMITTING...';
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = 'Processing...';

  let results = { retained: 0, edited: 0, deleted: 0, newAdded: 0, errors: 0 };

  const cfg = getDbConfig();
  if (!cfg?.nexus?.url || !cfg?.nexus?.key) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ NO DATABASE CONFIGURED — Settings → Database';
    btn.disabled = false; btn.textContent = 'SUBMIT CHANGES';
    showToast('NO DB CONFIGURED', 'error');
    return;
  }

  const _esChk = canEditRecord({ plan_head: ES.filtered?.plan_head, processing_depot: ES.filtered?.processing_depot });
  if (!_esChk.ok) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ EDIT BLOCKED: ' + _esChk.reason;
    btn.disabled = false; btn.textContent = 'SUBMIT CHANGES';
    showToast('EDIT BLOCKED — OUTSIDE YOUR ASSIGNMENT', 'error');
    return;
  }

  // Validate Live Estimate / Submitted On / Vetted On for every 'Edit'
  // row before writing anything: (1) Live Estimate and Submitted On
  // must change together; (2) Vetted On can't precede Submitted On.
  for (const li of ES.lineItems) {
    if ((ES.actions[li.line_item_id] || 'Retain') !== 'Edit') continue;
    const ev = ES.editValues[li.line_item_id] || {};
    const origLE = li.live_estimate || 'Abstract';
    const origSO = li.e_submitted_on || '';
    const leChanged = ev.live_estimate !== undefined && ev.live_estimate !== origLE;
    const soChanged = ev.e_submitted_on !== undefined && ev.e_submitted_on !== origSO;
    if (leChanged !== soChanged) {
      msgEl.style.color = 'var(--accent-red)';
      msgEl.textContent = `✕ "${li.item_name}": LIVE ESTIMATE and SUBMITTED ON must be changed together.`;
      btn.disabled = false; btn.textContent = 'SUBMIT CHANGES';
      showToast('VALIDATION FAILED — SEE MESSAGE BELOW SUBMIT', 'error');
      return;
    }
    const effSO = ev.e_submitted_on ?? origSO;
    const effVO = ev.e_vetted_on ?? (li.e_vetted_on || '');
    if (effVO && effSO && effVO < effSO) {
      msgEl.style.color = 'var(--accent-red)';
      msgEl.textContent = `✕ "${li.item_name}": VETTED ON (${effVO}) cannot be earlier than SUBMITTED ON (${effSO}).`;
      btn.disabled = false; btn.textContent = 'SUBMIT CHANGES';
      showToast('VALIDATION FAILED — SEE MESSAGE BELOW SUBMIT', 'error');
      return;
    }
  }

  try {
    for (const li of ES.lineItems) {
      const action = ES.actions[li.line_item_id] || 'Retain';

      if (action === 'Retain') {
        results.retained++;

      } else if (action === 'Edit') {
        const ev = ES.editValues[li.line_item_id] || {};
        const _fbQty = li.qty != null ? li.qty : (li.quantity || 0);
        const _fbTotal = li.total_value != null ? li.total_value : (li.total_amount || 0);
        const _fbBase = li.base_price != null ? li.base_price : (li.unit_rate != null ? li.unit_rate : (_fbQty > 0 ? _fbTotal / _fbQty : _fbTotal));
        const _fbTax = li.tax_and_others != null ? li.tax_and_others : 0;
        const _fbDepot = li.processing_depot || 'SBC';

        const base = ev.base_price ?? _fbBase;
        const tax = ev.tax_and_others ?? _fbTax;
        const qty = ev.qty ?? _fbQty;
        const depot = ev.processing_depot ?? _fbDepot;
        const up = (parseFloat(base) || 0) + (parseFloat(tax) || 0);
        const total = (parseFloat(qty) || 0) * up;
        const liveEstimate = ev.live_estimate ?? li.live_estimate ?? 'Abstract';
        const submittedOn = ev.e_submitted_on ?? li.e_submitted_on ?? null;
        const vettedOn = ev.e_vetted_on ?? li.e_vetted_on ?? null;
        try {
          await nxFetch(`sanction_line_item?line_item_id=eq.${li.line_item_id}`, {
            method: 'PATCH',
            body: {
              qty, base_price: base, tax_and_others: tax, unit_price: up,
              total_value: total, processing_depot: depot,
              live_estimate: liveEstimate,
              e_submitted_on: submittedOn || null,
              e_vetted_on: vettedOn || null,
              updated_at: new Date().toISOString(),
            },
            prefer: 'return=representation',
          });
          results.edited++;

          // Live Estimate = Detailed propagates Submitted/Vetted On to
          // every sub-item under this line item (de_submit_date/de_vetted_on).
          if (liveEstimate === 'Detailed' && (submittedOn || vettedOn)) {
            try {
              const subPatch = {};
              if (submittedOn) subPatch.de_submit_date = submittedOn;
              if (vettedOn) subPatch.de_vetted_on = vettedOn;
              subPatch.updated_at = new Date().toISOString();
              await nxFetch(`sanction_sub_item?line_item_id=eq.${li.line_item_id}`, { method: 'PATCH', body: subPatch, prefer: 'return=representation' });
            } catch (e2) {
              console.warn('DE date propagation to sub-items failed for line_item', li.line_item_id, e2);
            }
          }
        } catch (e) { console.error('Edit failed', li.line_item_id, e); results.errors++; }

      } else if (action === 'Delete') {
        // Cascade order matters for referential integrity: fetch
        // sub_item_ids first, soft-drop sub_items, cascade to
        // process_detail, and only then soft-drop the line item itself.
        try {
          const subItems = await nxFetch(`sanction_sub_item?line_item_id=eq.${li.line_item_id}&select=sub_item_id&state=neq.Dropped`);

          if (subItems.length) {
            await nxFetch(`sanction_sub_item?line_item_id=eq.${li.line_item_id}`, {
              method: 'PATCH', body: { qty: 0, total_value: 0, state: 'Dropped', updated_at: new Date().toISOString() }, prefer: 'return=representation',
            });
          }
          for (const si of subItems) {
            await nxFetch(`process_detail?sub_item_id=eq.${si.sub_item_id}`, {
              method: 'PATCH', body: { process_stage: 'Dropped', state: 'Dropped', updated_at: new Date().toISOString() }, prefer: 'return=representation',
            });
          }
          await nxFetch(`sanction_line_item?line_item_id=eq.${li.line_item_id}`, {
            method: 'PATCH', body: { qty: 0, total_value: 0, state: 'Dropped', updated_at: new Date().toISOString() }, prefer: 'return=representation',
          });

          results.deleted++;
          console.log(`[DRGSBC] Dropped line_item ${li.line_item_id} + ${subItems.length} sub_items + process_details`);
        } catch (e) { console.error('Delete cascade failed', li.line_item_id, e); results.errors++; }
      }
    }

    const newRows = document.querySelectorAll('[data-es-new]');
    const toInsert = [];
    newRows.forEach(row => {
      const seq = row.id.split('_')[2];
      const name = document.getElementById(`es_ni_name_${seq}`)?.value?.trim();
      if (!name) return;
      toInsert.push({
        sanction_id: ES.filtered.sanction_id,
        item_name: name,
        // Can be duplicate, can be null — pre-filled incrementally but
        // freely overwritable, same convention as New Sanction.
        li_code: (document.getElementById(`es_ni_licode_${seq}`)?.value || '').trim() || null,
        unit: document.getElementById(`es_ni_unit_${seq}`)?.value || '',
        qty: parseFloat(document.getElementById(`es_ni_qty_${seq}`)?.value) || 0,
        base_price: parseFloat(document.getElementById(`es_ni_base_${seq}`)?.value) || 0,
        tax_and_others: parseFloat(document.getElementById(`es_ni_tax_${seq}`)?.value) || 0,
        unit_price: parseFloat(document.getElementById(`es_ni_up_${seq}`)?.value) || 0,
        total_value: parseFloat(document.getElementById(`es_ni_total_${seq}`)?.value) || 0,
        processing_depot: document.getElementById(`es_ni_pdepot_${seq}`)?.value || ES.filtered.processing_depot || 'SBC',
        live_estimate: document.getElementById(`es_ni_liveest_${seq}`)?.value || 'Abstract',
        e_submitted_on: document.getElementById(`es_ni_submiton_${seq}`)?.value || null,
        e_vetted_on: document.getElementById(`es_ni_vettedon_${seq}`)?.value || null,
      });
    });

    if (toInsert.length) {
      try {
        await nxFetch('sanction_line_item', { method: 'POST', body: toInsert, prefer: 'return=representation' });
        results.newAdded = toInsert.length;
      } catch (e) { console.error('New items insert failed', e); results.errors += toInsert.length; }
    }

    const summary = `✓ RETAINED:${results.retained} EDITED:${results.edited} DELETED:${results.deleted} NEW:${results.newAdded}${results.errors ? ' ⚠ ERRORS:' + results.errors : ''}`;
    msgEl.style.color = results.errors ? 'var(--accent-gold)' : 'var(--accent-green)';
    msgEl.textContent = summary;
    showToast('SANCTION UPDATED · ' + (results.edited + results.deleted + results.newAdded) + ' CHANGES');

    await esFetchLineItems(ES.filtered.sanction_id);
  } catch (e) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ ERROR: ' + e.message;
    showToast('SUBMIT ERROR: ' + e.message.slice(0, 40), 'error');
  }

  btn.disabled = false; btn.textContent = 'SUBMIT CHANGES';
}
document.getElementById('es_submit_btn').addEventListener('click', esSubmitChanges);

// Fixed vs v16: ES.actions is seeded with 'Retain' for every line item
// the moment a sanction loads, so checking "any keys present" was
// always true even with zero edits. Now checks for an action that's
// actually not 'Retain', a populated editValues entry, or an
// in-progress new-item row.
function esHasUnsavedChanges() {
  const hasNonRetainAction = Object.values(ES.actions || {}).some(a => a !== 'Retain');
  const hasEditValues = Object.keys(ES.editValues || {}).length > 0;
  const hasNewRows = document.querySelectorAll('[data-es-new]').length > 0;
  return hasNonRetainAction || hasEditValues || hasNewRows;
}

function esResetAllConfirm() {
  confirmIfDirty(esHasUnsavedChanges, esResetAll, 'Edit Sanction');
}

function esResetAll() {
  document.getElementById('es_under_power').value = '';
  document.getElementById('es_year').value = '';
  document.getElementById('es_allocation').value = '';
  document.getElementById('es_header_strip').style.display = 'none';
  document.getElementById('esh_alias_banner').style.display = 'none'; // v16 leaves this stale on reset
  document.getElementById('es_items_section').style.display = 'none';
  document.getElementById('es_add_new_item_btn').style.display = 'none';
  ES.filtered = null; ES.lineItems = []; ES.actions = {}; ES.editValues = {};
}
document.getElementById('es_reset_btn').addEventListener('click', esResetAllConfirm);

function esOnTabOpen() {
  if (!ES.sanctions.length) esLoadFilters();
}

/* ================================================================
   GRANT
   ================================================================
   Tables: sanction_header, sanction_line_item, sanction_sub_item,
           sanction_grant_detail

   Flow: pick a Plan Head (auto-selects whether grant is allocated by
   Under Power or Item Name, per GD_PH_MODE), pick the specific
   under-power/item, and the allocation table fills in with every
   matching line item's latest cost (summed vetted_cost across its
   sub-items) and a share %. Enter a grant amount per row (or use
   Quick Distribute to pro-rate a total automatically), save — which
   checks for existing grant records on the same line item + date and
   asks before overwriting — and on success, distributes each saved
   grant down to sub_item.latest_grant proportional to vetted_cost.
   That last step is what makes Process tab's Latest Grant column
   reflect what gets entered here.

   NO DEMO DATA: v16 falls back to synthetic rows when Nexus isn't
   configured (gdBuildDemoRows()); per the standing rule for this
   Shell, that's omitted — an unconfigured connection just yields an
   empty selector / table instead.
   ================================================================ */
let GD = {
  planHead: '',
  grantBy: 'under_power', // 'under_power' | 'item_name'
  selectorVal: '',
  rows: [], // [ { line_item_id, sanction_id, item_name, sanction_detail, allocation, sanction_year, latest_cost, share_pct, _rowKey } ]
};

// Plan head → grant-by auto-select rule.
const GD_PH_MODE = { '4200': 'under_power', '2100': 'item_name', '4100': 'item_name' };

function gdInitYears() {
  const sel = document.getElementById('gd_grant_year');
  if (!sel || sel.options.length > 1) return; // idempotent — only runs once
  sel.innerHTML = '';
  const today = new Date();
  const cm = today.getMonth(), cy = today.getFullYear();
  const curFY = cm >= 3 ? cy : cy - 1;
  for (let i = -2; i <= 1; i++) {
    const s = curFY + i, e = (s + 1).toString().slice(-2);
    const fy = `${s}-${e}`;
    const o = document.createElement('option');
    o.value = fy; o.textContent = fy;
    if (i === 0) o.selected = true;
    sel.appendChild(o);
  }
}

function gdOnPlanHeadChange() {
  const ph = document.getElementById('gd_plan_head').value;
  GD.planHead = ph;
  GD.rows = []; GD.selectorVal = '';
  document.getElementById('gd_selector').value = '';
  document.getElementById('gd_table_section').style.display = 'none';

  const mode = GD_PH_MODE[ph] || 'item_name';
  GD.grantBy = mode;
  document.getElementById('gd_grant_by').value = mode;
  gdSetSelectorLabel();
  gdLoadSelectorList();
}
document.getElementById('gd_plan_head').addEventListener('change', gdOnPlanHeadChange);

function gdOnGrantByChange() {
  GD.grantBy = document.getElementById('gd_grant_by').value;
  GD.selectorVal = '';
  document.getElementById('gd_selector').value = '';
  document.getElementById('gd_table_section').style.display = 'none';
  GD.rows = [];
  gdSetSelectorLabel();
  gdLoadSelectorList();
}
document.getElementById('gd_grant_by').addEventListener('change', gdOnGrantByChange);

function gdSetSelectorLabel() {
  const lbl = document.getElementById('gd_dl2_label');
  lbl.textContent = GD.grantBy === 'under_power' ? 'UNDER POWER *' : 'ITEM NAME *';
  document.getElementById('gd_selector').placeholder = GD.grantBy === 'under_power' ? 'Select under power...' : 'Select item name...';
}

async function gdLoadSelectorList() {
  if (!GD.planHead) return;
  const dl = document.getElementById('gd_selector_list');
  dl.innerHTML = '';
  const inp = document.getElementById('gd_selector');
  inp.placeholder = 'Loading...';

  try {
    let options = [];
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      if (GD.grantBy === 'under_power') {
        const rows = await nxFetch(`sanction_header?select=under_power&plan_head=eq.${GD.planHead}&state=neq.Dropped`);
        options = [...new Set(rows.map(r => r.under_power).filter(Boolean))].sort();
      } else {
        const rows = await nxFetch(`sanction_line_item?select=item_name,sanction_header!inner(plan_head)&sanction_header.plan_head=eq.${GD.planHead}`);
        options = [...new Set(rows.map(r => r.item_name).filter(Boolean))].sort();
      }
    }
    // NO DEMO DATA — unconfigured Nexus just leaves options empty.
    options.forEach(v => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
    inp.placeholder = GD.grantBy === 'under_power' ? 'Select under power...' : 'Select item name...';
  } catch (e) {
    inp.placeholder = 'Error — retry';
    showToast('LOAD ERROR: ' + e.message.slice(0, 30), 'error');
  }
}

async function gdLoadPlanHeads() {
  gdInitYears();
  if (GD.planHead) gdLoadSelectorList();
}
document.getElementById('gd_refresh_btn').addEventListener('click', gdLoadPlanHeads);

function gdOnSelectorChange() {
  const val = document.getElementById('gd_selector').value.trim();
  if (!val) return;
  GD.selectorVal = val;
  clearTimeout(window._gdFetchTimer);
  window._gdFetchTimer = setTimeout(() => gdFetchAllocationData(), 400);
}
document.getElementById('gd_selector').addEventListener('input', gdOnSelectorChange);

async function gdFetchAllocationData() {
  if (!GD.planHead || !GD.selectorVal) return;
  const sec = document.getElementById('gd_table_section');
  const tbody = document.getElementById('gd_alloc_body');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">⏳ LOADING DATA...</td></tr>`;
  sec.style.display = '';

  try {
    let rawRows = [];
    const cfg = getDbConfig();

    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      if (GD.grantBy === 'under_power') {
        const headers = await nxFetch(
          `sanction_header?select=sanction_id,remarks,sanction_year,allocation_type,` +
          `sanction_line_item(line_item_id,item_name,sanction_sub_item(sub_item_id,vetted_cost))` +
          `&under_power=eq.${encodeURIComponent(GD.selectorVal)}&plan_head=eq.${GD.planHead}&state=neq.Dropped`
        );
        headers.forEach(h => {
          (h.sanction_line_item || []).forEach(li => {
            let latestCost = 0;
            (li.sanction_sub_item || []).forEach(si => { latestCost += parseFloat(si.vetted_cost) || 0; });
            rawRows.push({
              line_item_id: li.line_item_id, sanction_id: h.sanction_id, item_name: li.item_name,
              sanction_detail: h.remarks, allocation: h.allocation_type, sanction_year: h.sanction_year,
              latest_cost: latestCost,
            });
          });
        });
      } else {
        const lis = await nxFetch(
          `sanction_line_item?select=line_item_id,item_name,` +
          `sanction_header!inner(sanction_id,remarks,sanction_year,allocation_type,plan_head),` +
          `sanction_sub_item(sub_item_id,vetted_cost)` +
          `&item_name=eq.${encodeURIComponent(GD.selectorVal)}`
        );
        lis.forEach(li => {
          let latestCost = 0;
          (li.sanction_sub_item || []).forEach(si => { latestCost += parseFloat(si.vetted_cost) || 0; });
          const h = li.sanction_header || {};
          rawRows.push({
            line_item_id: li.line_item_id, sanction_id: h.sanction_id, item_name: li.item_name,
            sanction_detail: h.remarks, allocation: h.allocation_type, sanction_year: h.sanction_year,
            latest_cost: latestCost,
          });
        });
      }
    }
    // NO DEMO DATA — unconfigured Nexus just yields zero rows.

    if (!rawRows.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">NO ITEMS FOUND FOR THIS SELECTION</td></tr>`;
      return;
    }

    rawRows.sort((a, b) => (a.allocation || '').localeCompare(b.allocation || '') || (a.item_name || '').localeCompare(b.item_name || ''));

    const totalCostAll = rawRows.reduce((s, r) => s + r.latest_cost, 0);
    const allocTotals = {};
    rawRows.forEach(r => { allocTotals[r.allocation] = (allocTotals[r.allocation] || 0) + r.latest_cost; });

    GD.rows = rawRows.map((r, i) => ({
      ...r,
      _rowKey: 'gdrow_' + i,
      share_pct: totalCostAll > 0 ? (r.latest_cost / totalCostAll * 100) : 0,
    }));

    gdRenderTable(allocTotals, totalCostAll);
    gdUpdateSummary(totalCostAll);
    gdUpdateTableTitle();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:12px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-red);">ERROR: ${e.message}</td></tr>`;
    showToast('FETCH ERROR: ' + e.message.slice(0, 40), 'error');
  }
}

function gdRenderTable(allocTotals, totalCostAll) {
  const tbody = document.getElementById('gd_alloc_body');
  tbody.innerHTML = '';

  let lastAlloc = null;
  GD.rows.forEach((r, i) => {
    if (r.allocation !== lastAlloc) {
      lastAlloc = r.allocation;
      const sepRow = document.createElement('tr');
      sepRow.style.cssText = 'background:rgba(0,180,216,0.04);border-top:1px solid var(--border-accent);';
      sepRow.innerHTML = `
        <td colspan="4" style="padding:6px 10px;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--accent-blue);letter-spacing:2px;">
          ALLOCATION: ${r.allocation || '—'}
        </td>
        <td style="padding:6px 10px;text-align:right;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--accent-gold);">
          SUBTOTAL: Rs.${Number(allocTotals[r.allocation] || 0).toLocaleString('en-IN')}
        </td>
        <td colspan="2"></td>`;
      tbody.appendChild(sepRow);
    }

    const dataRow = document.createElement('tr');
    dataRow.id = r._rowKey + '_tr';
    dataRow.style.cssText = 'border-bottom:1px solid rgba(26,58,92,0.4);';
    dataRow.innerHTML = `
      <td style="padding:8px 10px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">${i + 1}</td>
      <td style="padding:8px 10px;color:var(--text-primary);font-weight:600;max-width:220px;white-space:normal;line-height:1.3;">
        ${r.item_name || r.sanction_detail || '—'}
        <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);margin-top:2px;">${r.sanction_detail || ''}</div>
      </td>
      <td style="padding:8px 10px;">
        <span class="badge" style="background:rgba(0,180,216,0.1);color:var(--accent-blue);border:1px solid rgba(0,180,216,0.3);">${r.allocation || '—'}</span>
      </td>
      <td style="padding:8px 10px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">${r.sanction_year || '—'}</td>
      <td style="padding:8px 10px;text-align:right;font-family:Rajdhani,sans-serif;font-size:13px;color:var(--accent-gold);">
        ${r.latest_cost > 0 ? 'Rs.' + Number(r.latest_cost).toLocaleString('en-IN') : '<span style="color:var(--text-muted);font-size:10px;">—</span>'}
      </td>
      <td style="padding:8px 10px;text-align:right;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">
        ${r.share_pct > 0 ? r.share_pct.toFixed(1) + '%' : '—'}
      </td>
      <td style="padding:8px 10px;text-align:right;">
        <input type="number" step="0.01" min="0" id="${r._rowKey}_grant" data-gd-grant-input="1"
          style="background:var(--input-bg);border:1px solid var(--border-accent);
                 color:var(--accent-green);font-family:Rajdhani,sans-serif;
                 font-size:13px;font-weight:700;padding:5px 8px;
                 outline:none;width:140px;text-align:right;"
          placeholder="0.00">
      </td>`;
    tbody.appendChild(dataRow);
  });

  document.getElementById('gd_foot_cost').textContent = totalCostAll > 0 ? 'Rs.' + Number(totalCostAll).toLocaleString('en-IN') : '—';
  document.getElementById('gd_foot_grant').textContent = '—';
}
document.getElementById('gd_alloc_body').addEventListener('input', (e) => {
  if (e.target.dataset.gdGrantInput) gdOnGrantInput();
});

function gdUpdateTableTitle() {
  const mode = GD.grantBy === 'under_power' ? 'UNDER POWER' : 'ITEM NAME';
  document.getElementById('gd_table_title').textContent = `GRANT ALLOCATION · ${mode}: ${GD.selectorVal} · PLAN HEAD ${GD.planHead}`;
}

function gdUpdateSummary(totalCostAll) {
  document.getElementById('gds_ph').textContent = GD.planHead || '—';
  document.getElementById('gds_by').textContent = GD.grantBy === 'under_power' ? 'UNDER POWER' : 'ITEM NAME';
  document.getElementById('gds_cost').textContent = totalCostAll > 0 ? 'Rs. ' + Number(totalCostAll).toLocaleString('en-IN') : '—';
  document.getElementById('gds_grant').textContent = '—';
}

function gdOnGrantInput() {
  let total = 0;
  GD.rows.forEach(r => { total += parseFloat(document.getElementById(r._rowKey + '_grant')?.value) || 0; });
  const fmt = total > 0 ? 'Rs. ' + Number(total).toLocaleString('en-IN') : '—';
  document.getElementById('gds_grant').textContent = fmt;
  document.getElementById('gd_foot_grant').textContent = total > 0 ? 'Rs.' + Number(total).toLocaleString('en-IN') : '—';
}

function gdAutoDistribute() {
  const totalGrant = parseFloat(document.getElementById('gd_total_grant_input').value) || 0;
  if (!totalGrant || !GD.rows.length) return;

  const totalCost = GD.rows.reduce((s, r) => s + r.latest_cost, 0);
  GD.rows.forEach(r => {
    const share = totalCost > 0 ? (r.latest_cost / totalCost) * totalGrant : 0;
    const inp = document.getElementById(r._rowKey + '_grant');
    if (inp) inp.value = share.toFixed(2);
  });

  gdOnGrantInput();
  showToast('GRANT DISTRIBUTED PRO-RATA');
}
document.getElementById('gd_total_grant_input').addEventListener('input', gdAutoDistribute);

// For a given line_item_id: find the grant record with the latest
// grant_date (across all grant_type/grant_year), then distribute that
// amount across the line item's sub_items proportional to vetted_cost.
// This is what makes Process tab's "Latest Grant" column reflect what
// gets saved here.
async function gdDistributeToSubItems(lineItemId) {
  try {
    const grants = await nxFetch(`sanction_grant_detail?line_item_id=eq.${lineItemId}&select=grant_amount,grant_date,grant_type&order=grant_date.desc&limit=1`);
    if (!Array.isArray(grants) || !grants.length) return;
    const grantAmount = parseFloat(grants[0].grant_amount) || 0;

    const subItems = await nxFetch(`sanction_sub_item?line_item_id=eq.${lineItemId}&select=sub_item_id,vetted_cost`);
    if (!Array.isArray(subItems) || !subItems.length) return;

    const lineTotal = subItems.reduce((s, si) => s + (parseFloat(si.vetted_cost) || 0), 0);
    if (lineTotal <= 0) return;

    for (const si of subItems) {
      const share = (parseFloat(si.vetted_cost) || 0) / lineTotal;
      const latestGrantShare = grantAmount * share;
      await nxFetch(`sanction_sub_item?sub_item_id=eq.${si.sub_item_id}`, {
        method: 'PATCH', body: { latest_grant: Number(latestGrantShare.toFixed(2)), updated_at: new Date().toISOString() }, prefer: 'return=minimal',
      });
    }
  } catch (e) { console.warn('[GD] Distribution failed for line_item_id=' + lineItemId, e); }
}

async function gdDistributeAll() {
  const lineItemIds = [...new Set(GD.rows.map(r => r.line_item_id).filter(Boolean))];
  for (const liId of lineItemIds) await gdDistributeToSubItems(liId);
}

async function gdSaveToDatabase() {
  const ph = document.getElementById('gd_plan_head').value;
  const grantType = document.getElementById('gd_grant_type').value;
  const grantDate = document.getElementById('gd_grant_date').value;
  const grantYear = document.getElementById('gd_grant_year').value;

  if (!ph || !grantDate || !grantYear) { showToast('FILL ALL HEADER FIELDS', 'error'); return; }
  if (!GD.rows.length) { showToast('NO ROWS TO SAVE', 'error'); return; }

  const missing = GD.rows.some(r => {
    const v = parseFloat(document.getElementById(r._rowKey + '_grant')?.value);
    return isNaN(v) || v <= 0;
  });
  if (missing) { showToast('FILL GRANT AMOUNT FOR ALL ROWS', 'error'); return; }

  // One record per (line_item, allocation) — usually 1:1.
  const payloads = GD.rows.map(r => ({
    sanction_id: r.sanction_id,
    line_item_id: r.line_item_id,
    grant_amount: parseFloat(document.getElementById(r._rowKey + '_grant').value) || 0,
    grant_type: grantType,
    grant_year: grantYear,
    grant_date: grantDate,
    remarks: `${grantType} Grant` + (r.item_name ? ` · ${r.item_name}` : ''),
  }));

  const msgEl = document.getElementById('gd_submit_msg');
  const btn = document.getElementById('gd_submit_btn');
  btn.disabled = true; btn.textContent = 'SAVING...';
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = 'Saving to database...';

  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      // Duplicate key: line_item_id + grant_date.
      const duplicates = [];
      for (const p of payloads) {
        const existing = await nxFetch(
          `sanction_grant_detail?line_item_id=eq.${p.line_item_id}&grant_date=eq.${encodeURIComponent(p.grant_date)}&select=grant_id,grant_amount,grant_type,grant_date,line_item_id`
        ).catch(() => []);
        if (existing && existing.length > 0) duplicates.push({ payload: p, existing: existing[0] });
      }

      if (duplicates.length > 0) {
        btn.disabled = false; btn.textContent = 'SAVE TO DATABASE';
        gdShowOverwriteModal(payloads, duplicates);
        msgEl.style.color = 'var(--accent-gold)';
        msgEl.textContent = `⚠ ${duplicates.length} DUPLICATE(S) FOUND — confirm overwrite in dialog`;
        return;
      }

      await nxFetch('sanction_grant_detail', { method: 'POST', body: payloads, prefer: 'return=representation' });

      msgEl.style.color = 'var(--text-muted)';
      msgEl.textContent = 'Distributing to sub-items...';
      await gdDistributeAll();

      msgEl.style.color = 'var(--accent-green)';
      msgEl.textContent = `✓ ${payloads.length} GRANT RECORD(S) SAVED & DISTRIBUTED`;
      showToast('GRANT SAVED → NEXUS · ' + payloads.length + ' RECORDS');
    } else {
      msgEl.style.color = 'var(--accent-red)';
      msgEl.textContent = '✕ NO DATABASE CONFIGURED — Settings → Database';
      showToast('NO DB CONFIGURED', 'error');
    }
  } catch (e) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ ERROR: ' + e.message;
    showToast('SAVE ERROR: ' + e.message.slice(0, 40), 'error');
  }

  btn.disabled = false; btn.textContent = 'SAVE TO DATABASE';
}
document.getElementById('gd_submit_btn').addEventListener('click', gdSaveToDatabase);

// Builds the overwrite-confirmation modal. v16 embeds the payload/
// duplicate data as JSON.stringify(...).replace(/"/g,'&quot;') inside
// an inline onclick attribute; this closure-captures the same data
// and wires a real event listener instead — same outcome, without
// round-tripping live data through an HTML attribute string.
function gdShowOverwriteModal(dbPayloads, duplicates) {
  const existingModal = document.getElementById('gd_overwrite_modal');
  if (existingModal) existingModal.remove();

  const dupList = duplicates.map(d =>
    `<li style="margin:4px 0;">Line Item <strong style="color:var(--accent-cyan)">${d.payload.line_item_id}</strong> — Grant Type: <strong style="color:var(--accent-gold)">${d.payload.grant_type}</strong> · Date: ${d.payload.grant_date} · Existing Amt: ₹${Number(d.existing.grant_amount || 0).toLocaleString('en-IN')} → New: ₹${Number(d.payload.grant_amount || 0).toLocaleString('en-IN')}</li>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = 'gd_overwrite_modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,8,15,0.88);backdrop-filter:blur(6px);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--modal-bg);border:1px solid var(--accent-gold);max-width:560px;width:95%;padding:28px;position:relative;animation:modalin 0.25s ease;max-height:80vh;overflow-y:auto;">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--accent-gold),var(--accent-cyan));"></div>
      <div style="font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:2px;color:var(--accent-gold);margin-bottom:6px;">⚠ DUPLICATE GRANT RECORDS FOUND</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:18px;">MATCHING: LINE ITEM + GRANT DATE</div>
      <div style="background:rgba(255,214,10,0.07);border:1px solid rgba(255,214,10,0.3);border-left:3px solid var(--accent-gold);padding:12px 16px;margin-bottom:16px;">
        <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--accent-gold);letter-spacing:1px;margin-bottom:8px;">${duplicates.length} EXISTING RECORD(S) WILL BE OVERWRITTEN:</div>
        <ul style="font-family:'Exo 2',sans-serif;font-size:12px;color:var(--text-secondary);padding-left:16px;line-height:1.8;">${dupList}</ul>
      </div>
      <div style="font-family:'Exo 2',sans-serif;font-size:12px;color:var(--text-muted);margin-bottom:20px;">
        Non-duplicate records (${dbPayloads.length - duplicates.length}) will be inserted as new entries.
      </div>
      <div id="gd_ow_msg" style="font-family:'Share Tech Mono',monospace;font-size:10px;min-height:16px;margin-bottom:14px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
        <button id="gd_ow_cancel_btn" style="background:transparent;border:1px solid var(--border);color:var(--text-muted);font-family:Rajdhani,sans-serif;font-weight:600;font-size:13px;letter-spacing:1px;padding:8px 20px;cursor:pointer;">CANCEL</button>
        <button id="gd_ow_confirm_btn" style="background:var(--accent-gold);border:none;color:var(--bg-dark);font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;letter-spacing:2px;padding:8px 24px;cursor:pointer;">OVERWRITE & SAVE</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('gd_ow_cancel_btn').addEventListener('click', () => overlay.remove());
  document.getElementById('gd_ow_confirm_btn').addEventListener('click', () => {
    gdDoUpsert(dbPayloads, duplicates.map(d => ({ id: d.existing.grant_id, payload: d.payload })));
  });
}

async function gdDoUpsert(dbPayloads, toOverwrite) {
  const msgEl = document.getElementById('gd_submit_msg');
  const owMsg = document.getElementById('gd_ow_msg');
  const owBtn = document.getElementById('gd_ow_confirm_btn');
  if (owBtn) { owBtn.disabled = true; owBtn.textContent = 'SAVING...'; }
  if (owMsg) { owMsg.style.color = 'var(--text-muted)'; owMsg.textContent = 'Processing...'; }

  try {
    for (const dup of toOverwrite) {
      await nxFetch(`sanction_grant_detail?grant_id=eq.${dup.id}`, {
        method: 'PATCH', body: { ...dup.payload, updated_at: new Date().toISOString() }, prefer: 'return=representation',
      });
    }

    const dupKeys = new Set(toOverwrite.map(d => d.payload.line_item_id + '_' + d.payload.grant_date));
    const newPayloads = dbPayloads.filter(p => !dupKeys.has(p.line_item_id + '_' + p.grant_date));
    if (newPayloads.length) {
      await nxFetch('sanction_grant_detail', { method: 'POST', body: newPayloads, prefer: 'return=representation' });
    }

    const total = toOverwrite.length + newPayloads.length;

    if (owMsg) { owMsg.style.color = 'var(--text-muted)'; owMsg.textContent = 'Distributing to sub-items...'; }
    await gdDistributeAll();

    if (owMsg) { owMsg.style.color = 'var(--accent-green)'; owMsg.textContent = `✓ ${toOverwrite.length} OVERWRITTEN + ${newPayloads.length} NEW — DISTRIBUTED`; }
    if (msgEl) { msgEl.style.color = 'var(--accent-green)'; msgEl.textContent = `✓ ${total} GRANT RECORD(S) SAVED & DISTRIBUTED (${toOverwrite.length} OVERWRITTEN)`; }
    showToast('GRANT UPSERTED → NEXUS · ' + total + ' RECORDS');
    setTimeout(() => { const m = document.getElementById('gd_overwrite_modal'); if (m) m.remove(); }, 1600);
  } catch (e) {
    if (owMsg) { owMsg.style.color = 'var(--accent-red)'; owMsg.textContent = '✕ ERROR: ' + e.message; }
    if (owBtn) { owBtn.disabled = false; owBtn.textContent = 'RETRY'; }
  }
}

function gdHasUnsavedChanges() {
  return (GD.rows || []).some(r => {
    const v = document.getElementById(r._rowKey + '_grant')?.value;
    return v !== undefined && v !== '' && parseFloat(v) > 0;
  });
}

function gdResetAllConfirm() {
  confirmIfDirty(gdHasUnsavedChanges, gdResetAll, 'Grant Allocation');
}

function gdResetAll() {
  document.getElementById('gd_plan_head').value = '';
  document.getElementById('gd_selector').value = '';
  document.getElementById('gd_selector_list').innerHTML = '';
  document.getElementById('gd_table_section').style.display = 'none';
  document.getElementById('gd_total_grant_input').value = '';
  document.getElementById('gd_submit_msg').textContent = '';
  GD.rows = []; GD.planHead = ''; GD.selectorVal = '';
}
document.getElementById('gd_clear_btn').addEventListener('click', gdResetAllConfirm);

function gdOnTabOpen() {
  gdInitYears();
}

/* ================================================================
   SUB-ITEMS
   ================================================================
   Tables involved: sanction_header, sanction_line_item, sanction_sub_item

   TWO FIXES vs v16, found while porting:

   1. siRemoveRow(cardId, editId) in v16 derives the row's `seq` by
      splitting the card's DOM id and taking the last segment —
      `'si_row_new_7'.split('_').pop()` correctly gives '7', but for
      an edit row the id is `'si_row_edit_' + editId`, so the same
      split gives back the *editId*, not the seq. parseInt() on a
      non-numeric editId yields NaN, and `r.seq !== NaN` is true for
      every row, so the SI.newRows entry for a removed edit-row never
      actually gets filtered out — it lingers, pointing at DOM
      elements that no longer exist, until the next submit reads
      `undefined` out of them. Fixed by passing seq directly instead
      of round-tripping it through the DOM id string.

   2. `SI.selectedLI.processing_depot` is referenced in siSubmitAll()
      and used to assignment-check + populate every new sub-item's
      processing_depot — but SI.sanctionMap (built in
      siLoadUnderPowers) never actually selects a processing_depot
      column in the first place, so this is always undefined. Every
      sub-item created through this tab would silently get
      processing_depot = '' — invisible in Process tab's Depot filter
      and column, and unscoped for anyone restricted by depot
      assignment. New Sanction sets processing_depot and
      consignee_depot to the *same* user-picked value at creation
      time, so I've matched that here: when there's no better source,
      processing_depot defaults to whatever the row's own Consignee
      Depot was set to, instead of silently going blank.

   A purely cosmetic gap also found and fixed: v16's Existing
   Sub-Items table uses a `.btn-icon` class on its Edit/✖ buttons that
   is never defined anywhere in the stylesheet — added in this build's
   CSS (see the table-wrapper/btn-icon block).
   ================================================================ */
let SI = {
  sanctionMap: {}, // under_power → [ { line_item_id, item_name, sanction_id, sanction_year, plan_head, total_cost, li_total_value, under_power, processing_depot } ]
  selectedLI: null,
  existingRows: [],
  newRows: [], // [ { seq, editId } ]
  editedIds: new Set(),
  rowSeq: 0,
  upMode: false,      // true when viewing all sub-items under an under-power
  allUpRows: [],      // sub-items fetched in UP-mode
  groupCollapsed: {}, // line_item_id → bool
};

function siHasUnsavedChanges() {
  return (SI.newRows && SI.newRows.length > 0) || (SI.editedIds && SI.editedIds.size > 0);
}

function siRefreshListConfirm() {
  confirmIfDirty(siHasUnsavedChanges, siRefreshAndClear, 'Sub-Items');
}
document.getElementById('si_refresh_btn').addEventListener('click', siRefreshListConfirm);

async function siRefreshAndClear() {
  document.getElementById('si_under_power').value = '';
  document.getElementById('si_item_name').value = '';
  document.getElementById('si_item_list').innerHTML = '';
  siResetParentStrip();
  await siLoadUnderPowers();
}

async function siLoadUnderPowers() {
  const upList = document.getElementById('si_up_list');
  upList.innerHTML = '';
  SI.sanctionMap = {};

  const upInput = document.getElementById('si_under_power');
  upInput.placeholder = 'Loading...';

  try {
    let data = [];
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      // Added processing_depot inside the sanction_line_item brackets
		data = await nxFetch('sanction_header?select=sanction_id,under_power,sanction_year,plan_head,sanctioned_amount,sanction_line_item(line_item_id,item_name,total_value,processing_depot)&order=sanction_year.desc');
      if (!Array.isArray(data)) { console.warn('[SI] Unexpected response:', data); data = []; }
    }
    // NO DEMO DATA — unconfigured Nexus just yields an empty list.

    data.forEach(row => {
      const up = (row.under_power || '').trim();
      if (!up) return;
      if (!SI.sanctionMap[up]) SI.sanctionMap[up] = [];
      (row.sanction_line_item || []).forEach(li => {
		SI.sanctionMap[up].push({
		  line_item_id:      li.line_item_id,
		  item_name:         li.item_name,
		  sanction_id:       row.sanction_id,
		  sanction_year:     row.sanction_year,
		  plan_head:         row.plan_head,
		  total_cost:        row.sanctioned_amount,
		  li_total_value:    parseFloat(li.total_value) || 0,
		  under_power:       up,
		  processing_depot:  li.processing_depot || '', // Use 'li' (line item), not 'row' (header)
		});
      });
    });

    Object.keys(SI.sanctionMap).sort().forEach(up => {
      const opt = document.createElement('option'); opt.value = up; upList.appendChild(opt);
    });

    upInput.placeholder = 'Select or type under power...';
    showToast('UNDER POWERS LOADED · ' + Object.keys(SI.sanctionMap).length + ' ENTRIES');
  } catch (e) {
    upInput.placeholder = 'Error loading — retry';
    showToast('LOAD ERROR: ' + e.message.slice(0, 30), 'error');
  }
}

function siFilterByUnderPower() {
  const up = document.getElementById('si_under_power').value.trim();
  const itemList = document.getElementById('si_item_list');
  const itemInp = document.getElementById('si_item_name');
  itemList.innerHTML = '';
  itemInp.value = '';
  siResetParentStrip();

  const items = SI.sanctionMap[up] || [];
  items.forEach(li => { const o = document.createElement('option'); o.value = li.item_name; itemList.appendChild(o); });

  // Exact UP match → enter UP-mode and show grouped view of all sub-items
  if (items.length > 0) {
    SI.upMode = true;
    SI.selectedLI = null;
    siFetchByUnderPower(up);
  }
}
document.getElementById('si_under_power').addEventListener('input', siFilterByUnderPower);

async function siItemSelected() {
  const up = document.getElementById('si_under_power').value.trim();
  const itemName = document.getElementById('si_item_name').value.trim();
  const items = SI.sanctionMap[up] || [];
  const found = items.find(li => li.item_name.toLowerCase() === itemName.toLowerCase());

  if (!found) {
    // In UP-mode with no specific LI typed — stay in grouped view
    if (SI.upMode && SI.sanctionMap[up]) return;
    siResetParentStrip();
    return;
  }

  // Specific LI selected — switch to LI-mode
  SI.upMode = false;
  SI.selectedLI = found;
  document.getElementById('si_line_item_id').value = found.line_item_id;
// ADDED THIS NEW LINE:
  const procDepotInput = document.getElementById('si_line_item_proc_depot');
 
  // Restore LI-mode strip labels
  const lblYear = document.getElementById('si_lbl_year');
  const lblHead = document.getElementById('si_lbl_head');
  const lblTotal = document.getElementById('si_lbl_total');
  const lblSum = document.getElementById('si_lbl_sum');
  if (lblYear)  lblYear.textContent  = 'SANCTION YEAR';
  if (lblHead)  lblHead.textContent  = 'PLAN HEAD';
  if (lblTotal) lblTotal.textContent = 'TOTAL LINE-ITEM SANCTION COST (Rs.)';
  if (lblSum)   lblSum.textContent   = 'SUM OF SUB-ITEMS vs TOTAL';
  if (procDepotInput) procDepotInput.value = found.processing_depot || '—';

  document.getElementById('si_disp_year').textContent = found.sanction_year || '—';
  document.getElementById('si_disp_head').textContent = found.plan_head || '—';
  document.getElementById('si_disp_total').textContent = '—'; // will be set by siUpdateCostMatch once rows load
  document.getElementById('si_parent_strip').style.display = '';
  document.getElementById('si_form_section').style.display = '';

  const title = document.getElementById('si_existing_section_title');
  if (title) title.textContent = 'EXISTING SUB-ITEMS FOR THIS LINE ITEM';
  // Restore static table-wrapper, hide UP-mode grouped view
  document.querySelector('#si_existing_section .table-wrapper').style.display = '';
  document.getElementById('si_grouped_wrap').style.display = 'none';

  await siFetchExisting(found.line_item_id);
  siUpdateCostMatch();
}
document.getElementById('si_item_name').addEventListener('input', siItemSelected);

async function siFetchByUnderPower(underPower) {
  const sec = document.getElementById('si_existing_section');
  const title = document.getElementById('si_existing_section_title');
  sec.style.display = '';
  document.getElementById('si_form_section').style.display = 'none';
  if (title) title.textContent = `ALL SUB-ITEMS — ${underPower}`;

  const items = SI.sanctionMap[underPower] || [];
  const lineItemIds = items.map(li => li.line_item_id).filter(Boolean);
  if (!lineItemIds.length) {
    sec.querySelector('.table-wrapper').innerHTML = '<div style="padding:20px;color:var(--text-muted);font-family:\'Share Tech Mono\',monospace;font-size:10px;">NO LINE ITEMS FOUND FOR THIS UNDER POWER.</div>';
    return;
  }

  siUpdateStripForUpMode(underPower, items);
  // Show grouped wrapper, hide static LI-mode table (preserves si_existing_body)
  document.getElementById('si_grouped_wrap').style.display = '';
  document.querySelector('#si_existing_section .table-wrapper').style.display = 'none';

  try {
    const rows = await nxFetch(`sanction_sub_item?line_item_id=in.(${lineItemIds.join(',')})&select=*&order=line_item_id.asc,sub_item_id.asc`);
    SI.allUpRows = Array.isArray(rows) ? rows : [];
    SI.groupCollapsed = {};
    siRenderGrouped(underPower);
  } catch(e) {
    showToast('ERROR LOADING UP SUB-ITEMS: ' + e.message.slice(0, 40), 'error');
  }
}

function siUpdateStripForUpMode(underPower, lineItems) {
  const strip = document.getElementById('si_parent_strip');
  strip.style.display = '';
  // Get label elements directly from strip to be safe against any ID shadowing
  const lblYear  = strip.querySelector('#si_lbl_year')  || document.getElementById('si_lbl_year');
  const lblHead  = strip.querySelector('#si_lbl_head')  || document.getElementById('si_lbl_head');
  const lblTotal = strip.querySelector('#si_lbl_total') || document.getElementById('si_lbl_total');
  const lblSum   = strip.querySelector('#si_lbl_sum')   || document.getElementById('si_lbl_sum');
  if (lblYear)  lblYear.textContent  = 'LINE ITEMS';
  if (lblHead)  lblHead.textContent  = 'UNDER POWER';
  if (lblTotal) lblTotal.textContent = 'TOTAL SANCTION COST (Rs.)';
  if (lblSum)   lblSum.textContent   = 'TOTAL VETTED vs SANCTION';

  const totalSanction = lineItems.reduce((s, li) => s + (li.li_total_value || 0), 0);
  document.getElementById('si_disp_year').textContent  = String(lineItems.length);
  document.getElementById('si_disp_head').textContent  = underPower;
  document.getElementById('si_disp_total').textContent = totalSanction ? 'Rs. ' + Number(totalSanction).toLocaleString('en-IN') : '—';
  document.getElementById('si_disp_subsum').textContent = '—';
  document.getElementById('si_match_badge').style.display = 'none';
  document.getElementById('si_cost_bar').style.background = 'var(--border)';
}

function siRenderGrouped(underPower) {
  const tableWrap = document.getElementById('si_grouped_wrap');
  if (!tableWrap) return;

  const items = SI.sanctionMap[underPower] || [];
  // Build groups keyed by line_item_id
  const groups = {};
  items.forEach(li => { groups[li.line_item_id] = { li, rows: [] }; });
  SI.allUpRows.forEach(r => { if (groups[r.line_item_id]) groups[r.line_item_id].rows.push(r); });

  let html = `<table style="font-size:11px;width:100%;border-collapse:collapse;">
    <thead><tr style="background:var(--table-head-bg);border-bottom:1px solid var(--border-accent);position:sticky;top:0;z-index:10;">
      <th style="padding:7px 8px;text-align:left;width:32px;"></th>
      <th style="padding:7px 8px;text-align:left;">SUB-ITEM NAME</th>
      <th style="padding:7px 8px;text-align:center;width:60px;">QTY</th>
      <th style="padding:7px 8px;text-align:right;width:150px;">VETTED / RECORDED COST</th>
      <th style="padding:7px 8px;text-align:left;width:120px;">STATUS</th>
      <th style="padding:7px 8px;width:110px;"></th>
    </tr></thead><tbody>`;

  let overallVetted = 0;
  let overallSanction = 0;

  Object.values(groups).forEach(({ li, rows }) => {
    const collapsed = !!SI.groupCollapsed[li.line_item_id];
    const liVetted    = rows.reduce((s, r) => s + (parseFloat(r.vetted_cost)    || 0), 0);
    const liSanction  = rows.reduce((s, r) => s + (parseFloat(r.sanctioned_cost) || 0), 0);
    overallVetted   += liVetted;
    overallSanction += liSanction;
    const matched = liSanction > 0 && Math.abs(liVetted - liSanction) < 1;
    const badge = matched
      ? `<span style="background:var(--accent-green);color:var(--bg-dark);font-family:'Share Tech Mono',monospace;font-size:9px;padding:2px 7px;border-radius:2px;letter-spacing:1px;">MATCHED</span>`
      : `<span style="background:var(--accent-gold);color:var(--bg-dark);font-family:'Share Tech Mono',monospace;font-size:9px;padding:2px 7px;border-radius:2px;letter-spacing:1px;">PENDING</span>`;

    // Use data-si-grp-toggle instead of onclick — inline onclick doesn't work in ES modules
    html += `<tr data-si-grp-toggle="${li.line_item_id}" style="cursor:pointer;background:var(--bg-card);border-top:2px solid var(--border-accent);">
      <td style="padding:9px 8px;font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--accent-cyan);">${collapsed ? '▶' : '▼'}</td>
      <td style="padding:9px 8px;">
        <span style="font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;color:var(--text-primary);">${li.item_name}</span>
        <span style="font-size:9px;color:var(--text-muted);font-family:'Share Tech Mono',monospace;margin-left:8px;">${rows.length} SUB-ITEMS</span>
      </td>
      <td style="padding:9px 8px;"></td>
      <td style="padding:9px 8px;text-align:right;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-gold);">
        Rs.${Number(liVetted).toLocaleString('en-IN')} / Rs.${Number(liSanction).toLocaleString('en-IN')}
      </td>
      <td style="padding:9px 8px;">${badge}</td>
      <td style="padding:9px 8px;"></td>
    </tr>`;

    if (!collapsed) {
      rows.forEach((r, i) => {
        const rowBg = i % 2 === 0 ? 'rgba(0,0,0,0.12)' : 'transparent';
        const statusColor = r.status === 'Dropped' ? 'var(--accent-red)'
          : r.status === 'On Hold' ? 'var(--accent-gold)'
          : 'var(--text-muted)';
        // Use data-si-action / data-sid — same pattern as siRenderExisting
        html += `<tr style="background:${rowBg};">
          <td style="padding:6px 8px 6px 18px;color:var(--text-muted);font-size:10px;text-align:right;">${i + 1}</td>
          <td style="padding:6px 8px;">
            <div style="font-family:'Exo 2',sans-serif;font-weight:600;color:var(--text-primary);">${r.sub_item_name || '—'}</div>
            ${r.item_description ? `<div style="font-size:9px;color:var(--text-muted);margin-top:1px;">${r.item_description.slice(0,70)}</div>` : ''}
          </td>
          <td style="padding:6px 8px;text-align:center;color:var(--text-secondary);">${r.qty || '—'}</td>
          <td style="padding:6px 8px;text-align:right;color:var(--accent-gold);font-family:'Share Tech Mono',monospace;font-size:10px;">
            ${r.vetted_cost ? 'Rs.' + Number(r.vetted_cost).toLocaleString('en-IN') : '—'}
          </td>
          <td style="padding:6px 8px;">
            <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:${statusColor};">${r.status || 'Sanctioned'}</span>
          </td>
          <td style="padding:6px 8px;">
            <button data-si-action="edit" data-sid="${r.sub_item_id}" class="btn-icon">✎ EDIT</button>
            <button data-si-action="deactivate" data-sid="${r.sub_item_id}" class="btn-icon red">✖</button>
          </td>
        </tr>`;
      });
    }
  });

  html += '</tbody></table>';
  tableWrap.innerHTML = html;

  // Update UP-mode strip with overall totals derived from actual sub-item data
  const dispEl2 = document.getElementById('si_disp_total');
  if (dispEl2) {
    dispEl2.textContent = overallSanction > 0 ? 'Rs. ' + Number(overallSanction).toLocaleString('en-IN') : '—';
  }
  if (overallSanction > 0) {
    const pct = Math.min(100, (overallVetted / overallSanction) * 100);
    document.getElementById('si_disp_subsum').textContent =
      `Rs.${Number(overallVetted).toLocaleString('en-IN')} / Rs.${Number(overallSanction).toLocaleString('en-IN')}`;
    const barColor = overallVetted >= overallSanction ? 'var(--accent-green)' : 'var(--accent-cyan)';
    document.getElementById('si_cost_bar').style.background =
      `linear-gradient(to right, ${barColor} ${pct}%, var(--border) ${pct}%)`;
  }
}

function siToggleGroup(lineItemId) {
  SI.groupCollapsed[lineItemId] = !SI.groupCollapsed[lineItemId];
  const up = document.getElementById('si_under_power').value.trim();
  siRenderGrouped(up);
}

// Delegated listener for UP-mode grouped table.
// Must be async (edit flow needs to set up state before calling siEditExisting).
// Returns immediately in LI-mode — si_existing_body has its own listener.
document.getElementById('si_existing_section').addEventListener('click', async (e) => {
  if (!SI.upMode) return;

  const btn = e.target.closest('[data-si-action]');
  if (btn) {
    const sid = String(btn.dataset.sid);
    // Find the record in allUpRows (not existingRows — that's empty in UP-mode)
    const rec = SI.allUpRows.find(r => String(r.sub_item_id) === sid);
    if (!rec) return;

    // Find the line item this sub-item belongs to
    const liData = Object.values(SI.sanctionMap).flat()
      .find(li => String(li.line_item_id) === String(rec.line_item_id));

    // Populate SI.existingRows with this line item's sub-items so siEditExisting/siDeleteExisting can find the record
    SI.existingRows = SI.allUpRows.filter(r => String(r.line_item_id) === String(rec.line_item_id));

    if (btn.dataset.siAction === 'edit') {
      // Switch to LI-mode for this line item so the edit row has context
      SI.upMode = false;
      SI.selectedLI = liData || null;
      if (liData) document.getElementById('si_line_item_id').value = liData.line_item_id;
      // Show static table-wrapper (needed by siAddRow), hide grouped wrap
      document.querySelector('#si_existing_section .table-wrapper').style.display = '';
      document.getElementById('si_grouped_wrap').style.display = 'none';
      document.getElementById('si_form_section').style.display = '';
      // Restore LI-mode labels AND update values to match this specific line item
      const lblYear = document.getElementById('si_lbl_year');
      const lblHead = document.getElementById('si_lbl_head');
      const lblTotal = document.getElementById('si_lbl_total');
      const lblSum = document.getElementById('si_lbl_sum');
      if (lblYear)  lblYear.textContent  = 'SANCTION YEAR';
      if (lblHead)  lblHead.textContent  = 'PLAN HEAD';
      if (lblTotal) lblTotal.textContent = 'TOTAL LINE-ITEM SANCTION COST (Rs.)';
      if (lblSum)   lblSum.textContent   = 'SUM OF SUB-ITEMS vs TOTAL';
      document.getElementById('si_disp_year').textContent  = liData?.sanction_year || '—';
      document.getElementById('si_disp_head').textContent  = liData?.plan_head     || '—';
      document.getElementById('si_disp_total').textContent = '—'; // will be set by siUpdateCostMatch
      document.getElementById('si_parent_strip').style.display = '';
      const title = document.getElementById('si_existing_section_title');
      if (title) title.textContent = 'EXISTING SUB-ITEMS FOR THIS LINE ITEM';
      // Populate the sub-items table from the already-fetched allUpRows
      siRenderExisting();
      siUpdateCostMatch();
      siEditExisting(sid);
    }

    if (btn.dataset.siAction === 'deactivate') {
      siDeleteExisting(sid);
    }
    return;
  }

  const grpRow = e.target.closest('[data-si-grp-toggle]');
  if (grpRow) siToggleGroup(grpRow.dataset.siGrpToggle);
});

async function siFetchExisting(lineItemId) {
  SI.existingRows = [];
  const sec = document.getElementById('si_existing_section');
  const tbody = document.getElementById('si_existing_body');
  tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:16px;font-family:\'Share Tech Mono\',monospace;font-size:10px;color:var(--text-muted);">LOADING...</td></tr>';

  try {
    let rows = [];
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      const role = getActiveSession()?.role || '';
      const stateFilter = ROLES_SEE_ALL.has(role) ? '' : '&state=neq.Inactive';
      rows = await nxFetch(`sanction_sub_item?line_item_id=eq.${lineItemId}&select=*${stateFilter}&order=created_at.asc`);
    }
    SI.existingRows = rows;
    siRenderExisting();
    sec.style.display = rows.length > 0 ? '' : 'none';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:12px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-red);">FETCH ERROR: ${e.message}</td></tr>`;
    sec.style.display = '';
  }

  if (SI.newRows.length === 0) siAddRow();
  siUpdateSubmitBtn();
  siUpdateCostMatch();
}

function siRenderExisting() {
  const tbody = document.getElementById('si_existing_body');
  if (!SI.existingRows.length) { tbody.innerHTML = ''; return; }

  tbody.innerHTML = SI.existingRows.map((r, i) => {
    // Rows created via New Sanction only populate quantity/total_amount,
    // not qty/base_price/.../total_value — fall back so display doesn't
    // show nulls for sub-items that were never touched here.
    const dQty = r.qty != null ? r.qty : (r.quantity || 0);
    const dTotal = r.total_value != null ? r.total_value : (r.total_amount || 0);
    const dBase = r.base_price != null ? r.base_price : (dQty > 0 ? dTotal / dQty : dTotal);
    const dTax = r.tax_and_others != null ? r.tax_and_others : 0;
    const dUp = r.unit_price != null ? r.unit_price : (dBase + dTax);
    const dDesc = r.item_description || r.sub_item_name || '';
    const dUnit = r.unit || SI.selectedLI?.unit || '';
    return `
    <tr id="si_ex_row_${r.sub_item_id}" style="border-bottom:1px solid rgba(26,58,92,.4);">
      <td style="padding:7px 10px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">${i + 1}</td>
      <td style="padding:7px 10px;" id="si_ex_name_${r.sub_item_id}">${r.sub_item_name || '—'}</td>
      <td style="padding:7px 10px;color:var(--text-muted);">${dDesc || '—'}</td>
      <td style="padding:7px 10px;color:var(--text-muted);">${r.make_model || '—'}</td>
      <td style="padding:7px 10px;color:var(--text-muted);">${r.capacity || '—'}</td>
      <td style="padding:7px 10px;color:var(--accent-gold);">${r.sanctioned_cost != null ? 'Rs.' + Number(r.sanctioned_cost).toLocaleString('en-IN') : '—'}</td>
      <td style="padding:7px 10px;color:var(--text-muted);">${r.vetted_cost != null ? 'Rs.' + Number(r.vetted_cost).toLocaleString('en-IN') : '—'}</td>
      <td style="padding:7px 10px;">${dUnit || '—'}</td>
      <td style="padding:7px 10px;">${dQty || '—'}</td>
      <td style="padding:7px 10px;">${dBase ? dBase.toFixed(2) : '—'}</td>
      <td style="padding:7px 10px;">${dTax || '—'}</td>
      <td style="padding:7px 10px;color:var(--accent-green);">${dUp ? dUp.toFixed(2) : '—'}</td>
      <td style="padding:7px 10px;color:var(--accent-cyan);font-weight:700;">${dTotal != null && dTotal > 0 ? 'Rs.' + Number(dTotal).toLocaleString('en-IN') : '—'}</td>
      <td style="padding:7px 10px;display:flex;gap:5px;">
        <button class="btn-icon" data-si-action="edit" data-sid="${r.sub_item_id}">✎ EDIT</button>
        <button class="btn-icon red" data-si-action="deactivate" data-sid="${r.sub_item_id}">✖</button>
      </td>
    </tr>`;
  }).join('');
}
document.getElementById('si_existing_body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-si-action]');
  if (!btn) return;
  if (btn.dataset.siAction === 'edit') siEditExisting(btn.dataset.sid);
  if (btn.dataset.siAction === 'deactivate') siDeleteExisting(btn.dataset.sid);
});

function siEditExisting(subItemId) {
  const sid = String(subItemId);
  const rec = SI.existingRows.find(r => String(r.sub_item_id) === sid);
  if (!rec) return;
  if (document.getElementById('si_row_edit_' + sid)) {
    showToast('ALREADY IN EDIT ROW');
    document.getElementById('si_row_edit_' + sid).scrollIntoView({ behavior: 'smooth' });
    return;
  }
  SI.editedIds.add(sid);

  const fbQty = rec.qty != null ? rec.qty : (rec.quantity || 0);
  const fbTotal = rec.total_value != null ? rec.total_value : (rec.total_amount || 0);
  const fbBase = rec.base_price != null ? rec.base_price : (fbQty > 0 ? fbTotal / fbQty : fbTotal);
  const fbTax = rec.tax_and_others != null ? rec.tax_and_others : 0;
  const fbUp = rec.unit_price != null ? rec.unit_price : (fbBase + fbTax);
  const fbDesc = rec.item_description || rec.sub_item_name || '';
  const fbUnit = rec.unit || SI.selectedLI?.unit || '';

  siAddRow({
    _editId: sid,
    sub_item_name:    rec.sub_item_name,
    item_description: fbDesc,
    make_model:       rec.make_model,
    capacity:         rec.capacity,
    consignee_depot:  rec.consignee_depot || '',
    sanctioned_cost:  rec.sanctioned_cost != null ? rec.sanctioned_cost : 0,
    vetted_cost:      rec.vetted_cost,
    unit:             fbUnit,
    qty:              fbQty,
    base_price:       fbBase,
    tax_and_others:   fbTax,
    unit_price:       fbUp,
    total_value:      fbTotal,
  });
  siUpdateSubmitBtn();
}

function siDeleteExisting(subItemId) {
  const sid = String(subItemId);
  const rec = SI.existingRows.find(r => String(r.sub_item_id) === sid);
  if (!rec) return;

  const existingModal = document.getElementById('si_deactivate_modal');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'si_deactivate_modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,8,15,0.88);backdrop-filter:blur(6px);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--modal-bg);border:1px solid var(--accent-red);max-width:520px;width:95%;padding:28px;position:relative;animation:modalin 0.25s ease;">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--accent-red),var(--accent-gold));"></div>
      <div style="font-family:Rajdhani,sans-serif;font-weight:700;font-size:17px;letter-spacing:2px;color:var(--accent-red);margin-bottom:6px;">⚠ DEACTIVATE SUB-ITEM</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:20px;">SUB-ITEM ID: ${subItemId}</div>

      <div style="background:rgba(255,56,96,0.08);border:1px solid rgba(255,56,96,0.3);border-left:3px solid var(--accent-red);padding:12px 16px;margin-bottom:18px;">
        <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--accent-red);letter-spacing:1px;margin-bottom:8px;">THIS ACTION WILL:</div>
        <div style="font-family:'Exo 2',sans-serif;font-size:12px;color:var(--text-secondary);line-height:2;">
          • Set <strong style="color:var(--accent-gold);">QTY = 0</strong> and <strong style="color:var(--accent-gold);">Total Cost = ₹0</strong> on this sub-item<br>
          • Change sub-item state to <strong style="color:var(--accent-red);">Inactive</strong><br>
          • Cascade <strong style="color:var(--accent-red);">Inactive</strong> state to linked Process Detail records<br>
          • Sub-item will be hidden from all non-Admin views<br>
          • <strong style="color:var(--accent-cyan);">This is a soft action — data is preserved and reversible by Admin</strong>
        </div>
      </div>

      <div style="background:var(--bg-card);border:1px solid var(--border);padding:10px 14px;margin-bottom:20px;">
        <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);margin-bottom:4px;">ITEM BEING DEACTIVATED:</div>
        <div style="font-family:'Exo 2',sans-serif;font-size:13px;color:var(--text-primary);font-weight:600;">${rec.sub_item_name || '—'}</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);margin-top:3px;">
          QTY: ${rec.qty || 0} &nbsp;|&nbsp; TOTAL: ₹${Number(rec.total_value || 0).toLocaleString('en-IN')} &nbsp;|&nbsp; STATE: ${rec.state || 'Active'}
        </div>
      </div>

      <div id="si_deact_msg" style="font-family:'Share Tech Mono',monospace;font-size:10px;min-height:18px;margin-bottom:14px;"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="si_deact_cancel_btn" style="background:transparent;border:1px solid var(--border);color:var(--text-muted);font-family:Rajdhani,sans-serif;font-weight:600;font-size:13px;letter-spacing:1px;padding:8px 20px;cursor:pointer;">CANCEL</button>
        <button id="si_deact_confirm_btn" style="background:var(--accent-red);border:none;color:#fff;font-family:Rajdhani,sans-serif;font-weight:700;font-size:13px;letter-spacing:2px;padding:8px 24px;cursor:pointer;">CONFIRM DEACTIVATE</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('si_deact_cancel_btn').addEventListener('click', () => overlay.remove());
  document.getElementById('si_deact_confirm_btn').addEventListener('click', () => siDoDeactivate(subItemId));
}

async function siDoDeactivate(subItemId) {
  const msgEl = document.getElementById('si_deact_msg');
  const btn = document.getElementById('si_deact_confirm_btn');
  btn.disabled = true; btn.textContent = 'PROCESSING...';
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = 'Applying changes...';

  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      await nxFetch(`sanction_sub_item?sub_item_id=eq.${subItemId}`, {
        method: 'PATCH', body: { qty: 0, total_value: 0, state: 'Inactive', updated_at: new Date().toISOString() }, prefer: 'return=representation',
      });
      await nxFetch(`process_detail?sub_item_id=eq.${subItemId}`, {
        method: 'PATCH', body: { state: 'Inactive', process_stage: 'Inactive', updated_at: new Date().toISOString() }, prefer: 'return=representation',
      });

      msgEl.style.color = 'var(--accent-green)';
      msgEl.textContent = '✓ Sub-item deactivated. Process details updated.';
      showToast('SUB-ITEM DEACTIVATED → NEXUS');
    } else {
      msgEl.style.color = 'var(--accent-red)';
      msgEl.textContent = '✕ NO DATABASE CONFIGURED';
      showToast('NO DB CONFIGURED', 'error');
      btn.disabled = false; btn.textContent = 'RETRY';
      return;
    }

    const localRec = SI.existingRows.find(r => String(r.sub_item_id) === String(subItemId));
    if (localRec) { localRec.qty = 0; localRec.total_value = 0; localRec.state = 'Inactive'; }
    siRenderExisting();
    siUpdateCostMatch();

    setTimeout(() => { const modal = document.getElementById('si_deactivate_modal'); if (modal) modal.remove(); }, 1400);
  } catch (e) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ ERROR: ' + e.message;
    btn.disabled = false; btn.textContent = 'RETRY';
  }
}

function siAddRow(prefill = {}) {
  SI.rowSeq++;
  const seq = SI.rowSeq;
  const isEdit = !!prefill._editId;
  const editId = prefill._editId || null;
  const wrap = document.getElementById('si_rows_wrap');
  const card = document.createElement('div');
  card.className = 'table-panel';
  card.id = isEdit ? 'si_row_edit_' + editId : 'si_row_new_' + seq;
  card.style.cssText = 'padding:16px;margin-bottom:14px;position:relative;border-left:3px solid ' + (isEdit ? 'var(--accent-gold)' : 'var(--accent-blue)') + ';';

  const badge = isEdit
    ? `<span style="font-family:'Share Tech Mono',monospace;font-size:9px;background:var(--accent-gold);color:var(--bg-dark);padding:2px 8px;display:inline-block;margin-bottom:10px;">EDITING EXISTING</span>`
    : `<span style="font-family:'Share Tech Mono',monospace;font-size:9px;background:var(--accent-blue);color:var(--bg-dark);padding:2px 8px;display:inline-block;margin-bottom:10px;">NEW SUB-ITEM ${seq}</span>`;

  const v = (key) => prefill[key] !== undefined && prefill[key] !== null ? prefill[key] : '';

  card.innerHTML = `
    ${badge}
    <button data-si-action="remove-row" data-seq="${seq}" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--accent-red);cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:10px;">&#x2716; REMOVE</button>

    <div style="display:grid;grid-template-columns:22fr 28fr 10fr 8fr 10fr 12fr;gap:8px;margin-bottom:10px;min-width:0;">
      <div class="form-group" style="min-width:0;">
        <label class="form-label">SUB-ITEM NAME <span style="color:var(--accent-red)">*</span></label>
        <input class="form-input" id="sir_name_${seq}" type="text" value="${v('sub_item_name')}" placeholder="Sub-item name" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">DESCRIPTION <span style="color:var(--accent-red)">*</span></label>
        <input class="form-input" id="sir_desc_${seq}" type="text" value="${v('item_description')}" placeholder="Detailed description" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">MAKE / MODEL</label>
        <input class="form-input" id="sir_make_${seq}" type="text" value="${v('make_model')}" placeholder="Mfr/Model" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">CAPACITY</label>
        <input class="form-input" id="sir_cap_${seq}" type="text" value="${v('capacity')}" placeholder="50 HP" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">CONSIGNEE DEPOT <span style="color:var(--accent-red)">*</span></label>
        <select class="form-input" id="sir_cdepot_${seq}" style="padding:8px 6px;width:100%;min-width:0;">
          <option value="">&mdash; Select &mdash;</option>
          ${['SBC', 'YPR', 'SMVB', 'SGT', 'BAND', 'SBC-HQ'].map(d => `<option value="${d}" ${v('consignee_depot') === d ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">SANCTIONED COST (Rs.)</label>
        <input class="form-input" id="sir_sc_${seq}" type="number" step="0.01" value="${v('sanctioned_cost')}" placeholder="0.00" data-si-costmatch="1" style="width:100%;min-width:0;">
      </div>
    </div>

    <div style="display:grid;grid-template-columns:8fr 8fr 12fr 12fr 12fr 12fr 12fr;gap:8px;min-width:0;">
      <div class="form-group" style="min-width:0;">
        <label class="form-label">QTY <span style="color:var(--accent-red)">*</span></label>
        <input class="form-input" id="sir_qty_${seq}" type="number" step="0.01" value="${v('qty')}" placeholder="0" data-si-calc="${seq}" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">UNIT <span style="color:var(--accent-red)">*</span></label>
        <input class="form-input" id="sir_unit_${seq}" type="text" list="unitOptions" value="${v('unit')}" placeholder="Nos/Set/M..." style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">BASE PRICE <span style="color:var(--accent-red)">*</span></label>
        <input class="form-input" id="sir_base_${seq}" type="number" step="0.01" value="${v('base_price')}" placeholder="0.00" data-si-calc="${seq}" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">TAX &amp; OTHERS</label>
        <input class="form-input" id="sir_tax_${seq}" type="number" step="0.01" value="${v('tax_and_others')}" placeholder="0.00" data-si-calc="${seq}" style="width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label" style="color:var(--accent-green);">UNIT PRICE <span style="font-size:8px;opacity:0.7;">(auto-filled)</span></label>
        <input class="form-input" id="sir_uprice_${seq}" type="number" readonly value="${v('unit_price')}" style="color:var(--accent-green);width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label" style="color:var(--accent-cyan);">TOTAL VALUE <span style="font-size:8px;opacity:0.7;">(auto-filled)</span></label>
        <input class="form-input" id="sir_total_${seq}" type="number" readonly value="${v('total_value')}" style="color:var(--accent-cyan);font-weight:700;width:100%;min-width:0;">
      </div>
      <div class="form-group" style="min-width:0;">
        <label class="form-label">VETTED COST (Rs.) <span style="color:var(--accent-red)">*</span></label>
        <input class="form-input" id="sir_vc_${seq}" type="number" step="0.01" value="${v('vetted_cost')}" placeholder="0.00" data-si-calc="${seq}" style="width:100%;min-width:0;">
      </div>
    </div>
    <input type="hidden" id="sir_editid_${seq}" value="${editId || ''}">`;

  wrap.appendChild(card);

  SI.newRows.push({ seq, editId });
  if (v('base_price') || v('tax_and_others') || v('qty')) siCalcRow(seq);
  siUpdateSubmitBtn();
}
document.getElementById('si_add_row_btn').addEventListener('click', () => siAddRow());
document.getElementById('si_rows_wrap').addEventListener('input', (e) => {
  if (e.target.dataset.siCalc) siCalcRow(e.target.dataset.siCalc);
  else if (e.target.dataset.siCostmatch) siUpdateCostMatch();
});
document.getElementById('si_rows_wrap').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-si-action="remove-row"]');
  if (btn) siRemoveRow(btn.closest('.table-panel').id, parseInt(btn.dataset.seq, 10), btn.dataset.seq && document.getElementById(`sir_editid_${btn.dataset.seq}`)?.value);
});

function siCalcRow(seq) {
  const base = parseFloat(document.getElementById(`sir_base_${seq}`)?.value) || 0;
  const tax = parseFloat(document.getElementById(`sir_tax_${seq}`)?.value) || 0;
  const qty = parseFloat(document.getElementById(`sir_qty_${seq}`)?.value) || 0;
  const up = base + tax;
  const total = qty * up;
  const elUp = document.getElementById(`sir_uprice_${seq}`);
  const elTot = document.getElementById(`sir_total_${seq}`);
  if (elUp) elUp.value = up.toFixed(2);
  if (elTot) elTot.value = total.toFixed(2);
  siUpdateCostMatch();
}

// Fixed vs v16: takes seq directly (already known at the call site via
// data-seq) instead of parsing it back out of the card's DOM id, which
// breaks for edit-rows (see file-header note).
function siRemoveRow(cardId, seq, editId) {
  const card = document.getElementById(cardId);
  if (card) {
    SI.newRows = SI.newRows.filter(r => r.seq !== seq);
    if (editId) SI.editedIds.delete(editId);
    card.remove();
  }
  siUpdateCostMatch();
  siUpdateSubmitBtn();
}

function siUpdateCostMatch() {
  // Option A: derive total from actual sanctioned_cost of sub-items in existingRows
  const totalCost = SI.existingRows.reduce((s, r) => s + (parseFloat(r.sanctioned_cost) || 0), 0);
  // Keep display in sync — always the same source as the comparison
  const dispEl = document.getElementById('si_disp_total');
  if (dispEl) dispEl.textContent = totalCost > 0 ? 'Rs. ' + Number(totalCost).toLocaleString('en-IN') : '—';

  let sum = 0;
  SI.existingRows.forEach(r => {
    const sid = String(r.sub_item_id);
    const isEditing = [...SI.editedIds].some(id => String(id) === sid);
    if (isEditing) {
      const nr = SI.newRows.find(x => String(x.editId) === sid);
      if (nr) {
        const elVc = document.getElementById(`sir_vc_${nr.seq}`);
        sum += parseFloat(elVc?.value) || 0;
        return;
      }
    }
    sum += parseFloat(r.vetted_cost) || 0;
  });
  SI.newRows.forEach(nr => {
    if (nr.editId) return; // already counted above
    const elVc = document.getElementById(`sir_vc_${nr.seq}`);
    if (elVc) sum += parseFloat(elVc.value) || 0;
  });

  const sumFmt = sum > 0 ? 'Rs. ' + sum.toLocaleString('en-IN') : 'Rs. 0';
  document.getElementById('si_disp_subsum').textContent = sumFmt;

  if (!totalCost) {
    document.getElementById('si_cost_bar').style.background = 'var(--border)';
    const bdg = document.getElementById('si_match_badge');
    if (bdg) { bdg.style.display = ''; bdg.textContent = 'NO REF'; bdg.style.background = 'rgba(74,122,155,0.15)'; bdg.style.color = 'var(--text-muted)'; bdg.style.border = '1px solid var(--border)'; }
    return;
  }

  const match = Math.abs(sum - totalCost) < 1;
  const bar = document.getElementById('si_cost_bar');
  const badge = document.getElementById('si_match_badge');
  const strip = document.getElementById('si_parent_strip');

  if (match) {
    bar.style.background = 'var(--accent-green)';
    strip.style.borderLeftColor = 'var(--accent-green)';
    badge.style.display = ''; badge.textContent = '✓ MATCHED';
    badge.style.background = 'rgba(6,214,160,0.15)'; badge.style.color = 'var(--accent-green)'; badge.style.border = '1px solid rgba(6,214,160,0.4)';
  } else if (sum > totalCost) {
    bar.style.background = 'var(--accent-red)';
    strip.style.borderLeftColor = 'var(--accent-red)';
    badge.style.display = ''; badge.textContent = '⚠ EXCEEDS';
    badge.style.background = 'rgba(255,56,96,0.12)'; badge.style.color = 'var(--accent-red)'; badge.style.border = '1px solid rgba(255,56,96,0.3)';
  } else {
    bar.style.background = 'var(--accent-gold)';
    strip.style.borderLeftColor = 'var(--accent-cyan)';
    badge.style.display = ''; badge.textContent = '△ PENDING';
    badge.style.background = 'rgba(255,214,10,0.1)'; badge.style.color = 'var(--accent-gold)'; badge.style.border = '1px solid rgba(255,214,10,0.3)';
  }
}

function siUpdateSubmitBtn() {
  const hasEdits = SI.editedIds.size > 0;
  const btn = document.getElementById('si_submit_btn');
  if (btn) btn.textContent = hasEdits ? 'ADD & UPDATE SUB-ITEMS' : 'ADD SUB-ITEMS';
}

function siResetParentStrip() {
  SI.selectedLI = null;
  SI.upMode = false;
  SI.allUpRows = [];
  SI.groupCollapsed = {};
  const procDepotInput = document.getElementById('si_line_item_proc_depot');
  if (procDepotInput) procDepotInput.value = '';

  document.getElementById('si_parent_strip').style.display = 'none';
  document.getElementById('si_form_section').style.display = 'none';
  document.getElementById('si_line_item_id').value = '';
  document.getElementById('si_parent_strip').style.display = 'none';
  document.getElementById('si_form_section').style.display = 'none';
  document.getElementById('si_existing_section').style.display = 'none';
  document.getElementById('si_rows_wrap').innerHTML = '';
  SI.newRows = []; SI.editedIds = new Set(); SI.existingRows = []; SI.rowSeq = 0;
}

function siResetForm() {
  document.getElementById('si_rows_wrap').innerHTML = '';
  SI.newRows = []; SI.editedIds = new Set(); SI.rowSeq = 0;
  siUpdateSubmitBtn();
  siUpdateCostMatch();
  siAddRow();
}
document.getElementById('si_clear_form_btn').addEventListener('click', siResetForm);

async function siSubmitAll() {
  if (!SI.selectedLI) { showToast('SELECT AN ITEM FIRST', 'error'); return; }

  const lineItemId = SI.selectedLI.line_item_id;
  const planHead = SI.selectedLI.plan_head || '';
  // Fixed vs v16: SI.selectedLI.processing_depot is always undefined
  // (never fetched into SI.sanctionMap) — see file-header note. There's
  // no per-line-item processing depot available here at all, so the
  // assignment check below runs with whatever the *first* drafted
  // row's Consignee Depot is, same as how each row's own
  // processing_depot now defaults to its own consignee_depot.
  
  // NEW CODE
  // Grab the processing_depot directly from the selected parent line item
  const parentProcessingDepot = SI.selectedLI.processing_depot || '';

  const _siChk = canEditRecord({ plan_head: planHead, processing_depot: parentProcessingDepot });
  
  //const firstRowDepot = SI.newRows.length ? (document.getElementById(`sir_cdepot_${SI.newRows[0].seq}`)?.value || '') : '';

  //const _siChk = canEditRecord({ plan_head: planHead, processing_depot: firstRowDepot });
  if (!_siChk.ok) {
    showToast('EDIT BLOCKED: ' + _siChk.reason.slice(0, 60), 'error');
    return;
  }

  const toInsert = [];
  const toUpdate = [];

  for (const nr of SI.newRows) {
    const { seq, editId } = nr;
    const name = (document.getElementById(`sir_name_${seq}`)?.value || '').trim();
    const desc = (document.getElementById(`sir_desc_${seq}`)?.value || '').trim();
    const de = parseFloat(document.getElementById(`sir_vc_${seq}`)?.value) || 0;
    const sc = parseFloat(document.getElementById(`sir_sc_${seq}`)?.value) || de;
    const cdepot = (document.getElementById(`sir_cdepot_${seq}`)?.value || '').trim();
    const unit = (document.getElementById(`sir_unit_${seq}`)?.value || '').trim();
    const qty = parseFloat(document.getElementById(`sir_qty_${seq}`)?.value) || 0;
    const base = parseFloat(document.getElementById(`sir_base_${seq}`)?.value) || 0;
    const tax = parseFloat(document.getElementById(`sir_tax_${seq}`)?.value) || 0;
    const up = parseFloat(document.getElementById(`sir_uprice_${seq}`)?.value) || 0;
    const tot = parseFloat(document.getElementById(`sir_total_${seq}`)?.value) || 0;
    const make = (document.getElementById(`sir_make_${seq}`)?.value || '').trim();
    const cap = (document.getElementById(`sir_cap_${seq}`)?.value || '').trim();

    if (!name || !desc || !unit || qty <= 0 || base < 0) {
      showToast(`ROW ${seq}: FILL ALL REQUIRED FIELDS`, 'error'); return;
    }

// NEW CODE
  const payload = {
    line_item_id: lineItemId,
    sub_item_name: name, item_description: desc,
    make_model: make, capacity: cap,
    sanctioned_cost: sc,
    vetted_cost: de,
    consignee_depot: cdepot,
    unit, qty, base_price: base,
    tax_and_others: tax, unit_price: up, total_value: tot,
    
    // Assign the processing depot from the parent line item
    processing_depot: parentProcessingDepot, 
    
    under_power: SI.selectedLI?.under_power || '',
  };

    if (editId) toUpdate.push({ sub_item_id: String(editId), payload });
    else toInsert.push(payload);
  }

  if (!toInsert.length && !toUpdate.length) { showToast('NOTHING TO SUBMIT', 'error'); return; }

  const msgEl = document.getElementById('si_submit_msg');
  const btn = document.getElementById('si_submit_btn');
  btn.disabled = true; btn.textContent = 'SUBMITTING...';
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = 'Saving...';

  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      if (toInsert.length) {
        await nxFetch('sanction_sub_item', { method: 'POST', body: toInsert, prefer: 'return=representation' });
      }
      for (const upd of toUpdate) {
        await nxFetch(`sanction_sub_item?sub_item_id=eq.${upd.sub_item_id}`, { method: 'PATCH', body: upd.payload, prefer: 'return=representation' });
      }
      msgEl.style.color = 'var(--accent-green)';
      msgEl.textContent = `✓ ${toInsert.length} INSERTED · ${toUpdate.length} UPDATED · SAVED TO NEXUS`;
      showToast('SUB-ITEMS SAVED → NEXUS');
      // process_detail rows for newly inserted sub-items get created
      // from Process tab → Procurement, same as v16.
    } else {
      msgEl.style.color = 'var(--accent-red)';
      msgEl.textContent = '✕ NO DATABASE CONFIGURED — Settings → Database';
      showToast('NO DB CONFIGURED', 'error');
      btn.disabled = false;
      siUpdateSubmitBtn();
      return;
    }

    await siFetchExisting(lineItemId);
    document.getElementById('si_rows_wrap').innerHTML = '';
    SI.newRows = []; SI.editedIds = new Set(); SI.rowSeq = 0;
    siAddRow();
    siUpdateSubmitBtn();
    siUpdateCostMatch();
  } catch (e) {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ ERROR: ' + e.message;
    showToast('ERROR: ' + e.message.slice(0, 40), 'error');
  }

  btn.disabled = false;
  siUpdateSubmitBtn();
}
document.getElementById('si_submit_btn').addEventListener('click', siSubmitAll);

function siOnTabOpen() {
  if (Object.keys(SI.sanctionMap).length === 0) siLoadUnderPowers();
}

/* ================================================================
   CHRONOLOG
   ================================================================
   Tables: sanction_sub_item → sanction_line_item → sanction_header
           (read, to build the ownership-filtered hierarchy),
           chronolog (read/write manual events), log_table (read-only,
           the same audit table auditRecord() in core/services.js
           writes to on every nxFetch POST/PATCH/DELETE — "INCLUDE
           SYSTEM LOGS" surfaces those rows alongside manual entries).

   Four cascading dropdowns (Under Power → Sanction → Line Item → Sub
   Item) build a path string like CESBC-0001-0002-0003 with '*' for
   whatever isn't selected yet. Selecting any level auto-collapses the
   dropdowns above it to that selection's actual ancestors, and
   repopulates the dropdowns below it with every descendant (regardless
   of ownership) so a user can drill down to find their own item even
   if the parent sanction has items split across people. Recording and
   viewing only unlock once every descendant under the current
   selection is something this user owns (or they're full-access).

   File attachments upload via multipart/form-data straight to the
   chronolog-upload.php script on the same NAS Web Station that serves
   this page (10.205.50.15:8088) — same-origin, so no CORS concerns.
   That endpoint isn't something I can inspect or change from here; if
   uploads fail, the most likely cause is the PHP script or its target
   directory not being present/writable on the NAS itself, not this
   page's code.
   ================================================================ */
const CL_FULL_ACCESS_ROLES = new Set(['admin', 'master', 'hq-agent']);
const CL_LEVELS = ['UNDER_POWER', 'SANCTION', 'LINE_ITEM', 'SUB_ITEM'];
const CL_DROPDOWN_IDS = { UNDER_POWER: 'cl_under_power', SANCTION: 'cl_sanction', LINE_ITEM: 'cl_line_item', SUB_ITEM: 'cl_sub_item' };

const CL = {
  upId: null, upName: null, upCode: null,
  sanctionId: null, sanctionCode: null,
  lineItemId: null, lineItemName: null,
  subItemId: null, subItemName: null,
  level: null, // 'UNDER_POWER' | 'SANCTION' | 'LINE_ITEM' | 'SUB_ITEM'

  fullAccess: false,
  allRows: [],

  getPath() {
    const up = this.upCode || '*';
    const sh = this.sanctionId ? String(this.sanctionId).padStart(4, '0') : '*';
    const li = this.lineItemId ? String(this.lineItemId).padStart(4, '0') : '*';
    const si = this.subItemId ? String(this.subItemId).padStart(4, '0') : '*';
    if (this.subItemId) return `${up}-${sh}-${li}-${si}`;
    if (this.lineItemId) return `${up}-${sh}-${li}-*`;
    if (this.sanctionId) return `${up}-${sh}-*-*`;
    if (this.upId) return `${up}-*-*-*`;
    return null;
  },

  getAncestryPaths() {
    const up = this.upCode || '*';
    const sh = this.sanctionId ? String(this.sanctionId).padStart(4, '0') : null;
    const li = this.lineItemId ? String(this.lineItemId).padStart(4, '0') : null;
    const si = this.subItemId ? String(this.subItemId).padStart(4, '0') : null;
    const paths = [];
    if (up !== '*') {
      paths.push(`${up}-*-*-*`);
      if (sh) {
        paths.push(`${up}-${sh}-*-*`);
        if (li) {
          paths.push(`${up}-${sh}-${li}-*`);
          if (si) paths.push(`${up}-${sh}-${li}-${si}`);
        }
      }
    }
    return paths;
  },

  reset() {
    this.upId = this.upName = this.upCode = null;
    this.sanctionId = this.sanctionCode = null;
    this.lineItemId = this.lineItemName = null;
    this.subItemId = this.subItemName = null;
    this.level = null;
  },
};

function clBuildUpCode(upName) {
  return 'UP' + String(Math.abs(String(upName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0))).slice(-4).padStart(4, '0');
}

// Loads the full sub-item hierarchy + ownership, once per tab-open.
// For full-access roles (admin/master/hq-agent): all rows owned=true.
// For everyone else: owned = the same "My Items" formula used in My
// Space — (myDepots empty OR depot ∈ myDepots) AND (myPlanHeads empty
// OR plan_head ∈ myPlanHeads). Deliberately the broader
// assignment-match, not the deduplicated single-owner view — multiple
// people legitimately recording notes against the same item is fine.
async function clLoadOwnershipData() {
  const session = getActiveSession();
  CL.fullAccess = CL_FULL_ACCESS_ROLES.has(session?.role || '');
  CL.allRows = [];

  const profile = session?.profile || {};
  const myDepots = CL.fullAccess ? [] : parseMultiVal(profile.depots);
  const myPlanHeads = CL.fullAccess ? [] : parseMultiVal(profile.planHeads);

  try {
    const cfg = getDbConfig();
    if (!cfg?.nexus?.url || !cfg?.nexus?.key) return;

    const hierRows = await nxFetch(
      'sanction_sub_item?select=sub_item_id,sub_item_name,consignee_depot,processing_depot,line_item_id,' +
      'sanction_line_item(line_item_id,item_name,sanction_id,' +
      'sanction_header(under_power,code,original_sanction_name,plan_head))'
    );

    CL.allRows = (hierRows || [])
      .map(r => {
        const li = r.sanction_line_item || {};
        const sh = li.sanction_header || {};
        const processingDepot = r.processing_depot || '';
        const consigneeDepot = r.consignee_depot || '';
        const planHead = sh.plan_head ?? null;
        const depotOk = !myDepots.length || myDepots.includes(processingDepot) || myDepots.includes(consigneeDepot);
        const planOk = !myPlanHeads.length || myPlanHeads.includes(String(planHead));
        return {
          sub_item_id: r.sub_item_id,
          sub_item_name: r.sub_item_name || '',
          consignee_depot: consigneeDepot,
          processing_depot: processingDepot,
          line_item_id: r.line_item_id ?? li.line_item_id,
          item_name: li.item_name || '',
          sanction_id: li.sanction_id,
          code: sh.code || '',
          original_sanction_name: sh.original_sanction_name || '',
          under_power: sh.under_power || '',
          plan_head: planHead,
          owned: CL.fullAccess ? true : (depotOk && planOk),
        };
      })
      .filter(r => r.under_power && r.sanction_id != null && r.line_item_id != null);
  } catch (e) { console.warn('clLoadOwnershipData:', e); }
}

function clDistinctOptions(rows, keyFn, labelFn) {
  const seen = new Map();
  rows.forEach(r => {
    const k = String(keyFn(r));
    if (!seen.has(k)) seen.set(k, labelFn(r));
  });
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function clSubItemLabel(r) { return r.sub_item_name + (r.consignee_depot ? ' [' + r.consignee_depot + ']' : ''); }
function clSanctionLabel(r) { return r.code + (r.original_sanction_name ? ' — ' + r.original_sanction_name.slice(0, 40) : ''); }

function clPopulateOptions(id, opts, selectedVal = '') {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- SELECT --</option>' +
    opts.map(o => `<option value="${o.value}" ${String(o.value) === String(selectedVal) ? 'selected' : ''}>${o.label}</option>`).join('');
  sel.disabled = false;
}

// Resets all 4 dropdowns to the "as the user came on the Chronolog
// page" state: each shows every node (at its level) that is, or is an
// ancestor of, a sub-item this user owns — or, for full-access roles,
// every node in the system.
function clResetToInitial() {
  const rows = CL.fullAccess ? CL.allRows : CL.allRows.filter(r => r.owned);

  clPopulateOptions('cl_under_power', clDistinctOptions(rows, r => r.under_power, r => r.under_power));
  clPopulateOptions('cl_sanction', clDistinctOptions(rows, r => r.sanction_id, clSanctionLabel));
  clPopulateOptions('cl_line_item', clDistinctOptions(rows, r => r.line_item_id, r => r.item_name));
  clPopulateOptions('cl_sub_item',
    rows.slice().sort((a, b) => a.sub_item_name.localeCompare(b.sub_item_name))
      .map(r => ({ value: String(r.sub_item_id), label: clSubItemLabel(r) })));

  CL.reset();
  clClearHighlights();
  clHideEntryAndHistory();
}

// Unified handler for all 4 dropdowns. On selecting X at `level`:
// ancestor dropdowns collapse to X's single actual ancestor at that
// level, auto-selected; descendant dropdowns repopulate with every
// node under X regardless of owner, so the user can drill down to
// find whichever of X's descendants belongs to them. Entry/history
// only unlock if every one of X's descendant sub-items is owned by
// this user (or full access) — otherwise a "drill down" message shows
// instead. Selecting "-- SELECT --" on any dropdown fully resets.
async function clOnDropdownChange(level) {
  const sel = document.getElementById(CL_DROPDOWN_IDS[level]);
  const val = sel.value;

  if (!val) { clResetToInitial(); return; }

  let matchRows;
  if (level === 'UNDER_POWER') matchRows = CL.allRows.filter(r => r.under_power === val);
  else if (level === 'SANCTION') matchRows = CL.allRows.filter(r => String(r.sanction_id) === val);
  else if (level === 'LINE_ITEM') matchRows = CL.allRows.filter(r => String(r.line_item_id) === val);
  else matchRows = CL.allRows.filter(r => String(r.sub_item_id) === val);

  if (!matchRows.length) { clResetToInitial(); return; }
  const rep = matchRows[0]; // representative row — ancestors are shared across matchRows

  CL.level = level;
  CL.upName = rep.under_power;
  CL.upCode = clBuildUpCode(rep.under_power);
  CL.sanctionId = (level === 'UNDER_POWER') ? null : String(rep.sanction_id);
  CL.sanctionCode = (level === 'UNDER_POWER') ? null : rep.code;
  CL.lineItemId = (level === 'UNDER_POWER' || level === 'SANCTION') ? null : String(rep.line_item_id);
  CL.lineItemName = (level === 'UNDER_POWER' || level === 'SANCTION') ? null : rep.item_name;
  CL.subItemId = (level === 'SUB_ITEM') ? String(rep.sub_item_id) : null;
  CL.subItemName = (level === 'SUB_ITEM') ? rep.sub_item_name : null;
  CL.upId = rep.under_power; // any truthy marker — getPath() only checks "is it set"

  const idx = CL_LEVELS.indexOf(level);

  if (idx > 0) clPopulateOptions('cl_under_power', [{ value: rep.under_power, label: rep.under_power }], rep.under_power);
  if (idx > 1) clPopulateOptions('cl_sanction', [{ value: String(rep.sanction_id), label: clSanctionLabel(rep) }], String(rep.sanction_id));
  if (idx > 2) clPopulateOptions('cl_line_item', [{ value: String(rep.line_item_id), label: rep.item_name }], String(rep.line_item_id));

  if (idx < 1) clPopulateOptions('cl_sanction', clDistinctOptions(matchRows, r => r.sanction_id, clSanctionLabel));
  if (idx < 2) clPopulateOptions('cl_line_item', clDistinctOptions(matchRows, r => r.line_item_id, r => r.item_name));
  if (idx < 3) clPopulateOptions('cl_sub_item',
    matchRows.slice().sort((a, b) => a.sub_item_name.localeCompare(b.sub_item_name))
      .map(r => ({ value: String(r.sub_item_id), label: clSubItemLabel(r) })));

  clClearHighlights();
  clHighlightDropdown(CL_DROPDOWN_IDS[level], true);

  const allOwned = CL.fullAccess || matchRows.every(r => r.owned);
  const levelLabel = {
    UNDER_POWER: 'UNDER POWER: ' + rep.under_power,
    SANCTION: 'SANCTION: ' + rep.code,
    LINE_ITEM: 'LINE ITEM: ' + (rep.item_name || '').slice(0, 40),
    SUB_ITEM: 'SUB ITEM: ' + (rep.sub_item_name || '').slice(0, 40),
  }[level];

  if (allOwned) {
    clShowLevelIndicator(levelLabel);
    clShowEntrySection();
    await clLoadHistory();
  } else {
    clShowLevelIndicator(levelLabel + '  — drill down to your item to view/record events');
    document.getElementById('cl_entry_section').style.display = 'none';
    document.getElementById('cl_history_section').style.display = 'none';
  }
}
['cl_under_power', 'cl_sanction', 'cl_line_item', 'cl_sub_item'].forEach(id => {
  const levelByDropdown = { cl_under_power: 'UNDER_POWER', cl_sanction: 'SANCTION', cl_line_item: 'LINE_ITEM', cl_sub_item: 'SUB_ITEM' };
  document.getElementById(id).addEventListener('change', () => clOnDropdownChange(levelByDropdown[id]));
});

function clHighlightDropdown(id, active) {
  const el = document.getElementById(id);
  const lbl = document.getElementById(id.replace('cl_', 'cl_lbl_').replace('under_power', 'up').replace('sanction', 'sh').replace('line_item', 'li').replace('sub_item', 'si'));
  if (el) {
    el.style.borderColor = active ? 'var(--accent-warn)' : '';
    el.style.boxShadow = active ? '0 0 0 2px rgba(255,214,10,0.25)' : '';
    el.style.color = active ? 'var(--accent-warn)' : '';
  }
  if (lbl) {
    lbl.style.color = active ? 'var(--accent-warn)' : '';
    lbl.style.fontWeight = active ? '700' : '';
  }
}

function clClearHighlights() {
  ['cl_under_power', 'cl_sanction', 'cl_line_item', 'cl_sub_item'].forEach(id => clHighlightDropdown(id, false));
}

function clShowLevelIndicator(text) {
  const el = document.getElementById('cl_level_indicator');
  document.getElementById('cl_level_text').textContent = text;
  if (el) el.style.display = '';
}

function clShowEntrySection() {
  const canRecord = rbacCan('chronolog:record');
  const entryEl = document.getElementById('cl_entry_section');
  if (entryEl) entryEl.style.display = canRecord ? '' : 'none';
}

function clHideEntryAndHistory() {
  document.getElementById('cl_entry_section').style.display = 'none';
  document.getElementById('cl_history_section').style.display = 'none';
  document.getElementById('cl_level_indicator').style.display = 'none';
}

function clToggleAttachment() {
  const checked = document.getElementById('cl_has_attachment').checked;
  const fileSection = document.getElementById('cl_file_section');
  const grid = document.getElementById('cl_entry_grid');
  if (fileSection) fileSection.style.display = checked ? '' : 'none';
  if (!checked) {
    const fileInput = document.getElementById('cl_file_input');
    if (fileInput) fileInput.value = '';
  }
  if (grid) grid.style.gridTemplateColumns = checked ? '160px 1fr auto auto' : '160px 1fr auto';
}
document.getElementById('cl_has_attachment').addEventListener('change', clToggleAttachment);

function clValidateFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('FILE TOO LARGE — Maximum 5MB allowed', 'error');
    input.value = '';
    return;
  }
  document.getElementById('cl_entry_status').textContent = 'File selected: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
}
document.getElementById('cl_file_input').addEventListener('change', (e) => clValidateFile(e.target));

document.getElementById('cl_subject').addEventListener('input', (e) => {
  document.getElementById('cl_subject_count').textContent = '(' + e.target.value.length + '/50)';
});

async function clRecordEvent() {
  const statusEl = document.getElementById('cl_entry_status');
  const path = CL.getPath();
  if (!path) { showToast('SELECT AT LEAST UNDER POWER TO RECORD', 'error'); return; }

  const eventDate = document.getElementById('cl_event_date').value;
  const subject = document.getElementById('cl_subject').value.trim();
  const hasFile = document.getElementById('cl_has_attachment').checked;
  const fileInput = document.getElementById('cl_file_input');

  if (!eventDate) { showToast('EVENT DATE IS REQUIRED', 'error'); return; }
  if (!subject) { showToast('SUBJECT IS REQUIRED', 'error'); return; }
  if (hasFile && (!fileInput.files || !fileInput.files[0])) {
    showToast('PLEASE SELECT A FILE OR UNCHECK ATTACHMENT', 'error'); return;
  }

  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = 'Recording event...';

  let filePath = null, fileName = null, fileSize = null;

  // Uploads straight to the PHP script on this same NAS Web Station —
  // same-origin as this page, so no CORS handling needed.
  if (hasFile && fileInput.files[0]) {
    statusEl.textContent = 'Uploading file...';
    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      formData.append('path', path);
      const uploadResp = await fetch('http://10.205.50.15:8088/chronolog-upload.php', { method: 'POST', body: formData });
      const uploadResult = await uploadResp.json();
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload failed');
      filePath = uploadResult.file_path;
      fileName = uploadResult.file_name;
      fileSize = uploadResult.file_size;
    } catch (e) {
      statusEl.style.color = 'var(--accent-red)';
      statusEl.textContent = '✕ File upload failed: ' + e.message.slice(0, 60);
      return;
    }
  }

  try {
    const session = getActiveSession();
    const payload = {
      path: path,
      path_level: CL.level,
      up_code: CL.upCode,
      up_name: CL.upName,
      sanction_id: CL.sanctionId ? parseInt(CL.sanctionId) : null,
      line_item_id: CL.lineItemId ? parseInt(CL.lineItemId) : null,
      sub_item_id: CL.subItemId ? parseInt(CL.subItemId) : null,
      event_date: eventDate,
      subject: subject,
      has_attachment: hasFile && !!filePath,
      file_path: filePath,
      file_name: fileName,
      file_size: fileSize,
      recorded_by: session?.user || 'unknown',
      recorded_at: new Date().toISOString(),
    };

    await nxFetch('chronolog', { method: 'POST', body: payload, prefer: 'return=minimal' });

    statusEl.style.color = 'var(--accent-green)';
    statusEl.textContent = '✓ Event recorded successfully';
    showToast('EVENT RECORDED');

    document.getElementById('cl_event_date').value = '';
    document.getElementById('cl_subject').value = '';
    document.getElementById('cl_subject_count').textContent = '(0/50)';
    document.getElementById('cl_has_attachment').checked = false;
    document.getElementById('cl_file_input').value = '';
    document.getElementById('cl_file_section').style.display = 'none';

    await clLoadHistory();
  } catch (e) {
    statusEl.style.color = 'var(--accent-red)';
    statusEl.textContent = '✕ Error: ' + e.message.slice(0, 60);
  }
}
document.getElementById('cl_record_btn').addEventListener('click', clRecordEvent);

async function clLoadHistory() {
  const histSection = document.getElementById('cl_history_section');
  const listEl = document.getElementById('cl_history_list');
  const emptyEl = document.getElementById('cl_history_empty');
  const loadingEl = document.getElementById('cl_history_loading');
  const metaEl = document.getElementById('cl_history_meta');
  const sysToggleWrap = document.getElementById('cl_syslog_toggle_wrap');
  const sysToggle = document.getElementById('cl_include_syslogs');

  histSection.style.display = '';
  listEl.innerHTML = '';
  emptyEl.style.display = 'none';
  loadingEl.style.display = '';

  // System-log toggle is only available at SUB_ITEM level.
  const isSubItem = CL.level === 'SUB_ITEM' && CL.subItemId;
  if (sysToggleWrap) sysToggleWrap.style.display = isSubItem ? 'flex' : 'none';
  const includeSysLogs = isSubItem && sysToggle && sysToggle.checked;

  const paths = CL.getAncestryPaths();
  if (!paths.length) { loadingEl.style.display = 'none'; emptyEl.style.display = ''; return; }

  try {
    const url = `chronolog?or=(${paths.map(p => 'path.eq.' + encodeURIComponent(p)).join(',')})&order=event_date.desc,recorded_at.desc`;
    const chronoEvents = await nxFetch(url);

    let timeline = (chronoEvents || []).map(ev => ({ _source: 'manual', _ts: new Date(ev.recorded_at || ev.event_date), ev }));

    if (includeSysLogs) {
      const sysRows = await nxFetch(`log_table?sub_item_id=eq.${CL.subItemId}&order=logged_at.desc&limit=500`);
      (sysRows || []).forEach(r => { timeline.push({ _source: 'system', _ts: new Date(r.logged_at), sys: r }); });
    }

    timeline.sort((a, b) => b._ts - a._ts);

    loadingEl.style.display = 'none';

    if (!timeline.length) {
      emptyEl.style.display = '';
      metaEl.textContent = '0 EVENTS';
      return;
    }

    const manualCount = timeline.filter(t => t._source === 'manual').length;
    const sysCount = timeline.filter(t => t._source === 'system').length;
    metaEl.textContent = includeSysLogs
      ? `${manualCount} MANUAL + ${sysCount} SYSTEM = ${timeline.length} EVENT(S)`
      : `${timeline.length} EVENT(S) — SHOWING FULL ANCESTRY`;

    const canEdit = rbacCan('chronolog:edit');

    listEl.innerHTML = timeline.map((t) => {
      if (t._source === 'system') {
        const r = t.sys;
        const ts = r.logged_at ? r.logged_at.slice(0, 16).replace('T', ' ') : '';
        const action = r.field_name === '*row*' ? `${r.new_value} ROW` : `${r.field_name}: ${r.old_value ?? '—'} → ${r.new_value ?? '—'}`;
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid var(--text-muted);
          border-radius:8px;padding:10px 16px;display:flex;gap:12px;align-items:flex-start;opacity:0.85;">
          <div style="background:var(--text-muted);color:var(--bg-dark);font-family:'Share Tech Mono',monospace;
            font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;flex-shrink:0;margin-top:2px;">SYS</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:2px;">
              <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--accent-cyan);font-weight:700;">${ts}</span>
              <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);border:1px solid var(--text-muted);padding:1px 6px;border-radius:3px;">SYSTEM</span>
              <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-secondary);">${r.username || 'unknown'}</span>
              <span style="font-size:11px;color:var(--text-secondary);">${action}</span>
            </div>
            <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">
              ${r.table_name} &nbsp;·&nbsp; SUB-ITEM #${r.sub_item_id}
            </div>
          </div>
        </div>`;
      }

      const ev = t.ev;
      const levelColor = { UNDER_POWER: '#a855f7', SANCTION: 'var(--accent-blue)', LINE_ITEM: 'var(--accent-cyan)', SUB_ITEM: 'var(--accent-green)' }[ev.path_level] || 'var(--text-muted)';
      const levelLabel = { UNDER_POWER: 'UP', SANCTION: 'SH', LINE_ITEM: 'LI', SUB_ITEM: 'SI' }[ev.path_level] || '?';

      return `<div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid ${levelColor};
        border-radius:8px;padding:12px 16px;display:flex;gap:12px;align-items:flex-start;">

        <div style="background:${levelColor};color:var(--bg-dark);font-family:'Share Tech Mono',monospace;
          font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;flex-shrink:0;margin-top:2px;">
          ${levelLabel}
        </div>

        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--accent-cyan);font-weight:700;">
              ${ev.recorded_at ? ev.recorded_at.slice(0, 16).replace('T', ' ') : ev.event_date}
            </span>
            <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--accent-gold);border:1px solid var(--accent-gold);padding:1px 6px;border-radius:3px;">MANUAL</span>
            <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-secondary);">${ev.recorded_by}</span>
            <span style="font-size:12px;color:var(--text-primary);font-weight:600;">${ev.subject}</span>
            ${ev.has_attachment ? `<span style="font-family:'Share Tech Mono',monospace;font-size:9px;
              color:var(--accent-warn);border:1px solid var(--accent-warn);padding:1px 6px;border-radius:3px;">
              📎 ${ev.file_name || 'FILE'}
            </span>` : ''}
          </div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">
            ${ev.path_level.replace('_', ' ')} &nbsp;·&nbsp; ${ev.up_name || ''}
            ${ev.sanction_id ? ' → SH#' + ev.sanction_id : ''}
            ${ev.line_item_id ? ' → LI#' + ev.line_item_id : ''}
            ${ev.sub_item_id ? ' → SI#' + ev.sub_item_id : ''}
            &nbsp;·&nbsp; EVENT DATE: ${ev.event_date}
          </div>
        </div>

        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${ev.file_path ? `<button data-cl-action="download" data-file-path="${ev.file_path}" data-file-name="${ev.file_name || 'file'}"
            style="background:transparent;border:1px solid var(--accent-warn);color:var(--accent-warn);
            padding:4px 8px;border-radius:4px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:9px;">
            ↓ FILE
          </button>` : ''}
          ${canEdit ? `<button data-cl-action="delete" data-chrono-id="${ev.chrono_id}"
            style="background:transparent;border:1px solid var(--accent-red);color:var(--accent-red);
            padding:4px 8px;border-radius:4px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:9px;">
            DEL
          </button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    loadingEl.style.display = 'none';
    listEl.innerHTML = `<div style="text-align:center;padding:20px;font-family:'Share Tech Mono',monospace;
      font-size:10px;color:var(--accent-red);">ERROR LOADING EVENTS: ${e.message.slice(0, 80)}</div>`;
    console.warn('clLoadHistory:', e);
  }
}
document.getElementById('cl_include_syslogs').addEventListener('change', clLoadHistory);
document.getElementById('cl_history_list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cl-action]');
  if (!btn) return;
  if (btn.dataset.clAction === 'download') clDownloadFile(btn.dataset.filePath, btn.dataset.fileName);
  if (btn.dataset.clAction === 'delete') clDeleteEvent(btn.dataset.chronoId);
});

async function clDeleteEvent(chronoId) {
  if (!confirm('Delete this event? This cannot be undone.')) return;
  try {
    await nxFetch(`chronolog?chrono_id=eq.${chronoId}`, { method: 'DELETE', prefer: 'return=minimal' });
    showToast('EVENT DELETED');
    await clLoadHistory();
  } catch (e) {
    showToast('DELETE FAILED: ' + e.message.slice(0, 40), 'error');
  }
}

function clDownloadFile(filePath, fileName) {
  const a = document.createElement('a');
  a.href = 'http://10.205.50.15:8088/' + filePath;
  a.download = fileName;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function clOnTabOpen() {
  await clLoadOwnershipData();
  clResetToInitial();
  document.getElementById('cl_event_date').value = new Date().toISOString().split('T')[0];
  const hasFileCb = document.getElementById('cl_has_attachment');
  if (hasFileCb) hasFileCb.checked = false;
  clToggleAttachment();
}

/* ================================================================
   COLUMN SETTINGS (Procurement table) — persisted to localStorage,
   same key v16 uses, so a preference set here would carry over if
   the same browser later opens v16 directly (and vice versa).
   ================================================================ */
const PD_TOGGLE_COLS = ['remarks', 'stage', 'unitprice', 'depot', 'nextdue', 'ownersse', 'processpdc'];
const PD_TOGGLE_GROUPS = {
  indent: ['indentno', 'indentdate', 'tendercalledon', 'tenderopenedon'],
  loapo:  ['vendorname', 'loaponumber', 'loapodate'],
  inward: ['deliverydate', 'commissioningdate', 'ptcdate', 'crnno', 'crndate'],
};

function pdLoadColumnPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('drgsbc_pd_col_prefs') || '{}');
    return { cols: saved.cols || {}, grps: saved.grps || {} };
  } catch (e) { return { cols: {}, grps: {} }; }
}
function pdSaveColumnPrefs(prefs) {
  localStorage.setItem('drgsbc_pd_col_prefs', JSON.stringify(prefs));
}
function pdApplyColumnVisibility() {
  const prefs = pdLoadColumnPrefs();
  // Scope strictly to the two table elements. Each table must be fully
  // spelled out in each selector — a comma-separated scope prefix like
  // '#pd_proc_table, #pd_bill_table [attr]' is a CSS selector bug that
  // selects #pd_proc_table itself, not its descendants, causing the
  // entire table to vanish when that attribute's column is hidden.
  PD_TOGGLE_COLS.forEach(col => {
    const show = !!prefs.cols[col];
    document.querySelectorAll(`#pd_proc_table [data-col="${col}"], #pd_bill_table [data-col="${col}"]`)
      .forEach(el => { el.style.display = show ? '' : 'none'; });
  });
  Object.keys(PD_TOGGLE_GROUPS).forEach(grp => {
    const show = !!prefs.grps[grp];
    document.querySelectorAll(`#pd_proc_table [data-grp="${grp}"], #pd_bill_table [data-grp="${grp}"]`)
      .forEach(el => { el.style.display = show ? '' : 'none'; });
  });
  pdComputeFrozenOffsets(prefs);
}

// Frozen-eligible columns in left-to-right order, with the fixed
// pixel widths declared statically in CSS for each [data-col]. The
// first 4 are always visible/frozen; the rest only freeze when their
// PD_TOGGLE_COLS preference is on. Pending With is mandatory but not
// in this list — it's deliberately excluded from freezing.
const PD_FROZEN_COLS = [
  { col: 'slno', width: 36, always: true },
  { col: 'subitem', width: 170, always: true },
  { col: 'qty', width: 60, always: true },
  { col: 'latestcost', width: 100, always: true },
  { col: 'remarks', width: 160 },
  { col: 'stage', width: 175 },
  { col: 'unitprice', width: 100 },
  { col: 'depot', width: 85 },
  { col: 'nextdue', width: 100 },
  { col: 'ownersse', width: 95 },
  { col: 'processpdc', width: 100 },
];

// Recomputes and injects `left:Npx` for every visible frozen column,
// stacking only the ones actually shown — since toggling an optional
// column off should close the gap, not leave a blank space pinned
// open. Applies identically to both Procurement and Billing tables
// (selectors aren't table-scoped) since they share the same column
// set and widths.
function pdComputeFrozenOffsets(prefs) {
  let styleEl = document.getElementById('pd_frozen_offset_style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'pd_frozen_offset_style';
    document.head.appendChild(styleEl);
  }

  let running = 0;
  const rules = [];
  PD_FROZEN_COLS.forEach(({ col, width, always }) => {
    const visible = always || !!prefs.cols[col];
    if (!visible) return;
    rules.push(`th[data-col="${col}"],td[data-col="${col}"]{position:sticky;left:${running}px;}`);
    running += width;
  });

  styleEl.textContent = rules.join('\n');
}
function pdSyncColumnPanel() {
  const prefs = pdLoadColumnPrefs();
  document.querySelectorAll('#pd_col_panel input[data-col]').forEach(cb => {
    cb.checked = !!prefs.cols[cb.dataset.col];
  });
  document.querySelectorAll('#pd_col_panel input[data-grp]').forEach(cb => {
    cb.checked = !!prefs.grps[cb.dataset.grp];
  });
  const groupEl = document.getElementById('pd_col_group_pills');
  if (groupEl) groupEl.style.display = PD.activeSubTab === 'billing' ? 'none' : '';
}
function pdToggleColumnPanel() {
  const panel = document.getElementById('pd_col_panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) { panel.style.display = 'none'; }
  else { pdSyncColumnPanel(); panel.style.display = ''; }
}
document.getElementById('pd_col_settings_btn').addEventListener('click', pdToggleColumnPanel);
document.querySelectorAll('#pd_col_panel input[data-col]').forEach(cb => {
  cb.addEventListener('change', () => {
    const prefs = pdLoadColumnPrefs();
    prefs.cols[cb.dataset.col] = cb.checked;
    pdSaveColumnPrefs(prefs);
    pdApplyColumnVisibility();
  });
});
document.querySelectorAll('#pd_col_panel input[data-grp]').forEach(cb => {
  cb.addEventListener('change', () => {
    const prefs = pdLoadColumnPrefs();
    prefs.grps[cb.dataset.grp] = cb.checked;
    pdSaveColumnPrefs(prefs);
    pdApplyColumnVisibility();
  });
});
document.addEventListener('click', (e) => {
  const panel = document.getElementById('pd_col_panel');
  if (!panel || panel.style.display === 'none') return;
  if (!panel.contains(e.target) && e.target.id !== 'pd_col_settings_btn') panel.style.display = 'none';
});

/* ================================================================
   ASSIGNMENT CHECK — same rule as v16: admin/master always allowed;
   others with no plan-head/depot assignment can edit anything their
   role permits; others with an assignment can only edit matching
   records.
   ================================================================ */
function canEditRecord(record) {
  const session = getActiveSession();
  const role = session?.role || '';
  if (ROLES_SEE_ALL.has(role)) return { ok: true };

  const profile = session?.profile || {};
  const myPlanHeads = parseMultiVal(profile.planHeads);
  const myDepots    = parseMultiVal(profile.depots);
  if (!myPlanHeads.length && !myDepots.length) return { ok: true };

  if (myPlanHeads.length) {
    const recHead = record?.plan_head ?? null;
    const recHeadStr = recHead !== null ? String(recHead) : '';
    if (recHeadStr && !myPlanHeads.map(String).includes(recHeadStr)) {
      return { ok: false, reason: `You are assigned to Plan Head ${myPlanHeads.join(', ')} only. This record belongs to Plan Head ${recHead}.` };
    }
  }
  if (myDepots.length) {
    const recDepot = record?.processing_depot || '';
    if (recDepot && !myDepots.includes(recDepot)) {
      return { ok: false, reason: `You are assigned to ${myDepots.join(', ')} depot only. This record belongs to ${recDepot}.` };
    }
  }
  return { ok: true };
}

function confirmIfDirty(hasDirtyFn, actionFn, label) {
  if (hasDirtyFn()) {
    if (!confirm(`⚠ Unsaved data will be lost.\n\nDiscard changes and refresh ${label || 'this section'}?`)) return;
  }
  actionFn();
}

// Same 13-step date-driven waterfall as v16 — auto-derives
// sanction_sub_item.status from the dates actually filled in.
// Fixed: process_tat.trigger_field / .status are free-text columns
// that were (re)entered manually post-recovery — a single stray
// space or a casing difference (e.g. 'De_Vetted_On' vs 'de_vetted_on')
// silently broke the exact-match property lookup below, with no
// error, no way to notice, just a status tier that quietly never
// fires. All comparisons in this function are now trim + case-
// insensitive instead of assuming clean data.
function pdNorm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

function siCalcStatus(subItem, procDetail, billDetail) {
  // Terminal stages always override everything else
  const ps = pdNorm(procDetail?.process_stage);
  if (ps === pdNorm('Dropped')) return 'Dropped';
  if (ps === pdNorm('On Hold')) return 'On Hold';

  // Fixed: 'Work Completed' and 'Process Over' are the other two
  // reference:'today()' manual-action stages in process_tat (same
  // family as On Hold/Dropped above — a genuine action, not something
  // derivable from an existing date). They were never special-cased,
  // so picking either one silently never advanced status. Resolved
  // dynamically from the live TAT cache rather than hardcoded, so this
  // stays correct if process_tat's exact status text ever changes.
  // Deliberately does NOT extend to ordinary 'log()'/'column:X' stages
  // (e.g. Spec Finalization, Vendor/Bill details review) — those are
  // same-tier working notes and are correctly status-invariant; only
  // the reference:'today()' action stages get this treatment.
  if (ps === pdNorm('Work Completed') || ps === pdNorm('Process Over')) {
    const tatNow = _processTatCache || [];
    // Prefer the canonical self-referential row (status text === stage
    // text, e.g. status='Work Completed' & stage='Work Completed');
    // fall back to any row with a matching stage (covers 'Process Over',
    // which has no self-referential row — its status is 'Bill Passed').
    const selfRef = tatNow.find(t => pdNorm(t.process_stage) === ps && pdNorm(t.status) === ps);
    const anyMatch = selfRef || tatNow.find(t => pdNorm(t.process_stage) === ps);
    if (anyMatch) return anyMatch.status;
  }

  // TAT-driven: derive status from _processTatCache at runtime.
  // Change the process_tat table → status logic changes automatically.
  const tat = _processTatCache || [];
  if (tat.length) {
    // Flatten every known date field into one normalized-key lookup
    // table, so trigger_field values from process_tat resolve
    // correctly even if their casing/spacing doesn't exactly match
    // the JS property names used elsewhere in this file.
    const flat = {};
    [procDetail, billDetail, subItem].forEach(obj => {
      Object.entries(obj || {}).forEach(([k, v]) => { flat[pdNorm(k)] = v; });
    });
    const fieldVal = f => flat[pdNorm(f)] || '';

    // For each unique status (lowest priority row = the row whose trigger_field
    // unlocks that status), collect statuses whose trigger is filled.
    // The candidate with the lowest priority number = the most advanced milestone.
    const terminals = new Set(['on hold', 'dropped']);
    const candidates = [];
    const seenStatus = new Set();

    // TAT is already ordered by priority.asc from pdGetTat()
    for (const row of tat) {
      const s = row.status;
      const sKey = pdNorm(s);
      if (!s || terminals.has(sKey) || seenStatus.has(sKey)) continue;
      seenStatus.add(sKey);
      if (fieldVal(row.trigger_field)) {
        candidates.push({ status: s, priority: parseInt(row.priority, 10) });
      }
    }

    if (candidates.length) {
      // Lowest priority number = most advanced status reached
      candidates.sort((a, b) => a.priority - b.priority);
      return candidates[0].status;
    }
    return 'Sanctioned';
  }

  // Fallback if TAT cache not yet loaded
  const co7 = billDetail?.co7_date         || '';
  const co6 = billDetail?.co6_date         || '';
  const crn = procDetail?.crn_date         || '';
  const del = procDetail?.delivery_date    || '';
  const loa = procDetail?.loa_po_date      || '';
  const tco = procDetail?.tender_opened_on || '';
  const tca = procDetail?.tender_called_on || '';
  const ind = procDetail?.indent_date      || '';
  const dve = procDetail?.de_vetted_on     || subItem?.de_vetted_on   || '';
  const dsu = procDetail?.de_submit_date   || subItem?.de_submit_date || '';
  const san = subItem?.sanctioned_on       || '';
  if (co7) return 'Bill Passed';
  if (co6) return 'Bill Submitted';
  if (crn) return 'CRN Generated';
  if (del) return 'Item Delivered';
  if (loa) return 'PO/LOA Issued';
  if (tco) return 'Under TC';
  if (tca) return 'Tender Called';
  if (ind) return 'Indent Submitted';
  if (dve) return 'DE Vetted';
  if (dsu) return 'DE Submitted';
  if (san) return 'Sanctioned';
  return 'Sanctioned';
}

/* ================================================================
   TAT (turnaround time) calculations — process_tat table, cached
   after first fetch.
   ================================================================ */
let _processTatCache = null;

async function pdGetTat() {
  if (_processTatCache) return _processTatCache;
  try {
    const rows = await nxFetch('process_tat?select=*&order=priority.asc');
    _processTatCache = rows || [];
  } catch (e) {
    console.warn('[DRGSBC] process_tat fetch failed:', e.message);
    _processTatCache = [];
  }
  return _processTatCache;
}

function pdDateClass(dateStr) {
  if (!dateStr) return '';
  const today = new Date().toISOString().split('T')[0];
  if (dateStr < today) return 'date-overdue';
  if (dateStr === today) return 'date-today';
  return '';
}

function addDays(dateStr, days) {
  if (!dateStr || !days) return dateStr || '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function pdRecalcLatestCost(sid, row) {
  if (!row) return;
  const idx = PD.allRows.findIndex(r => String(r.sub_item_id) === String(sid));
  if (idx >= 0) PD.allRows[idx].latest_cost = parseFloat(row.vetted_cost) || 0;
}

// Shared schedule computation — given a resolved TAT row (the row that
// defines the CURRENT stage's own trigger/tat_days/pending_with), works
// out pending_with, process_pdc, and next_process_due_on. Used both by
// the live dropdown-change preview (pdRecalcFromTat) and by pdSaveAll()'s
// forced recompute after Resume/On Hold/Dropped resolve to a real stage —
// one formula, so the two can never drift apart.
function pdComputeSchedule(tat, stageRow, row) {
  const todayStr = new Date().toISOString().split('T')[0];
  const fieldName   = stageRow.trigger_field;
  const isLog       = (stageRow.reference === 'log()' || stageRow.reference === 'today()');
  const baseDate    = isLog ? todayStr : (row[fieldName] || todayStr);
  const curSeq      = parseInt(stageRow.priority, 10);
  const pendingWith = stageRow.pending_with || '—';

  let totalTat = 0;
  tat.filter(t => parseInt(t.priority, 10) >= curSeq && parseInt(t.priority, 10) <= 20)
     .forEach(t => totalTat += (parseFloat(t.tat_days) || 0));
  const processPdc = baseDate ? addDays(baseDate, totalTat) : '';

  const nextRow = tat.find(t => parseInt(t.priority, 10) === curSeq + 1);
  let nextDueOn = '';
  if (nextRow) {
    const nextIsLog    = (nextRow.reference === 'log()' || nextRow.reference === 'today()');
    const nextBaseDate = nextIsLog ? todayStr : (row[nextRow.trigger_field] || baseDate);
    nextDueOn = nextBaseDate ? addDays(nextBaseDate, parseFloat(nextRow.tat_days) || 0) : '';
  }
  return { pendingWith, processPdc, nextDueOn };
}

async function pdRecalcFromTat(sid, stageName) {
  const tat = await pdGetTat();
  if (!tat.length) return;

  const row = PD.allRows.find(r => String(r.sub_item_id) === String(sid));
  if (!row) return;
  const currentStatus = row.status || '';

  // Correct TAT lookup: match by process_stage AND current status.
  // Old code used t.status === stageName which was wrong — stageName is a
  // process_stage value. On Hold/Dropped/Resume appear under multiple status
  // groups so we scope to the sub-item's current status.
  // Fixed: normalized (trim + case-insensitive) — see pdNorm() note.
  const stageRow = tat.find(t => pdNorm(t.process_stage) === pdNorm(stageName) && pdNorm(t.status) === pdNorm(currentStatus));
  if (!stageRow) return;

  // On Hold / Dropped: rebuild the Stage dropdown immediately so Resume
  // appears without waiting for a save round-trip.
  // Fixed: this used to also set PD.allRows[idx].status = stageName
  // right here, as a live-preview convenience. That was the actual bug
  // behind "status doesn't persist to On Hold/Dropped" — it silently
  // mutated row.status to the picked value BEFORE Save was ever clicked.
  // By the time pdSaveAll() ran its newStatus !== row.status check, the
  // in-memory row.status already (incorrectly) matched the picked value,
  // so the check evaluated false and the real PATCH to sanction_sub_item
  // was skipped entirely — leaving the database untouched while the UI
  // looked correct, until a reload revealed the real (unwritten) DB
  // value. row.status must stay at its last DB-CONFIRMED value until
  // pdSaveAll() actually writes the new one — the dropdown rebuild below
  // doesn't need the mutation anyway, since it already uses stageName
  // directly for both the options list and the selected value.
  if (pdNorm(stageName) === 'on hold' || pdNorm(stageName) === 'dropped') {
    const rowElT = document.querySelector(`[data-sid="${sid}"]`);
    if (rowElT) {
      rowElT.querySelectorAll('select[data-field="process_stage"]').forEach(sel => {
        sel.innerHTML = pdBuildStageOptions(stageName, stageName);
      });
    }
    showToast(`⚠ STATUS → ${stageName.toUpperCase()} WILL BE APPLIED ON SAVE`);
    // Fall through: TAT row gives pending_with = HQ-SWR
  }

  // Resume: never a real destination state — its own TAT row's
  // trigger_field/tat_days/pending_with describe the "resume" action
  // itself, not the schedule of whatever status the item resumes into.
  // Fixed: this used to fall through into the schedule computation
  // below using literal Resume-row data anyway, silently writing wrong
  // pending_with/process_pdc/next_process_due_on on save (status and
  // process_stage were already being correctly recomputed fresh by
  // pdSaveAll — these three were the ones left stale). Stop here;
  // pdSaveAll() computes the real schedule once it knows the true
  // resolved stage, after Save is clicked.
  if (pdNorm(stageName) === 'resume') {
    showToast('RESUMING — STATUS, STAGE & SCHEDULE WILL BE RECALCULATED FRESH ON SAVE');
    return;
  }

  const { pendingWith, processPdc, nextDueOn } = pdComputeSchedule(tat, stageRow, row);

  // Update DOM spans immediately (live display before save)
  const rowEl = document.querySelector(`[data-sid="${sid}"]`);
  if (rowEl) {
    const pwEl  = rowEl.querySelector('.ms-pw-calc');
    const pdcEl = rowEl.querySelector('.ms-pdc-calc');
    const ndoEl = rowEl.querySelector('.ms-ndo-calc');
    if (pwEl)  pwEl.textContent  = pendingWith;
    if (pdcEl) pdcEl.textContent = processPdc;
    if (ndoEl) ndoEl.textContent = nextDueOn;
  }

  if (pendingWith) pdMarkDirty('proc', sid, 'pending_with',        pendingWith);
  if (processPdc)  pdMarkDirty('proc', sid, 'process_pdc',         processPdc);
  if (nextDueOn)   pdMarkDirty('proc', sid, 'next_process_due_on', nextDueOn);

  pdRecalcLatestCost(sid, row);
}

function pdBuildStageOptions(currentStatus, selectedStage) {
  const tat = _processTatCache || [];
  const universal = ['On Hold', 'Dropped', 'Work Completed', 'Process Over'];
  const statusMap = { 'Indent Under Prep': 'Sanctioned' };
  const lookupStatus = statusMap[currentStatus] || currentStatus;
  // Fixed: normalized comparisons — see pdNorm() note above siCalcStatus.
  // A currentStatus value that's semantically 'On Hold' but stored with
  // different casing/whitespace previously failed both this filter AND
  // the isTerminal check below, silently falling through to the wrong
  // (non-terminal) option set — e.g. showing Work Completed/Process
  // Over instead of Resume while genuinely on hold.
  const statusStages = tat
    .filter(t => pdNorm(t.status) === pdNorm(lookupStatus))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))
    .map(t => t.process_stage)
    .filter(Boolean);
  const isTerminal = (pdNorm(currentStatus) === 'dropped' || pdNorm(currentStatus) === 'on hold');
  // Terminal statuses use only their own TAT rows:
  //   On Hold  → Resume, On Hold, Dropped  (TAT priorities 76-78)
  //   Dropped  → Resume, Dropped           (TAT priorities 79-80)
  const allStages = isTerminal
    ? [...new Set([...statusStages])]
    : [...new Set([...statusStages, ...universal])];
  if (selectedStage && !allStages.includes(selectedStage)) allStages.unshift(selectedStage);
  return [
    `<option value="">— Stage —</option>`,
    ...allStages.map(s => `<option value="${s}" ${selectedStage === s ? 'selected' : ''}>${s}</option>`)
  ].join('');
}

function setFieldState(el, state) {
  if (!el) return;
  el.classList.remove('field-dirty', 'field-success', 'field-error');
  if (state === 'dirty')   el.classList.add('field-dirty');
  if (state === 'success') { el.classList.add('field-success'); setTimeout(() => el.classList.remove('field-success'), 5000); }
  if (state === 'error')   el.classList.add('field-error');
}

/* ================================================================
   PROCESS TAB
   ================================================================
   Only the SUMMARY sub-tab is built so far. PROCUREMENT (the
   editable grid) and BILLING (nested bill records) are the next two
   slices — pdSwitchSubTab() below already routes to placeholders for
   them so the tab strip is forward-compatible.

   Ported from v16's pd* functions (Section: Process Detail / Summary).
   DB.nxFetch → nxFetch, currentUserRole/window.currentUserProfile →
   getActiveSession(). NO DEMO DATA — if Nexus isn't configured, fetch
   just returns zero rows rather than synthetic data.
   ================================================================ */
const ROLES_SEE_ALL = new Set(['admin', 'master']);

const PD = {
  allRows: [],
  filteredRows: [],
  activeSubTab: 'summary_sub',
  existProc: {}, // sub_item_id -> existing process_detail row (or null), populated by pdFetchData
  existBill: {}, // sub_item_id -> array of existing bill_detail rows, populated by pdFetchData
  dirtyProc: {}, // sub_item_id -> { field: value } of unsaved Procurement edits
  dirtyBill: {}, // sub_item_id -> { field: value } of unsaved Billing edits
  sharedScrollTop: 0, // vertical scroll position, carried over between Procurement <-> Billing
  sortField: null, // Procurement grid column sort — e.g. 'indent_number', 'loa_po_number'
  sortAsc: true,
};

const PD_FILTER_MAP = {
  pd_f_planhead:   r => r.plan_head,
  pd_f_depot:      r => r.processing_depot,
  pd_f_underpower: r => r.under_power,
  pd_f_lineitem:   r => r.item_name,
  pd_f_stage:      r => r.process_stage,
  pd_f_pending:    r => r.pending_with,
};

function pdOnTabOpen() {
  pdLoadFilterDropdowns();
  pdApplyColumnVisibility();
  pdApplyUserScope();
  // Fixed: _processTatCache was only ever getting populated as a side
  // effect of manually changing the Process Stage dropdown
  // (pdRecalcFromTat -> pdGetTat). If a user only ever edited dates
  // and never touched that dropdown directly, the cache stayed null
  // for the whole session — which meant siCalcStatus() silently fell
  // back to its non-TAT waterfall, AND pdSaveAll()'s auto-pick-stage
  // block (`tat.filter(t => t.status === newStatus)...`) always saw an
  // empty array and skipped entirely, so status updated on save but
  // process_stage never followed it. Warm the cache eagerly here so
  // both are correct regardless of which fields the user actually
  // touches.
  pdGetTat();
}

// Restrict & auto-set Plan Head / Processing Depot filters based on
// the logged-in user's assigned plan heads / depots.
function pdApplyUserScope() {
  const session = getActiveSession();
  const role    = session?.role || '';
  const phSel    = document.getElementById('pd_f_planhead');
  const depSel   = document.getElementById('pd_f_depot');
  const depGroup = depSel ? depSel.closest('.form-group') : null;

  if (role === 'field-agent' && depGroup) depGroup.style.display = 'none';
  else if (depGroup) depGroup.style.display = '';

  if (ROLES_SEE_ALL.has(role)) return;

  const profile = session?.profile || {};
  const myPlanHeads = parseMultiVal(profile.planHeads);
  const myDepots    = parseMultiVal(profile.depots);

  if (myPlanHeads.length && phSel) {
    Array.from(phSel.options).forEach(o => {
      if (o.value !== 'ALL') o.style.display = myPlanHeads.includes(o.value) ? '' : 'none';
    });
    if (myPlanHeads.length === 1) phSel.value = myPlanHeads[0];
  }

  if (myDepots.length && depSel) {
    if (role === 'field-agent') {
      depSel.value = 'ALL'; // hidden — the depot OR-scope in pdApplyFilters already restricts rows
    } else {
      Array.from(depSel.options).forEach(o => {
        if (o.value !== 'ALL') o.style.display = myDepots.includes(o.value) ? '' : 'none';
      });
      if (myDepots.length === 1) depSel.value = myDepots[0];
    }
  }
}

async function pdLoadFilterDropdowns() {
  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      const ups = await nxFetch('sanction_header?select=under_power');
      const upUniq = [...new Set(ups.map(r => r.under_power).filter(Boolean))].sort();
      const upSel = document.getElementById('pd_f_underpower');
      while (upSel.options.length > 1) upSel.remove(1);
      upUniq.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; upSel.appendChild(o); });

      const pws = await nxFetch('process_detail?select=pending_with');
      const pwUniq = [...new Set(pws.map(r => r.pending_with).filter(v => v && v.trim()))].sort();
      const pwSel = document.getElementById('pd_f_pending');
      while (pwSel.options.length > 1) pwSel.remove(1);
      pwUniq.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; pwSel.appendChild(o); });
    }
  } catch (e) { console.warn('PD dropdown load:', e.message); }
}

async function pdSubItemSearch(inputVal) {
  const q = (inputVal !== undefined ? inputVal : document.getElementById('pd_f_subitem').value).trim();
  const dl = document.getElementById('pd_subitem_dl');
  dl.innerHTML = '';
  if (q.length < 3) return;
  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      const role = getActiveSession()?.role || '';
      const stateQ = ROLES_SEE_ALL.has(role) ? '' : '&state=neq.Inactive';
      const rows = await nxFetch(`sanction_sub_item?select=sub_item_id,sub_item_name&sub_item_name=ilike.*${encodeURIComponent(q)}*${stateQ}&limit=20`);
      rows.forEach(r => {
        const o = document.createElement('option');
        o.value = r.sub_item_name;
        o.dataset.id = r.sub_item_id;
        dl.appendChild(o);
      });
    }
  } catch (e) {}
}

async function pdSubItemAutoFill(inputVal) {
  const name = (inputVal !== undefined ? inputVal : document.getElementById('pd_f_subitem').value).trim();
  if (!name) return;
  try {
    const cfg = getDbConfig();
    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      const rows = await nxFetch(
        `sanction_sub_item?select=sub_item_id,sub_item_name,processing_depot,` +
        `sanction_line_item!inner(item_name,sanction_header!inner(under_power,plan_head,original_sanction_name))` +
        `&sub_item_name=eq.${encodeURIComponent(name)}&limit=1`
      );
      if (rows.length) {
        const r = rows[0];
        const h = r.sanction_line_item?.sanction_header || {};
        if (h.plan_head)        document.getElementById('pd_f_planhead').value   = h.plan_head;
        if (r.processing_depot) document.getElementById('pd_f_depot').value      = r.processing_depot;
        if (h.under_power)      document.getElementById('pd_f_underpower').value = h.under_power;
        if (r.sanction_line_item?.item_name) document.getElementById('pd_f_lineitem').value = r.sanction_line_item.item_name;
      }
    }
  } catch (e) {}
}

// Reads a row's current display value for a field, preferring any
// unsaved edit staged in PD.dirtyProc over the last-saved DB value —
// so sorting reflects what's actually on screen, not stale data.
function pdLiveVal(row, field) {
  const dirty = PD.dirtyProc[row.sub_item_id];
  if (dirty && dirty[field] !== undefined && dirty[field] !== null) return dirty[field];
  return row[field] || '';
}

// Sorts PD.filteredRows in place per the currently active PD.sortField/
// sortAsc, without toggling or re-rendering — used both when a header
// is clicked and to re-apply an already-active sort after the filter
// set changes (FETCH SUB-ITEMS / filter dropdowns), so sort order
// persists the way most people expect a spreadsheet-style sort to.
function pdApplySortToFilteredRows() {
  if (!PD.sortField) return;
  const field = PD.sortField;
  PD.filteredRows.sort((a, b) => {
    const av = String(pdLiveVal(a, field)).trim();
    const bv = String(pdLiveVal(b, field)).trim();
    // Blanks always sink to the bottom regardless of direction, so an
    // empty Indent/LOA-PO column doesn't dominate the top of the list.
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    return PD.sortAsc ? cmp : -cmp;
  });
}

// Click handler for sortable Procurement grid headers (Indent/Demand No,
// LOA/PO No — brought back after being lost in the recovery; wired
// generically so any other <th data-sort-field="..."> can opt in the
// same way). Clicking the same column again flips direction; clicking a
// different column starts fresh at ascending.
function pdSortProcBy(field) {
  if (PD.sortField === field) PD.sortAsc = !PD.sortAsc;
  else { PD.sortField = field; PD.sortAsc = true; }
  pdApplySortToFilteredRows();
  pdRenderProcTable();
  document.querySelectorAll('.pd-sort-arrow').forEach(el => {
    el.textContent = (PD.sortField === el.dataset.sortArrow) ? (PD.sortAsc ? ' ▲' : ' ▼') : '';
  });
}
document.querySelectorAll('#pd_proc_table th[data-sort-field]').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => pdSortProcBy(th.dataset.sortField));
});

function pdApplyFilters() {
  const ph  = document.getElementById('pd_f_planhead').value;
  const dep = document.getElementById('pd_f_depot').value;
  const up  = document.getElementById('pd_f_underpower').value;
  const li  = document.getElementById('pd_f_lineitem').value;
  const si  = document.getElementById('pd_f_subitem').value.trim().toLowerCase();
  const stg = document.getElementById('pd_f_stage').value;
  const pw  = document.getElementById('pd_f_pending').value;

  const session  = getActiveSession();
  const role     = session?.role || '';
  const profile  = session?.profile || {};
  const myDepots = ROLES_SEE_ALL.has(role) ? [] : parseMultiVal(profile.depots);

  PD.filteredRows = PD.allRows.filter(r => {
    if (myDepots.length) {
      const depotMatch = myDepots.includes(r.processing_depot) || myDepots.includes(r.consignee_depot);
      if (!depotMatch) return false;
    }
    if (ph  !== 'ALL' && String(r.plan_head) !== String(ph))  return false;
    if (dep !== 'ALL' && r.processing_depot  !== dep) return false;
    if (up  !== 'ALL' && r.under_power       !== up)  return false;
    if (li  !== 'ALL' && r.item_name         !== li)  return false;
    if (si  && !r.sub_item_name?.toLowerCase().includes(si)) return false;
    if (stg !== 'ALL' && r.process_stage     !== stg) return false;
    if (pw  !== 'ALL' && r.pending_with      !== pw)  return false;
    return true;
  });
  pdApplySortToFilteredRows(); // re-apply an already-active sort after the filter set changes

  document.getElementById('pd_row_count').textContent = PD.filteredRows.length;
  if (PD.activeSubTab === 'summary_sub') { pdRenderSummary(); pdRenderSummaryExtras(); }
  if (PD.activeSubTab === 'procurement') { pdRenderProcTable(); }
  if (PD.activeSubTab === 'billing')     { pdRenderBillTable(); pdInitBillingButtonStates(); }
}

function pdCascadeFilters() {
  if (!PD.allRows.length) { pdApplyFilters(); return; }

  const session  = getActiveSession();
  const role     = session?.role || '';
  const profile  = session?.profile || {};
  const myDepots = ROLES_SEE_ALL.has(role) ? [] : parseMultiVal(profile.depots);

  const selections = {};
  Object.keys(PD_FILTER_MAP).forEach(id => {
    const el = document.getElementById(id);
    selections[id] = el ? el.value : 'ALL';
  });

  const scopedRows = myDepots.length
    ? PD.allRows.filter(r => myDepots.includes(r.processing_depot) || myDepots.includes(r.consignee_depot))
    : PD.allRows;

  Object.keys(PD_FILTER_MAP).forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const getVal = PD_FILTER_MAP[id];
    const subset = scopedRows.filter(r => Object.keys(selections).every(otherId => {
      if (otherId === id) return true;
      const otherVal = selections[otherId];
      if (otherVal === 'ALL' || !otherVal) return true;
      return PD_FILTER_MAP[otherId](r) === otherVal;
    }));
    const unique = [...new Set(subset.map(getVal).filter(v => v && String(v).trim()))].sort();
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    unique.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'ALL';
  });

  pdApplyFilters();
}

async function pdFetchData() {
  const fetchBtn = document.getElementById('pd_fetch_btn');
  const statusEl = document.getElementById('pd_fetch_status');
  const lbar     = document.getElementById('pd_lbar');
  statusEl.textContent = '⏳ Fetching...';
  lbar.classList.add('show');
  fetchBtn.disabled = true;

  try {
    const cfg = getDbConfig();
    let rawSubItems = [];

    if (cfg?.nexus?.url && cfg?.nexus?.key) {
      const role = getActiveSession()?.role || '';
      // Matches the actual schema: sanction_sub_item -> sanction_line_item ->
      // sanction_header, plus process_detail (1:1) and bill_detail (1:many).
      let url = 'sanction_sub_item?select=' +
        // Fixed: de_submit_date/de_vetted_on were never selected here,
        // so pdSaveAll()'s status/stage recalculation always read them
        // as undefined off PD.allRows — any process_tat tier keyed to
        // either trigger field could never be detected as reached.
        'sub_item_id,sub_item_name,consignee_depot,processing_depot,qty,unit_price,vetted_cost,total_value,status,under_power,state,remarks,latest_grant,de_submit_date,de_vetted_on,' +
        'sanction_line_item!inner(' +
          'line_item_id,item_name,item_description,unit,department,' +
          'sanction_header!inner(sanction_id,under_power,plan_head,allocation_type,sanction_year,sanctioned_on)' +
        '),' +
        'process_detail(process_id,process_stage,process_pdc,next_process_due_on,pending_with,owner_sse,vendor_name,' +
          'indent_number,indent_date,tender_called_on,tender_opened_on,loa_po_number,loa_po_date,' +
          'delivery_due_on,delivery_date,crn_number,crn_date,' +
          'commissioning_date,ptc_date,total_bills,remarks),' +
        'bill_detail(bill_id,bill_number,bill_date,bill_amount,bill_description,' +
          'co6_number,co6_date,co7_number,co7_date,payment_date)';

      if (!ROLES_SEE_ALL.has(role)) url += '&state=neq.Inactive';
      const ph = document.getElementById('pd_f_planhead').value;
      if (ph !== 'ALL') url += `&sanction_line_item.sanction_header.plan_head=eq.${ph}`;
      url += '&order=sub_item_name.asc';

      const PAGE_SIZE = 1000;
      let offset = 0, batch;
      do {
        batch = await nxFetch(`${url}&offset=${offset}&limit=${PAGE_SIZE}`);
        if (!Array.isArray(batch)) { console.warn('[PD] Unexpected batch response:', batch); batch = []; }
        rawSubItems = rawSubItems.concat(batch);
        offset += PAGE_SIZE;
      } while (batch.length === PAGE_SIZE);
    }
    // NO DEMO DATA FALLBACK — if Nexus isn't configured/reachable,
    // rawSubItems just stays empty. Never synthetic data.

    PD.allRows = rawSubItems.map(r => {
      const li = r.sanction_line_item || {};
      const h  = li.sanction_header || {};
      const pdRaw = r.process_detail;
      const p  = Array.isArray(pdRaw) ? (pdRaw[0] || {}) : (pdRaw || {});
      const bdArr = Array.isArray(r.bill_detail) ? r.bill_detail : (r.bill_detail ? [r.bill_detail] : []);
      const bd = bdArr.length ? bdArr[bdArr.length - 1] : {};
      // Store existing process_detail/bill_detail so pdSaveAll/pdSaveNewBill
      // know whether to PATCH an existing row or POST a new one.
      PD.existProc[r.sub_item_id] = p.process_id ? p : null;
      PD.existBill[r.sub_item_id] = bdArr;
      return {
        sub_item_id:      r.sub_item_id,
        sub_item_name:    r.sub_item_name,
        item_description: li.item_description || '',
        item_name:        li.item_name || '',
        under_power:      r.under_power || h.under_power || '',
        plan_head:        h.plan_head ?? null,
        department:       li.department || 'Mechanical',
        consignee_depot:  r.consignee_depot || '',
        processing_depot: r.processing_depot || '',
        allocation:       h.allocation_type || '',
        sanction_year:    h.sanction_year   || '',
        qty:              r.qty,
        unit:             li.unit,
        unit_price:       r.unit_price || 0,
        total_value:      r.total_value,
        vetted_cost:      r.vetted_cost || 0,
        latest_grant:     r.latest_grant || 0,
        status:           r.status || '',
        sub_item_state:   r.state || '',
        latest_cost:      r.vetted_cost || 0,
        // Fixed: mapped from the newly-selected sanction_sub_item
        // columns above — see the note there.
        de_submit_date:   r.de_submit_date || '',
        de_vetted_on:     r.de_vetted_on   || '',
        process_stage:    p.process_stage || '',
        next_process_due_on: p.next_process_due_on || '',
        remarks:          p.remarks || r.remarks || '',
        pending_with:     p.pending_with || '',
        process_id:           p.process_id || null,
        sanctioned_on:        h.sanctioned_on || '',
        indent_number:        p.indent_number || '',
        indent_date:           p.indent_date || '',
        tender_called_on:     p.tender_called_on || '',
        tender_opened_on:     p.tender_opened_on || '',
        loa_po_number:        p.loa_po_number || '',
        loa_po_date:           p.loa_po_date || '',
        delivery_due_on:      p.delivery_due_on || '',
        delivery_date:         p.delivery_date || '',
        crn_number:           p.crn_number || '',
        crn_date:               p.crn_date || '',
        commissioning_date:   p.commissioning_date || '',
        ptc_date:               p.ptc_date || '',
        total_bills:          p.total_bills || 0,
        process_pdc:          p.process_pdc || '',
        owner_sse:            p.owner_sse || '',
        vendor_name:          p.vendor_name || '',
        bill_id:          bd.bill_id || null,
        bill_number:      bd.bill_number || '',
        bill_date:        bd.bill_date || '',
        bill_amount:      bd.bill_amount || '',
        bill_description: bd.bill_description || '',
        co6_number:       bd.co6_number || '',
        co6_date:         bd.co6_date || '',
        co7_number:       bd.co7_number || '',
        co7_date:         bd.co7_date || '',
        payment_date:     bd.payment_date || '',
      };
    });

    pdCascadeFilters();
    document.getElementById('pd_bottom_section').style.display = '';
    statusEl.textContent = (!cfg?.nexus?.url || !cfg?.nexus?.key)
      ? '⚠ No database configured — set up Nexus in Settings → Database.'
      : '✓ ' + PD.allRows.length + ' sub-items loaded';
  } catch (e) {
    statusEl.textContent = '✕ ' + e.message.slice(0, 50);
    showToast('FETCH ERROR: ' + e.message.slice(0, 40), 'error');
  }

  lbar.classList.remove('show');
  fetchBtn.disabled = false;
}

function pdResetFiltersConfirm() {
  confirmIfDirty(pdHasUnsavedChanges, pdResetFilters, 'Process Detail');
}

function pdResetFilters() {
  ['pd_f_planhead', 'pd_f_depot', 'pd_f_underpower', 'pd_f_lineitem', 'pd_f_stage', 'pd_f_pending']
    .forEach(id => { document.getElementById(id).value = 'ALL'; });
  document.getElementById('pd_f_subitem').value = '';
  document.getElementById('pd_fetch_status').textContent = '';
  document.getElementById('pd_bottom_section').style.display = 'none';
  PD.allRows = []; PD.filteredRows = []; PD.dirtyProc = {}; PD.dirtyBill = {}; PD.sharedScrollTop = 0;
  document.getElementById('pd_dirty_badge').style.display = 'none';
  document.getElementById('pd_discard_btn').style.display = 'none';
  document.getElementById('pd_save_all_btn2').style.display = 'none';
}

function pdSwitchSubTab(tab) {
  // Remember the outgoing tab's scroll position so Procurement <-> Billing
  // feel like one continuous view even though they're still two separate
  // tables under the hood — switching tabs shouldn't dump you back at
  // the top of the list.
  const outgoingId = { procurement: 'pd_tab_procurement', billing: 'pd_tab_billing' }[PD.activeSubTab];
  if (outgoingId) {
    const outgoingEl = document.getElementById(outgoingId);
    if (outgoingEl) PD.sharedScrollTop = outgoingEl.scrollTop;
  }

  PD.activeSubTab = tab;
  document.querySelectorAll('#pd_stab_summ,#pd_stab_proc,#pd_stab_bill').forEach(b => b.classList.remove('active'));
  document.getElementById('pd_stab_' + { summary_sub: 'summ', procurement: 'proc', billing: 'bill' }[tab]).classList.add('active');

  document.getElementById('pd_tab_summary_sub').style.display = tab === 'summary_sub' ? '' : 'none';
  document.getElementById('pd_tab_procurement').style.display = tab === 'procurement' ? '' : 'none';
  document.getElementById('pd_tab_billing').style.display     = tab === 'billing'     ? '' : 'none';

  // Summary is read-only — GET PDF instead of Discard/Save. Column
  // Settings applies to both Procurement and Billing (they share the
  // same mandatory + toggleable + frozen column set).
  const isSummary = tab === 'summary_sub';
  document.getElementById('pd_get_pdf_btn').style.display      = isSummary ? '' : 'none';
  document.getElementById('pd_discard_btn').style.display      = isSummary ? 'none' : '';
  document.getElementById('pd_save_all_btn2').style.display    = isSummary ? 'none' : '';
  document.getElementById('pd_col_settings_btn').style.display = isSummary ? 'none' : '';
  if (isSummary) document.getElementById('pd_col_panel').style.display = 'none';

  if (tab === 'summary_sub')  { pdRenderSummary(); pdRenderSummaryExtras(); }
  if (tab === 'procurement')  { pdRenderProcTable(); }
  if (tab === 'billing')      { pdRenderBillTable(); pdInitBillingButtonStates(); }

  // Restore the shared scroll position onto whichever table just
  // became visible. Runs after render so there's actually content
  // tall enough to scroll to.
  const incomingId = { procurement: 'pd_tab_procurement', billing: 'pd_tab_billing' }[tab];
  if (incomingId && PD.sharedScrollTop) {
    const incomingEl = document.getElementById(incomingId);
    if (incomingEl) incomingEl.scrollTop = PD.sharedScrollTop;
  }
}

/* ================================================================
   DIRTY-STATE TRACKING + DATE VALIDATION
   ================================================================ */
function pdMarkDirty(table, subItemId, field, value, el) {
  const store = table === 'proc' ? PD.dirtyProc : PD.dirtyBill;
  if (!store[subItemId]) store[subItemId] = {};
  // Empty string saved as null so the DB clears the field.
  store[subItemId][field] = (value === '' || value === undefined) ? null : value;
  if (el) setFieldState(el, 'dirty');
  else {
    const found = document.querySelector(`[data-field='${field}'][data-sid='${subItemId}']`);
    if (found) setFieldState(found, 'dirty');
  }
  const hasDirty = Object.keys(PD.dirtyProc).length > 0 || Object.keys(PD.dirtyBill).length > 0;
  document.getElementById('pd_dirty_badge').style.display = hasDirty ? '' : 'none';
  document.getElementById('pd_discard_btn').style.display  = hasDirty ? '' : 'none';
  document.getElementById('pd_save_all_btn2').style.display = hasDirty ? '' : 'none';

  // Keep the LOA/PO doc-preview icon (Procurement grid only) in sync
  // whenever either of its two source fields changes — the icon's
  // link depends on BOTH loa_po_number and loa_po_date together.
  if (table === 'proc' && (field === 'loa_po_number' || field === 'loa_po_date')) {
    pdRefreshLoaPoIcon(subItemId);
  }
  // Same pattern for the Indent No. doc-preview icon — depends on
  // indent_number + indent_date together.
  if (table === 'proc' && (field === 'indent_number' || field === 'indent_date')) {
    pdRefreshIndentIcon(subItemId);
  }
}

function pdValidateDateSequence(row, dirtyProc, dirtyBill) {
  const p  = (field) => dirtyProc[field] !== undefined ? dirtyProc[field] : (row[field] || '');
  const b  = (field) => dirtyBill[field] !== undefined ? dirtyBill[field] : (row[field] || '');
  const li = (field) => row[field] || '';

  const chain = [
    { field: 'sanctioned_on',      label: 'Sanctioned On',     val: row.sanctioned_on || '', src: 'ro' },
    { field: 'de_submit_date',     label: 'DE Submit Date',    val: li('de_submit_date'),    src: 'li' },
    { field: 'de_vetted_on',       label: 'DE Vetted On',      val: li('de_vetted_on'),      src: 'li' },
    { field: 'indent_date',        label: 'Indent Date',       val: p('indent_date'),        src: 'p'  },
    { field: 'tender_called_on',   label: 'Tender Called On',  val: p('tender_called_on'),   src: 'p'  },
    { field: 'tender_opened_on',   label: 'Tender Opened On',  val: p('tender_opened_on'),   src: 'p'  },
    { field: 'loa_po_date',        label: 'LOA/PO Date',       val: p('loa_po_date'),        src: 'p'  },
    { field: 'delivery_date',      label: 'Delivery Date',     val: p('delivery_date'),      src: 'p'  },
    { field: 'commissioning_date', label: 'Commissioning Date',val: p('commissioning_date'), src: 'p'  },
    { field: 'ptc_date',           label: 'PTC Date',          val: p('ptc_date'),           src: 'p'  },
    { field: 'crn_date',           label: 'CRN Date',          val: p('crn_date'),           src: 'p'  },
    { field: 'co6_date',           label: 'CO6 Date',          val: b('co6_date'),           src: 'b'  },
    { field: 'co7_date',           label: 'CO7 Date',          val: b('co7_date'),           src: 'b'  },
  ];

  const errors = [];
  let lastFilled = null;
  const today = new Date().toISOString().split('T')[0];

  for (const item of chain) {
    if (!item.val) continue;
    if (item.src !== 'ro' && item.src !== 'li' && item.val > today) {
      errors.push(`${item.label} (${pdFmtDate(item.val)}) cannot be a future date`);
    }
    if (lastFilled && item.val < lastFilled.val) {
      errors.push(`${item.label} (${pdFmtDate(item.val)}) cannot be before ${lastFilled.label} (${pdFmtDate(lastFilled.val)})`);
    }
    lastFilled = item;
  }
  return errors;
}

function pdFmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (e) { return d; }
}

function pdCheckDateLive(subItemId, field, value, el) {
  if (!value || value === '') { pdMarkDirty('proc', subItemId, field, null, el); return; }

  if (!PD.dirtyProc[subItemId]) PD.dirtyProc[subItemId] = {};
  PD.dirtyProc[subItemId][field] = value;

  const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
  if (!row) { pdMarkDirty('proc', subItemId, field, value); return; }

  const dirtyProc = PD.dirtyProc[subItemId] || {};
  const dirtyBill = PD.dirtyBill[subItemId] || {};
  const errs = pdValidateDateSequence(row, dirtyProc, dirtyBill);

  if (errs.length) {
    delete PD.dirtyProc[subItemId][field];
    if (Object.keys(PD.dirtyProc[subItemId]).length === 0) delete PD.dirtyProc[subItemId];

    if (el) {
      const origBorder = el.style.borderColor;
      el.style.borderColor = 'var(--accent-red)';
      el.style.boxShadow = '0 0 0 2px rgba(255,59,59,0.3)';
      el.value = '';
      setTimeout(() => { el.style.borderColor = origBorder; el.style.boxShadow = ''; }, 2000);
    }
    if (field === 'loa_po_date') pdRefreshLoaPoIcon(subItemId);
    if (field === 'indent_date') pdRefreshIndentIcon(subItemId);
    showToast('⚠ ' + errs[0], 'error');
    return;
  }

  pdMarkDirty('proc', subItemId, field, value);
}

/* ================================================================
   LOA/PO DOC-PREVIEW ICON — Procurement grid only. Builds a link to
   the item's LOA/PO PDF on IREPS from two source fields (loa_po_number
   + loa_po_date) and keeps the icon in the LOA/PO NO cell in sync as
   either field changes, live, without needing a save.
   URL shape (5-part concatenation, exact spec):
     "https://www.ireps.gov.in/ireps/etender/pdfdocs/MMIS/PO/"
     + YYYY (year of LOA/PO Date)
     + "/15/"
     + first 14 non-blank characters of LOA/PO Number
     + ".pdf"
   Requires BOTH a number and a date to resolve — if either is
   missing, the icon stays greyed out rather than guessing a URL that
   would 404.
   ================================================================ */
function pdBuildLoaPoDocUrl(loaNumber, loaDate) {
  const cleanedNum = String(loaNumber || '').replace(/\s+/g, '');
  if (!cleanedNum) return null;
  const year = String(loaDate || '').slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;
  const numPart = cleanedNum.slice(0, 14);
  return `https://www.ireps.gov.in/ireps/etender/pdfdocs/MMIS/PO/${year}/15/${numPart}.pdf`;
}

// Effective value for a Procurement field: unsaved edit if present,
// else the last-fetched row value — same convention pdRenderProcTable
// itself uses (see its own local v() helper).
function pdGetEffectiveProcField(subItemId, field) {
  const dirty = PD.dirtyProc[subItemId] || {};
  if (Object.prototype.hasOwnProperty.call(dirty, field)) return dirty[field] || '';
  const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
  return row ? (row[field] || '') : '';
}

// Renders the anchor+icon markup for one row — used both at initial
// table render and (implicitly, via pdRefreshLoaPoIcon) kept current
// afterwards.
function pdRenderLoaPoIcon(subItemId, loaNumber, loaDate) {
  const url = pdBuildLoaPoDocUrl(loaNumber, loaDate);
  const cls = url ? 'pd-loapo-doc-icon pd-loapo-on' : 'pd-loapo-doc-icon pd-loapo-off';
  const hrefAttr = url ? ` href="${pdEscAttr(url)}" target="_blank" rel="noopener"` : '';
  const title = url
    ? 'Preview LOA/PO document'
    : (loaNumber ? 'Enter LOA/PO Date to generate preview link' : 'No LOA/PO number entered');
  const disabledAttrs = url ? '' : ' aria-disabled="true" onclick="return false;"';
  return `<a class="${cls}" data-sid="${subItemId}"${hrefAttr} title="${pdEscAttr(title)}"${disabledAttrs}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
  </a>`;
}

// Re-derives and swaps in a fresh icon for one row, in place, without
// touching the rest of that row's DOM (so mid-edit inputs elsewhere in
// the row are never disturbed).
function pdRefreshLoaPoIcon(subItemId) {
  const oldEl = document.querySelector(`.pd-loapo-doc-icon[data-sid="${subItemId}"]`);
  if (!oldEl) return; // row not currently rendered (filtered out / different tab)
  const num  = pdGetEffectiveProcField(subItemId, 'loa_po_number');
  const date = pdGetEffectiveProcField(subItemId, 'loa_po_date');
  const wrap = document.createElement('div');
  wrap.innerHTML = pdRenderLoaPoIcon(subItemId, num, date);
  oldEl.replaceWith(wrap.firstElementChild);
}

/* ================================================================
   INDENT NO. DOC-PREVIEW ICON — same pattern as the LOA/PO icon
   above, sourced from indent_number + indent_date instead.
   URL shape (5-part concatenation, exact spec):
     "https://www.ireps.gov.in/ireps/etender/pdfdocs/MMIS/RN/DMD/"
     + YYYY (year of Indent Date)
     + "/15/"
     + first 19 non-blank characters of Indent Number
     + ".pdf"
   ================================================================ */
function pdBuildIndentDocUrl(indentNumber, indentDate) {
  const cleanedNum = String(indentNumber || '').replace(/\s+/g, '');
  if (!cleanedNum) return null;
  const year = String(indentDate || '').slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;
  const numPart = cleanedNum.slice(0, 19);
  return `https://www.ireps.gov.in/ireps/etender/pdfdocs/MMIS/RN/DMD/${year}/15/${numPart}.pdf`;
}

function pdRenderIndentIcon(subItemId, indentNumber, indentDate) {
  const url = pdBuildIndentDocUrl(indentNumber, indentDate);
  const cls = url ? 'pd-loapo-doc-icon pd-loapo-on pd-indent-doc-icon' : 'pd-loapo-doc-icon pd-loapo-off pd-indent-doc-icon';
  const hrefAttr = url ? ` href="${pdEscAttr(url)}" target="_blank" rel="noopener"` : '';
  const title = url
    ? 'Preview Indent document'
    : (indentNumber ? 'Enter Indent Date to generate preview link' : 'No Indent number entered');
  const disabledAttrs = url ? '' : ' aria-disabled="true" onclick="return false;"';
  return `<a class="${cls}" data-sid="${subItemId}"${hrefAttr} title="${pdEscAttr(title)}"${disabledAttrs}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
  </a>`;
}

function pdRefreshIndentIcon(subItemId) {
  const oldEl = document.querySelector(`.pd-indent-doc-icon[data-sid="${subItemId}"]`);
  if (!oldEl) return;
  const num  = pdGetEffectiveProcField(subItemId, 'indent_number');
  const date = pdGetEffectiveProcField(subItemId, 'indent_date');
  const wrap = document.createElement('div');
  wrap.innerHTML = pdRenderIndentIcon(subItemId, num, date);
  oldEl.replaceWith(wrap.firstElementChild);
}

/* ================================================================
   BILL STATUS HELPERS
   ================================================================ */
// A bill is "rejected" if explicitly marked so (permanent state).
function pdIsBillRejected(b) { return b.bill_status === 'Rejected'; }
// "Pending" if not rejected and CO7 number+date aren't both filled.
function pdIsBillPending(b) { return !pdIsBillRejected(b) && !(b.co7_number && String(b.co7_number).trim() && b.co7_date); }
// "Released" only once both CO7 number AND CO7 date are filled, and not rejected.
function pdIsBillReleased(b) { return !pdIsBillRejected(b) && !!(b.co7_number && String(b.co7_number).trim() && b.co7_date); }
// "Final" if released AND its description contains "final" (case-insensitive).
function pdIsBillFinal(b) { return pdIsBillReleased(b) && !!(b.bill_description && /final/i.test(b.bill_description)); }

function pdFormatDateDMY(isoDate) {
  if (!isoDate) return '—';
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

// Escape a string for safe embedding inside an HTML attribute.
function pdEscAttr(str) {
  return String(str ?? '')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Greys out empty date <input type="date"> fields so the browser's
// mm/dd/yyyy placeholder doesn't look like a real value.
function pdStyleDateInputs(container) {
  const root = container || document;
  root.querySelectorAll('input[type="date"]').forEach(inp => {
    if (inp.value) inp.classList.remove('pd-date-empty');
    else inp.classList.add('pd-date-empty');
  });
}
document.addEventListener('input', (e) => {
  if (e.target && e.target.type === 'date') {
    if (e.target.value) e.target.classList.remove('pd-date-empty'); else e.target.classList.add('pd-date-empty');
  }
});
document.addEventListener('change', (e) => {
  if (e.target && e.target.type === 'date') {
    if (e.target.value) e.target.classList.remove('pd-date-empty'); else e.target.classList.add('pd-date-empty');
  }
});

/* ================================================================
   PROCUREMENT — editable grid
   ================================================================ */
function pdRenderProcTable() {
  const tbody = document.getElementById('pd_proc_body');
  if (!PD.filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="24" style="text-align:center;padding:30px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">NO SUB-ITEMS MATCH FILTERS</td></tr>`;
    return;
  }
  tbody.innerHTML = PD.filteredRows.map((r, i) => {
    const dirty = PD.dirtyProc[r.sub_item_id] || {};
    const v  = (field) => dirty[field] !== undefined ? dirty[field] : (r[field] || '');
    const dc = (field) => dirty[field] !== undefined ? ' dirty' : '';
    const sid = r.sub_item_id;
    return `<tr data-sid="${sid}">
      <td class="pd-ro muted pd-frozen" data-col="slno">${i + 1}</td>
      <td class="pd-ro pd-frozen" style="font-weight:600;color:var(--text-primary);line-height:1.3;" data-col="subitem">
        ${r.sub_item_name || '—'}
        <div style="font-size:9px;color:var(--text-muted);font-family:'Share Tech Mono',monospace;">${r.sub_item_id || ''}</div>
      </td>
      <td class="pd-ro muted pd-frozen" data-col="qty">${r.qty || '—'}</td>
      <td class="pd-ro pd-frozen" style="color:var(--accent-gold);" data-col="latestcost">${r.latest_cost ? 'Rs.' + Number(r.latest_cost).toLocaleString('en-IN') : '—'}</td>
      <td class="pd-cell edit pd-col pd-frozen" data-col="remarks"><input class="pd-inp${dc('remarks')}" type="text" data-sid="${sid}" data-field="remarks" value="${v('remarks')}" placeholder="Add remarks..." title="${pdEscAttr(v('remarks'))}"></td>
      <td class="pd-cell edit pd-col pd-frozen" data-col="stage">
        <select class="pd-inp f-select" data-sid="${sid}" data-field="process_stage" style="font-size:10px;">
          ${pdBuildStageOptions(r.status, v('process_stage'))}
        </select>
      </td>
      <td class="pd-ro muted pd-col pd-frozen" data-col="unitprice">${r.unit_price ? 'Rs.' + Number(r.unit_price).toLocaleString('en-IN') : '—'}</td>
      <td class="pd-ro muted pd-col pd-frozen" data-col="depot">${r.consignee_depot || '—'}</td>
      <td class="pd-cell pd-col pd-frozen" data-col="nextdue" title="Auto-calculated: field date + next stage TAT"><span class="pd-ro ms-ndo-calc" style="color:var(--accent-green);font-family:'Share Tech Mono',monospace;font-size:9px;">${r.next_process_due_on || '—'}</span></td>
      <td class="pd-ro muted pd-col pd-frozen" data-col="ownersse">${r.owner_sse || '—'}</td>
      <td class="pd-cell pd-col pd-frozen" data-col="processpdc" title="Auto-calculated: field date + remaining TAT"><span class="pd-ro ms-pdc-calc ${pdDateClass(r.process_pdc)}" style="color:var(--accent-cyan);font-family:'Share Tech Mono',monospace;font-size:9px;">${r.process_pdc || '—'}</span></td>
      <td class="pd-cell" data-col="pendingwith"><span class="pd-ro ms-pw-calc" style="color:var(--accent-gold);font-family:'Share Tech Mono',monospace;font-size:9px;">${r.pending_with || '—'}</span></td>
      <td class="pd-cell edit pd-grp" data-grp="indent" data-col="indentno">
        <div class="pd-loapo-wrap">
          <input class="pd-inp${dc('indent_number')}" type="text" data-sid="${sid}" data-field="indent_number" value="${v('indent_number')}" placeholder="—">
          ${pdRenderIndentIcon(sid, v('indent_number'), v('indent_date'))}
        </div>
      </td>
      <td class="pd-cell edit pd-grp" data-grp="indent" data-col="indentdate"><input class="pd-inp${dc('indent_date')}" type="date" data-sid="${sid}" data-field="indent_date" value="${v('indent_date')}" data-min-date="${r.sanctioned_on || ''}" title="Cannot be before Sanctioned On date"></td>
      <td class="pd-cell edit pd-grp" data-grp="indent" data-col="tendercalledon"><input class="pd-inp${dc('tender_called_on')}" type="date" data-sid="${sid}" data-field="tender_called_on" value="${v('tender_called_on')}"></td>
      <td class="pd-cell edit pd-grp" data-grp="indent" data-col="tenderopenedon"><input class="pd-inp${dc('tender_opened_on')}" type="date" data-sid="${sid}" data-field="tender_opened_on" value="${v('tender_opened_on')}" title="Cannot be before Tender Called On"></td>
      <td class="pd-cell edit pd-grp" data-grp="loapo" data-col="vendorname"><input class="pd-inp${dc('vendor_name')}" type="text" data-sid="${sid}" data-field="vendor_name" value="${v('vendor_name')}" placeholder="—"></td>
      <td class="pd-cell edit pd-grp" data-grp="loapo" data-col="loaponumber">
        <div class="pd-loapo-wrap">
          <input class="pd-inp${dc('loa_po_number')}" type="text" data-sid="${sid}" data-field="loa_po_number" value="${v('loa_po_number')}" placeholder="—">
          ${pdRenderLoaPoIcon(sid, v('loa_po_number'), v('loa_po_date'))}
        </div>
      </td>
      <td class="pd-cell edit pd-grp" data-grp="loapo" data-col="loapodate"><input class="pd-inp${dc('loa_po_date')}" type="date" data-sid="${sid}" data-field="loa_po_date" value="${v('loa_po_date')}" title="Cannot be before Indent Date"></td>
      <td class="pd-cell edit pd-grp" data-grp="inward" data-col="deliverydate"><input class="pd-inp${dc('delivery_date')}" type="date" data-sid="${sid}" data-field="delivery_date" value="${v('delivery_date')}" title="Cannot be before LOA/PO Date"></td>
      <td class="pd-cell edit pd-grp" data-grp="inward" data-col="commissioningdate"><input class="pd-inp${dc('commissioning_date')}" type="date" data-sid="${sid}" data-field="commissioning_date" value="${v('commissioning_date')}" title="Date of commissioning"></td>
      <td class="pd-cell edit pd-grp" data-grp="inward" data-col="ptcdate"><input class="pd-inp${dc('ptc_date')}" type="date" data-sid="${sid}" data-field="ptc_date" value="${v('ptc_date')}" title="Provisional Test Certificate date"></td>
      <td class="pd-cell edit pd-grp" data-grp="inward" data-col="crnno"><input class="pd-inp${dc('crn_number')}" type="text" data-sid="${sid}" data-field="crn_number" value="${v('crn_number')}" placeholder="—" style="min-width:90px;"></td>
      <td class="pd-cell edit pd-grp" data-grp="inward" data-col="crndate"><input class="pd-inp${dc('crn_date')}" type="date" data-sid="${sid}" data-field="crn_date" value="${v('crn_date')}" title="Cannot be before Delivery Date"></td>
    </tr>`;
  }).join('');
  pdApplyColumnVisibility();
}

document.getElementById('pd_proc_body').addEventListener('input', (e) => {
  if (e.target.dataset.field === 'remarks') e.target.title = e.target.value;
});

// Fields that go through the date-sequence-aware path (pdCheckDateLive)
// rather than the plain pdMarkDirty path. indent_date and tender_opened_on
// and loa_po_date additionally get an immediate UI-level pre-check before
// that, matching v16's inline onchange guards exactly.
const PD_DATE_FIELDS = new Set([
  'indent_date', 'tender_called_on', 'tender_opened_on', 'loa_po_date',
  'delivery_date', 'commissioning_date', 'ptc_date', 'crn_date',
]);

// Native date inputs sometimes fire 'change' mid-entry — e.g. while
// overwriting an existing year digit by digit — with a partial or
// stale value, not just once the full date is committed. Validating
// on every one of those premature fires throws errors before the
// person has finished typing. Fix: (1) skip entirely unless the
// value is a complete YYYY-MM-DD string, and (2) debounce the actual
// validation slightly so a burst of near-simultaneous fires collapses
// into a single check after typing settles.
document.getElementById('pd_proc_body').addEventListener('change', (e) => {
  const el = e.target;
  const sid = el.dataset.sid;
  const field = el.dataset.field;
  if (!sid || !field) return;

  if (field === 'process_stage') {
    pdMarkDirty('proc', sid, 'process_stage', el.value, el);
    pdRecalcFromTat(sid, el.value);
    return;
  }

  if (el.type === 'date' && el.value && !/^\d{4}-\d{2}-\d{2}$/.test(el.value)) {
    return; // incomplete/partial date — wait for it to finish
  }

  clearTimeout(el._pdChangeDebounce);
  el._pdChangeDebounce = setTimeout(() => {
    pdHandleProcFieldChange(el, sid, field);
  }, 350);
});

function pdHandleProcFieldChange(el, sid, field) {
  if (field === 'indent_date') {
    const mn = el.dataset.minDate;
    if (el.value && mn && el.value < mn) {
      el.value = '';
      showToast('INDENT DATE CANNOT BE BEFORE SANCTIONED ON', 'error');
      return;
    }
  }
  if (field === 'tender_opened_on') {
    const tc = el.closest('tr')?.querySelector('[data-field="tender_called_on"]')?.value;
    if (el.value && tc && el.value < tc) {
      el.value = '';
      showToast('TENDER OPENED ON CANNOT BE BEFORE TENDER CALLED ON', 'error');
      return;
    }
  }
  if (field === 'loa_po_date') {
    const ind = el.closest('tr')?.querySelector('[data-field="indent_date"]')?.value;
    if (el.value && ind && el.value < ind) {
      el.value = '';
      showToast('LOA/PO DATE CANNOT BE BEFORE INDENT DATE', 'error');
      return;
    }
  }

  if (PD_DATE_FIELDS.has(field)) {
    pdCheckDateLive(sid, field, el.value, el);
  } else {
    pdMarkDirty('proc', sid, field, el.value, el);
  }
}

/* ================================================================
   SAVE ALL CHANGES — writes process_detail (and, once Billing is
   built, bill_detail) via nxFetch, which now audits every write
   automatically (see core/services.js). Blocked entirely if any
   pending change fails date-sequence validation.
   ================================================================ */
async function pdSaveAll() {
  const hasDirtyProc = Object.keys(PD.dirtyProc).length > 0;
  const hasDirtyBill = Object.keys(PD.dirtyBill).length > 0;
  if (!hasDirtyProc && !hasDirtyBill) { showToast('NO CHANGES TO SAVE'); return; }

  const msgEl = document.getElementById('pd_save_msg2');
  const btn2  = document.getElementById('pd_save_all_btn2');
  btn2.disabled = true;
  btn2.textContent = 'SAVING...';
  msgEl.style.color = 'var(--text-muted)'; msgEl.textContent = 'Saving...';

  let procSaved = 0, procErr = 0, billSaved = 0, billErr = 0;

  const NUM_DATE_PAIRS = [
    { num: 'indent_number',  date: 'indent_date',  label: 'Indent No',  dateLabel: 'Indent Date'  },
    { num: 'loa_po_number',  date: 'loa_po_date',  label: 'LOA/PO No',  dateLabel: 'LOA/PO Date'  },
    { num: 'crn_number',     date: 'crn_date',      label: 'CRN No',     dateLabel: 'CRN Date'     },
  ];

  const numDateErrors = [];
  for (const [subItemId, changes] of Object.entries(PD.dirtyProc)) {
    const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
    if (!row) continue;
    for (const pair of NUM_DATE_PAIRS) {
      const numVal  = changes[pair.num]  !== undefined ? changes[pair.num]  : (row[pair.num]  || '');
      const dateVal = changes[pair.date] !== undefined ? changes[pair.date] : (row[pair.date] || '');
      // Number filled, date empty
      if (numVal && !dateVal) {
        numDateErrors.push({
          subItemId, subItemName: row.sub_item_name,
          emptyField: pair.date,
          msg: `${pair.label} filled but ${pair.dateLabel} is empty`
        });
      }
      // Date filled, number empty — bidirectional
      if (dateVal && !numVal) {
        numDateErrors.push({
          subItemId, subItemName: row.sub_item_name,
          emptyField: pair.num,
          msg: `${pair.dateLabel} filled but ${pair.label} is empty`
        });
      }
    }
  }
  if (numDateErrors.length) {
    btn2.disabled = false;
    btn2.textContent = 'SAVE ALL CHANGES';
    msgEl.style.color = 'var(--accent-red)';
    const first = numDateErrors[0];
    msgEl.textContent = `⚠ INCOMPLETE PAIR — ${first.msg}`;
    numDateErrors.forEach(e => {
      const rowEl = document.querySelector(`[data-sid="${e.subItemId}"]`);
      if (!rowEl) return;
      // Highlight the EMPTY field so user knows what to fill
      const emptyInp = rowEl.querySelector(`[data-field="${e.emptyField}"]`);
      if (emptyInp) {
        emptyInp.style.borderColor = 'var(--accent-red)';
        emptyInp.style.boxShadow   = '0 0 0 2px rgba(255,59,59,0.3)';
        setTimeout(() => { emptyInp.style.borderColor = ''; emptyInp.style.boxShadow = ''; }, 4000);
      }
      showToast(`⚠ [${e.subItemName}] ${e.msg}`);
    });
    return;
  }

  const CHAIN_DATE_FIELDS_PROC = new Set([
    'indent_date','tender_called_on','tender_opened_on','loa_po_date',
    'delivery_date','commissioning_date','ptc_date','crn_date'
  ]);
  const CHAIN_DATE_FIELDS_BILL = new Set(['co6_date','co7_date']);

  const dateErrors = [];
  for (const [subItemId, changes] of Object.entries(PD.dirtyProc)) {
    const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
    if (!row) continue;
    const billChanges = PD.dirtyBill[subItemId] || {};
    const hasProcDateChange = Object.keys(changes).some(k => CHAIN_DATE_FIELDS_PROC.has(k));
    const hasBillDateChange = Object.keys(billChanges).some(k => CHAIN_DATE_FIELDS_BILL.has(k));
    if (!hasProcDateChange && !hasBillDateChange) continue;
    const errs = pdValidateDateSequence(row, changes, billChanges);
    if (errs.length) {
      dateErrors.push(`Sub-item [${row.sub_item_name}]:\n  ` + errs.join('\n  '));
    }
  }
  for (const [subItemId, billChanges] of Object.entries(PD.dirtyBill)) {
    if (PD.dirtyProc[subItemId]) continue;
    const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
    if (!row) continue;
    if (!Object.keys(billChanges).some(k => CHAIN_DATE_FIELDS_BILL.has(k))) continue;
    const errs = pdValidateDateSequence(row, {}, billChanges);
    if (errs.length) {
      dateErrors.push(`Sub-item [${row.sub_item_name}]:\n  ` + errs.join('\n  '));
    }
  }
  if (dateErrors.length) {
    btn2.disabled = false;
    btn2.textContent = 'SAVE ALL CHANGES';
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '⚠ DATE SEQUENCE ERROR — Save blocked';
    showToast('⚠ DATE SEQUENCE ERROR: ' + dateErrors[0].split('\n')[0], 'error');
    console.error('[DRGSBC] Date validation failed:\n' + dateErrors.join('\n\n'));
    return;
  }

  const cfg = getDbConfig();
  const session = getActiveSession();

  if (cfg?.nexus?.url && cfg?.nexus?.key) {
    for (const [subItemId, changes] of Object.entries(PD.dirtyProc)) {
      try {
        const pdRow = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
        const chk = canEditRecord(pdRow);
        if (!chk.ok) { showToast('EDIT BLOCKED: ' + chk.reason.slice(0, 60), 'error'); procErr++; continue; }

        const existing = PD.existProc[subItemId];
        if (existing?.process_id) {
          await nxFetch(`process_detail?process_id=eq.${existing.process_id}`,
            { method: 'PATCH', body: { ...changes, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
        } else {
          const row = PD.allRows.find(r => r.sub_item_id === subItemId);
          const today = new Date().toISOString().slice(0, 10);
          const payload = {
            sub_item_id: subItemId,
            owner_sse: row?.owner_sse || session?.user || '—',
            process_stage: row?.process_stage || 'Indent Under Prep',
            process_pdc: row?.process_pdc || today,
            next_process_due_on: row?.next_process_due_on || today,
            pending_with: row?.pending_with || '—',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...changes,
          };
          const created = await nxFetch('process_detail', { method: 'POST', body: payload, prefer: 'return=representation' });
          const createdRow = Array.isArray(created) ? created[0] : created;
          PD.existProc[subItemId] = createdRow;
          const idx0 = PD.allRows.findIndex(r => r.sub_item_id === subItemId);
          if (idx0 >= 0) { Object.assign(PD.allRows[idx0], changes); PD.allRows[idx0].process_id = createdRow.process_id; }
        }
        const idx = PD.allRows.findIndex(r => r.sub_item_id === subItemId);
        if (idx >= 0) Object.assign(PD.allRows[idx], changes);
        Object.keys(changes).forEach(f => {
          const el = document.querySelector(`[data-field='${f}'][data-sid='${subItemId}']`);
          if (el) setFieldState(el, 'success');
        });
        procSaved++;
      } catch (e) {
        Object.keys(changes).forEach(f => {
          const el = document.querySelector(`[data-field='${f}'][data-sid='${subItemId}']`);
          if (el) setFieldState(el, 'error');
        });
        console.error('proc save', subItemId, e); procErr++;
      }
    }
    // Bill-detail saves — structurally ready, but PD.dirtyBill can't be
    // populated yet (Billing isn't built here), so this loop is a no-op
    // until that lands.
    for (const [subItemId, changes] of Object.entries(PD.dirtyBill)) {
      try {
        const bdRow = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
        const chk = canEditRecord(bdRow);
        if (!chk.ok) { showToast('EDIT BLOCKED: ' + chk.reason.slice(0, 60), 'error'); billErr++; continue; }
        const existingBills = PD.existBill[subItemId];
        const existing = Array.isArray(existingBills) && existingBills.length ? existingBills[existingBills.length - 1] : null;
        if (existing?.bill_id) {
          await nxFetch(`bill_detail?bill_id=eq.${existing.bill_id}`,
            { method: 'PATCH', body: { ...changes, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
        } else {
          const payload = { sub_item_id: subItemId, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...changes };
          const createdBill = await nxFetch('bill_detail', { method: 'POST', body: payload, prefer: 'return=representation' });
          const createdBillRow = Array.isArray(createdBill) ? createdBill[0] : createdBill;
          PD.existBill[subItemId] = [createdBillRow];
        }
        const idx = PD.allRows.findIndex(r => r.sub_item_id === subItemId);
        if (idx >= 0) Object.assign(PD.allRows[idx], changes);
        Object.keys(changes).forEach(f => {
          const el = document.querySelector(`[data-field='${f}'][data-sid='${subItemId}']`);
          if (el) setFieldState(el, 'success');
        });
        billSaved++;
      } catch (e) {
        Object.keys(changes).forEach(f => {
          const el = document.querySelector(`[data-field='${f}'][data-sid='${subItemId}']`);
          if (el) setFieldState(el, 'error');
        });
        console.error('bill save', subItemId, e); billErr++;
      }
    }

    const errTotal = procErr + billErr;
    if (errTotal === 0) {
      // Auto-derive and save sanction_sub_item.status from the dates
      // just written, same as v16.
      // Fixed: ensure the TAT rules are actually loaded before relying
      // on them for either status derivation or the process_stage
      // auto-pick below — don't trust an ambient cache that may still
      // be null if the user never opened the Stage dropdown this session.
      await pdGetTat();
      const savedSubIds = new Set([...Object.keys(PD.dirtyProc), ...Object.keys(PD.dirtyBill)]);
      for (const subItemId of savedSubIds) {
        try {
          const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
          if (!row) continue;
          // Fixed: de_submit_date/de_vetted_on live on sanction_sub_item,
          // not process_detail — siCalcStatus() already knows to check
          // subItem for them (procDetail?.x || subItem?.x), so pass them
          // where they actually live instead of only on procDetail (which
          // was always undefined for these two fields anyway pre-fix).
          const subItem = { sanctioned_on: row.sanctioned_on, de_submit_date: row.de_submit_date, de_vetted_on: row.de_vetted_on };
          const procDetail = {
            process_stage:    row.process_stage,
            indent_date:      row.indent_date,
            tender_called_on: row.tender_called_on,
            tender_opened_on: row.tender_opened_on,
            loa_po_date:      row.loa_po_date,
            delivery_date:    row.delivery_date,
            crn_date:         row.crn_date,
          };
          const billDetail = { co6_date: row.co6_date, co7_date: row.co7_date, bill_description: row.bill_description };

          // 'Resume' is a transient trigger picked from the Stage
          // dropdown to say "leave On Hold/Dropped and recompute
          // normally" — it is never itself a stored final stage.
          // siCalcStatus()'s terminal short-circuit only matches literal
          // 'On Hold'/'Dropped', so with process_stage='Resume' it
          // already falls through to genuine date-driven computation —
          // correct for STATUS. But the ordinary `newStatus !== row.status`
          // guard below must not gate the STAGE update in this case: if
          // the recomputed status happened to still equal what was
          // already stored, 'Resume' would otherwise be left sitting in
          // process_stage permanently instead of being replaced by the
          // properly auto-picked stage.
          // Fixed: normalized (trim + case-insensitive) comparisons —
          // see pdNorm() note above siCalcStatus. Without this, a
          // stored status/stage that's semantically correct but
          // differently-cased than what siCalcStatus/process_tat
          // produce would either trigger needless rewrites every save,
          // or (worse) fail to match and silently skip the update.
          const wasResume = pdNorm(row.process_stage) === 'resume';
          const newStatus = siCalcStatus(subItem, procDetail, billDetail);
          const statusChanged = !!newStatus && pdNorm(newStatus) !== pdNorm(row.status);

          if (statusChanged) {
            await nxFetch(`sanction_sub_item?sub_item_id=eq.${subItemId}`,
              { method: 'PATCH', body: { status: newStatus, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
            row.status = newStatus;
          }

          if (newStatus && (statusChanged || wasResume)) {
            const tat = _processTatCache || [];
            const autoStageRow = tat.filter(t => pdNorm(t.status) === pdNorm(newStatus)).sort((a, b) => (a.priority || 0) - (b.priority || 0))[0];
            if (autoStageRow?.process_stage) {
              const autoStage = autoStageRow.process_stage;
              // Fixed: whenever we're already inside this block (status
              // genuinely changed, or Resume forced a full recompute), the
              // schedule fields must be recomputed from THIS resolved
              // stage's own TAT row too — not left as whatever the primary
              // dirty-field loop already wrote earlier in this save. For
              // Resume specifically, pdRecalcFromTat() no longer marks
              // these dirty at all (its own TAT row is meaningless as a
              // schedule source), so without this they'd be silently
              // skipped entirely. Written unconditionally here (not gated
              // on whether the stage TEXT happens to differ from before)
              // so a rare coincidental stage-name match across two
              // different statuses still gets its schedule refreshed.
              const sched = pdComputeSchedule(tat, autoStageRow, row);
              await nxFetch(`process_detail?sub_item_id=eq.${subItemId}`, {
                method: 'PATCH',
                body: {
                  process_stage: autoStage,
                  pending_with: sched.pendingWith,
                  process_pdc: sched.processPdc || null,
                  next_process_due_on: sched.nextDueOn || null,
                  updated_at: new Date().toISOString(),
                },
                prefer: 'return=representation',
              });
              row.process_stage = autoStage;
              row.pending_with = sched.pendingWith;
              row.process_pdc = sched.processPdc;
              row.next_process_due_on = sched.nextDueOn;
            } else if (wasResume) {
              console.warn('[DRGSBC] Resume could not resolve to a stage — no process_tat row found for status:', newStatus, 'sub_item_id:', subItemId);
            }
          }
        } catch (e) {
          console.warn('[DRGSBC] status update failed for sub_item_id=' + subItemId, e.message);
        }
      }

      msgEl.style.color = 'var(--accent-green)';
      msgEl.textContent = `✓ ${procSaved} PROCUREMENT + ${billSaved} BILLING RECORD(S) SAVED TO NEXUS`;
      showToast(`SAVED: ${procSaved + billSaved} RECORDS → NEXUS`);
      PD.dirtyProc = {}; PD.dirtyBill = {};
      document.getElementById('pd_dirty_badge').style.display = 'none';

      // Capture scroll position of the procurement table panel before re-fetch
      const _pdProcEl  = document.getElementById('pd_tab_procurement');
      const _pdScrollL = _pdProcEl ? _pdProcEl.scrollLeft : 0;
      const _pdScrollT = _pdProcEl ? _pdProcEl.scrollTop  : 0;
      // Full re-fetch from DB — filter selections preserved by pdCascadeFilters,
      // scroll position restored after render via requestAnimationFrame.
      await pdFetchData();
      requestAnimationFrame(() => {
        if (_pdProcEl) {
          _pdProcEl.scrollLeft = _pdScrollL;
          _pdProcEl.scrollTop  = _pdScrollT;
        }
      });
    } else {
      msgEl.style.color = 'var(--accent-red)';
      msgEl.textContent = `⚠ SAVED ${procSaved + billSaved} · FAILED ${errTotal} — Check console`;
      showToast(`PARTIAL SAVE: ${errTotal} ERRORS`, 'error');
    }
  } else {
    msgEl.style.color = 'var(--accent-red)';
    msgEl.textContent = '✕ NO DATABASE CONFIGURED — Go to Settings → Database to connect Nexus';
    showToast('SAVE FAILED: NO DB CONFIGURED', 'error');
    // Do NOT clear dirty state — preserve the user's staged changes.
  }

  btn2.disabled = false;
  btn2.textContent = 'SAVE ALL CHANGES';
}

function pdResetDirty() {
  PD.dirtyProc = {}; PD.dirtyBill = {};
  document.getElementById('pd_dirty_badge').style.display = 'none';
  pdApplyFilters();
  showToast('CHANGES DISCARDED');
}

function pdHasUnsavedChanges() {
  return Object.keys(PD.dirtyProc || {}).length > 0 || Object.keys(PD.dirtyBill || {}).length > 0;
}

document.getElementById('pd_save_all_btn2').addEventListener('click', pdSaveAll);
document.getElementById('pd_discard_btn').addEventListener('click', pdResetDirty);

/* ================================================================
   BILLING — sub-item summary rows + per-row Add/View bill actions.
   Stage and Remarks here write into PD.dirtyProc (same store as
   Procurement, deliberately — saving either tab's Save All button
   covers both), but bills themselves save immediately through their
   own modal, not through the dirty-state/Save All flow.
   ================================================================ */
let _currentBillSubItemId = null;
let _currentEditBillId = null;

function pdRenderBillTable() {
  const tbody = document.getElementById('pd_bill_body');
  if (!PD.filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:30px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-muted);">NO SUB-ITEMS MATCH FILTERS</td></tr>`;
    return;
  }
  tbody.innerHTML = PD.filteredRows.map((r, i) => {
    const dirty = PD.dirtyProc[r.sub_item_id] || {};
    const v  = (field) => dirty[field] !== undefined ? dirty[field] : (r[field] || '');
    const dc = (field) => dirty[field] !== undefined ? ' dirty' : '';
    const sid = r.sub_item_id;
    return `<tr data-sid="${sid}">
      <td class="pd-ro muted pd-frozen" data-col="slno">${i + 1}</td>
      <td class="pd-ro pd-frozen" style="font-weight:600;color:var(--text-primary);line-height:1.3;" data-col="subitem">
        ${r.sub_item_name || '—'}
        <div style="font-size:9px;color:var(--text-muted);font-family:'Share Tech Mono',monospace;">${r.sub_item_id || ''}</div>
      </td>
      <td class="pd-ro muted pd-frozen" data-col="qty">${r.qty || '—'}</td>
      <td class="pd-ro pd-frozen" style="color:var(--accent-gold);" data-col="latestcost">${r.latest_cost ? 'Rs.' + Number(r.latest_cost).toLocaleString('en-IN') : '—'}</td>
      <td class="pd-cell edit pd-col pd-frozen" data-col="remarks"><input class="pd-inp${dc('remarks')}" type="text" data-sid="${sid}" data-field="remarks" value="${v('remarks')}" placeholder="Add remarks..." title="${pdEscAttr(v('remarks'))}"></td>
      <td class="pd-cell edit pd-col pd-frozen" data-col="stage">
        <select class="pd-inp f-select" data-sid="${sid}" data-field="process_stage" style="font-size:10px;">
          ${pdBuildStageOptions(r.status, v('process_stage'))}
        </select>
      </td>
      <td class="pd-ro muted pd-col pd-frozen" data-col="unitprice">${r.unit_price ? 'Rs.' + Number(r.unit_price).toLocaleString('en-IN') : '—'}</td>
      <td class="pd-ro muted pd-col pd-frozen" data-col="depot">${r.processing_depot || '—'}</td>
      <td class="pd-cell pd-col pd-frozen" data-col="nextdue" title="Auto-calculated: field date + next stage TAT"><span class="pd-ro ms-ndo-calc" style="color:var(--accent-green);font-family:'Share Tech Mono',monospace;font-size:9px;">${r.next_process_due_on || '—'}</span></td>
      <td class="pd-ro muted pd-col pd-frozen" data-col="ownersse">${r.owner_sse || '—'}</td>
      <td class="pd-cell pd-col pd-frozen" data-col="processpdc" title="Auto-calculated: field date + remaining TAT"><span class="pd-ro ms-pdc-calc ${pdDateClass(r.process_pdc)}" style="color:var(--accent-cyan);font-family:'Share Tech Mono',monospace;font-size:9px;">${r.process_pdc || '—'}</span></td>
      <td class="pd-cell" data-col="pendingwith"><span class="pd-ro ms-pw-calc" style="color:var(--accent-gold);font-family:'Share Tech Mono',monospace;font-size:9px;">${r.pending_with || '—'}</span></td>
      <td class="pd-ro" style="color:var(--accent-cyan);font-weight:700;font-family:'Share Tech Mono',monospace;font-size:10px;" id="total_bills_${sid}">
        ${r.total_bills ? 'Rs.' + Number(r.total_bills).toLocaleString('en-IN') : '—'}
      </td>
      <td class="pd-cell" style="white-space:nowrap;">
        <button id="new_bill_btn_${sid}" data-action="new-bill" data-sid="${sid}"
          style="background:transparent;border:1px solid var(--accent-green);color:var(--accent-green);
          padding:4px 8px;border-radius:4px;cursor:pointer;font-family:'Share Tech Mono',monospace;
          font-size:9px;letter-spacing:1px;white-space:nowrap;">
          + NEW BILL
        </button>
      </td>
      <td class="pd-cell" style="white-space:nowrap;">
        <button id="view_bills_btn_${sid}" data-action="view-bills" data-sid="${sid}" data-name="${pdEscAttr(r.sub_item_name)}"
          style="background:transparent;border:1px solid var(--accent-blue);color:var(--accent-blue);
          padding:4px 8px;border-radius:4px;cursor:pointer;font-family:'Share Tech Mono',monospace;
          font-size:9px;letter-spacing:1px;white-space:nowrap;">
          VIEW BILLS
        </button>
      </td>
    </tr>`;
  }).join('');
  pdApplyColumnVisibility();
  pdStyleDateInputs(document.getElementById('pd_tab_billing'));
}

document.getElementById('pd_bill_body').addEventListener('input', (e) => {
  if (e.target.dataset.field === 'remarks') e.target.title = e.target.value;
});

// Sets "+ NEW BILL" enabled/disabled + total_bills display from
// already-loaded PD.existBill — no extra fetch needed.
function pdInitBillingButtonStates() {
  PD.filteredRows.forEach(r => {
    const sid = r.sub_item_id;
    const bills = PD.existBill[sid] || [];
    const released = bills.filter(pdIsBillReleased);
    const total = released.reduce((sum, b) => sum + (parseFloat(b.bill_amount) || 0), 0);
    const hasFinal = bills.some(pdIsBillFinal);
    const hasPending = bills.some(pdIsBillPending);

    const totalEl = document.getElementById(`total_bills_${sid}`);
    if (totalEl) totalEl.textContent = total > 0 ? 'Rs.' + total.toLocaleString('en-IN') : '—';

    const newBillBtn = document.getElementById(`new_bill_btn_${sid}`);
    if (newBillBtn) {
      if (hasFinal) {
        newBillBtn.disabled = true;
        newBillBtn.style.opacity = '0.35'; newBillBtn.style.cursor = 'not-allowed';
        newBillBtn.style.borderColor = 'var(--text-muted)'; newBillBtn.style.color = 'var(--text-muted)';
        newBillBtn.title = 'FINAL bill recorded — no further bills allowed';
      } else {
        newBillBtn.disabled = false;
        newBillBtn.style.opacity = ''; newBillBtn.style.cursor = 'pointer';
        newBillBtn.style.borderColor = 'var(--accent-green)'; newBillBtn.style.color = 'var(--accent-green)';
        newBillBtn.title = '';
      }
    }

    const viewBillsBtn = document.getElementById(`view_bills_btn_${sid}`);
    if (viewBillsBtn) {
      if (hasPending) {
        viewBillsBtn.style.borderColor = 'var(--accent-gold)'; viewBillsBtn.style.color = 'var(--accent-gold)';
        viewBillsBtn.style.background = 'rgba(255,214,10,0.08)';
        viewBillsBtn.title = 'This sub-item has pending bill(s)';
      } else {
        viewBillsBtn.style.borderColor = 'var(--accent-blue)'; viewBillsBtn.style.color = 'var(--accent-blue)';
        viewBillsBtn.style.background = 'transparent';
        viewBillsBtn.title = '';
      }
    }
  });
}

document.getElementById('pd_bill_body').addEventListener('change', (e) => {
  const el = e.target;
  const sid = el.dataset.sid;
  const field = el.dataset.field;
  if (!sid || !field) return;
  if (field === 'process_stage') {
    pdMarkDirty('proc', sid, 'process_stage', el.value, el);
    pdRecalcFromTat(sid, el.value);
  } else {
    pdMarkDirty('proc', sid, field, el.value, el);
  }
});

document.getElementById('pd_bill_body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'new-bill')   pdOpenNewBillRow(btn.dataset.sid);
  if (btn.dataset.action === 'view-bills') pdViewAllBills(btn.dataset.sid, btn.dataset.name);
});

/* ── Recalculate total_bills + button states for one sub-item after
   a bill is saved/rejected — recomputes from the live DB, then
   patches process_detail.total_bills to match. ── */
async function pdUpdateTotalBills(subItemId) {
  try {
    const bills = await nxFetch(`bill_detail?sub_item_id=eq.${subItemId}&select=bill_amount,co7_number,co7_date,bill_description,bill_date,bill_status`);
    const released = (bills || []).filter(pdIsBillReleased);
    const total = released.reduce((sum, b) => sum + (parseFloat(b.bill_amount) || 0), 0);
    const hasFinal = (bills || []).some(pdIsBillFinal);
    const hasPending = (bills || []).some(pdIsBillPending);

    const el = document.getElementById(`total_bills_${subItemId}`);
    if (el) el.textContent = total > 0 ? 'Rs.' + total.toLocaleString('en-IN') : '—';

    const newBillBtn = document.getElementById(`new_bill_btn_${subItemId}`);
    if (newBillBtn) {
      if (hasFinal) {
        newBillBtn.disabled = true;
        newBillBtn.style.opacity = '0.35'; newBillBtn.style.cursor = 'not-allowed';
        newBillBtn.style.borderColor = 'var(--text-muted)'; newBillBtn.style.color = 'var(--text-muted)';
        newBillBtn.title = 'FINAL bill recorded — no further bills allowed';
      } else {
        newBillBtn.disabled = false;
        newBillBtn.style.opacity = ''; newBillBtn.style.cursor = 'pointer';
        newBillBtn.style.borderColor = 'var(--accent-green)'; newBillBtn.style.color = 'var(--accent-green)';
        newBillBtn.title = '';
      }
    }

    const viewBillsBtn = document.getElementById(`view_bills_btn_${subItemId}`);
    if (viewBillsBtn) {
      if (hasPending) {
        viewBillsBtn.style.borderColor = 'var(--accent-gold)'; viewBillsBtn.style.color = 'var(--accent-gold)';
        viewBillsBtn.style.background = 'rgba(255,214,10,0.08)';
        viewBillsBtn.title = 'This sub-item has pending bill(s)';
      } else {
        viewBillsBtn.style.borderColor = 'var(--accent-blue)'; viewBillsBtn.style.color = 'var(--accent-blue)';
        viewBillsBtn.style.background = 'transparent';
        viewBillsBtn.title = '';
      }
    }

    const existing = PD.existProc[subItemId];
    if (existing?.process_id) {
      await nxFetch(`process_detail?process_id=eq.${existing.process_id}`,
        { method: 'PATCH', body: { total_bills: total, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    }
  } catch (e) { console.warn('pdUpdateTotalBills:', e); }
}

/* ── New / Edit Bill modal ── */
function pdOpenNewBillRow(subItemId) {
  const existingBills = PD.existBill[subItemId] || [];
  if (existingBills.some(pdIsBillFinal)) {
    showToast('FINAL BILL ALREADY RECORDED — NO FURTHER BILLS ALLOWED', 'error');
    return;
  }
  _currentBillSubItemId = subItemId;
  _currentEditBillId = null;
  const row = PD.allRows.find(r => String(r.sub_item_id) === String(subItemId));
  document.getElementById('newBillSubItemLabel').textContent = `SUB-ITEM ID: ${subItemId}  ·  ${row?.sub_item_name || ''}`;
  document.getElementById('newBillModalTitle').textContent = 'ADD NEW BILL';
  ['nb_bill_number', 'nb_bill_date', 'nb_bill_amount', 'nb_bill_description',
   'nb_co6_number', 'nb_co6_date', 'nb_co7_number', 'nb_co7_date', 'nb_payment_date']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('nb_status').textContent = '';
  const btn = document.getElementById('nb_save_btn');
  btn.disabled = false; btn.textContent = 'SAVE BILL';
  const modal = document.getElementById('newBillModal');
  modal.style.display = 'flex';
  pdStyleDateInputs(modal);
}

async function pdEditBillRow(billId) {
  try {
    const rows = await nxFetch(`bill_detail?bill_id=eq.${billId}&select=*`);
    const b = Array.isArray(rows) ? rows[0] : rows;
    if (!b) { showToast('BILL NOT FOUND', 'error'); return; }
    if (pdIsBillRejected(b)) { showToast('REJECTED BILLS CANNOT BE EDITED', 'error'); return; }

    _currentBillSubItemId = b.sub_item_id;
    _currentEditBillId = billId;

    const row = PD.allRows.find(r => String(r.sub_item_id) === String(b.sub_item_id));
    document.getElementById('newBillSubItemLabel').textContent = `SUB-ITEM ID: ${b.sub_item_id}  ·  ${row?.sub_item_name || ''}`;
    document.getElementById('newBillModalTitle').textContent = 'EDIT BILL';

    document.getElementById('nb_bill_number').value      = b.bill_number || '';
    document.getElementById('nb_bill_date').value        = b.bill_date || '';
    document.getElementById('nb_bill_amount').value      = b.bill_amount ?? '';
    document.getElementById('nb_bill_description').value = b.bill_description || '';
    document.getElementById('nb_co6_number').value       = b.co6_number || '';
    document.getElementById('nb_co6_date').value         = b.co6_date || '';
    document.getElementById('nb_co7_number').value       = b.co7_number || '';
    document.getElementById('nb_co7_date').value         = b.co7_date || '';
    document.getElementById('nb_payment_date').value     = b.payment_date || '';

    document.getElementById('nb_status').textContent = '';
    const btn = document.getElementById('nb_save_btn');
    btn.disabled = false; btn.textContent = 'UPDATE BILL';

    pdCloseViewBillsModal();
    const modal = document.getElementById('newBillModal');
    modal.style.display = 'flex';
    pdStyleDateInputs(modal);
  } catch (e) {
    showToast('ERROR LOADING BILL: ' + e.message.slice(0, 60), 'error');
  }
}

function pdCloseNewBillModal() {
  document.getElementById('newBillModal').style.display = 'none';
  _currentBillSubItemId = null;
  _currentEditBillId = null;
}

async function pdSaveNewBill() {
  const sid = _currentBillSubItemId;
  if (!sid) return;
  const statusEl = document.getElementById('nb_status');
  const btn = document.getElementById('nb_save_btn');

  const bill_amount = parseFloat(document.getElementById('nb_bill_amount').value);
  if (!bill_amount || bill_amount <= 0) {
    statusEl.style.color = 'var(--accent-red)';
    statusEl.textContent = '✕ Bill amount is required';
    return;
  }

  const isEdit = !!_currentEditBillId;
  const co7Number = document.getElementById('nb_co7_number').value.trim() || null;
  const co7Date   = document.getElementById('nb_co7_date').value || null;

  const payload = {
    sub_item_id: sid,
    bill_number: document.getElementById('nb_bill_number').value.trim() || null,
    bill_date: document.getElementById('nb_bill_date').value || null,
    bill_amount: bill_amount,
    bill_description: document.getElementById('nb_bill_description').value.trim() || null,
    co6_number: document.getElementById('nb_co6_number').value.trim() || null,
    co6_date: document.getElementById('nb_co6_date').value || null,
    co7_number: co7Number,
    co7_date: co7Date,
    // Auto-filled from co7_date if payment date wasn't entered separately.
    payment_date: co7Date || document.getElementById('nb_payment_date').value || null,
    // Released once CO7 number + date are both present. Rejected is only
    // ever set via the explicit Reject action, never here.
    bill_status: (co7Number && co7Date) ? 'Released' : 'Pending',
  };
  if (!isEdit) payload.created_at = new Date().toISOString();
  else payload.updated_at = new Date().toISOString();

  btn.disabled = true;
  btn.textContent = 'SAVING...';
  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = 'Saving bill...';

  try {
    if (isEdit) {
      await nxFetch(`bill_detail?bill_id=eq.${_currentEditBillId}`, { method: 'PATCH', body: payload, prefer: 'return=minimal' });
    } else {
      await nxFetch('bill_detail', { method: 'POST', body: payload, prefer: 'return=minimal' });
    }

    await pdUpdateTotalBills(sid);

    statusEl.style.color = 'var(--accent-green)';
    statusEl.textContent = isEdit ? '✓ Bill updated successfully' : '✓ Bill saved successfully';
    showToast(isEdit ? 'BILL UPDATED SUCCESSFULLY' : 'BILL SAVED SUCCESSFULLY');

    setTimeout(() => {
      pdCloseNewBillModal();
      // v16 actually calls a non-existent pdLoadData() here (a stale
      // reference swallowed by a typeof guard, so it silently never
      // refreshes) — using the real fetch function instead.
      pdFetchData();
    }, 1000);
  } catch (err) {
    statusEl.style.color = 'var(--accent-red)';
    statusEl.textContent = '✕ Error: ' + err.message.slice(0, 60);
    btn.disabled = false;
    btn.textContent = isEdit ? 'UPDATE BILL' : 'SAVE BILL';
  }
}

document.getElementById('newBillCloseBtn').addEventListener('click', pdCloseNewBillModal);
document.getElementById('newBillCancelBtn').addEventListener('click', pdCloseNewBillModal);
document.getElementById('nb_save_btn').addEventListener('click', pdSaveNewBill);

/* ── Reject a pending bill: prompts for a reason, appends to remarks,
   sets bill_status='Rejected'. Permanent — no un-reject. ── */
async function pdRejectBillRow(billId) {
  const reason = prompt('Reason for rejection (optional):', '');
  if (reason === null) return;

  try {
    const rows = await nxFetch(`bill_detail?bill_id=eq.${billId}&select=sub_item_id,remarks`);
    const b = Array.isArray(rows) ? rows[0] : rows;
    if (!b) { showToast('BILL NOT FOUND', 'error'); return; }

    const stamp = new Date().toISOString().slice(0, 10);
    const rejectNote = `[REJECTED ${stamp}]` + (reason.trim() ? ` ${reason.trim()}` : '');
    const newRemarks = b.remarks ? `${b.remarks}\n${rejectNote}` : rejectNote;

    await nxFetch(`bill_detail?bill_id=eq.${billId}`, {
      method: 'PATCH', body: { bill_status: 'Rejected', remarks: newRemarks, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    });

    showToast('BILL REJECTED');
    await pdUpdateTotalBills(b.sub_item_id);

    const row = PD.allRows.find(r => String(r.sub_item_id) === String(b.sub_item_id));
    await pdViewAllBills(b.sub_item_id, row?.sub_item_name || '');
  } catch (e) {
    showToast('ERROR REJECTING BILL: ' + e.message.slice(0, 60), 'error');
  }
}

/* ── View Bills modal ── */
async function pdViewAllBills(subItemId, subItemName) {
  document.getElementById('viewBillsSubItemLabel').textContent = `SUB-ITEM ID: ${subItemId}  ·  ${subItemName}`;
  document.getElementById('viewBillsTableBody').innerHTML =
    '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-muted);font-family:\'Share Tech Mono\',monospace;font-size:10px;">LOADING...</td></tr>';
  document.getElementById('viewBillsTotal').textContent = '';
  document.getElementById('viewBillsModal').style.display = 'flex';

  try {
    const bills = await nxFetch(`bill_detail?sub_item_id=eq.${subItemId}&order=bill_date.asc,created_at.asc`);

    if (!bills || !bills.length) {
      document.getElementById('viewBillsTableBody').innerHTML =
        '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted);font-family:\'Share Tech Mono\',monospace;font-size:10px;">NO BILLS FOUND FOR THIS SUB-ITEM</td></tr>';
      return;
    }

    let totalAmt = 0, releasedCount = 0, pendingCount = 0;
    document.getElementById('viewBillsTableBody').innerHTML = bills.map((b, i) => {
      const released = pdIsBillReleased(b);
      const isFinal  = pdIsBillFinal(b);
      if (released) { totalAmt += parseFloat(b.bill_amount) || 0; releasedCount++; } else { pendingCount++; }
      const rowStyle = i % 2 === 0 ? 'background:var(--bg-card);' : '';
      const isRejected = pdIsBillRejected(b);
      const statusBadge = isRejected
        ? `<span class="badge" style="background:rgba(255,56,96,0.1);color:var(--accent-red);border:1px solid rgba(255,56,96,0.3);text-decoration:line-through;">REJECTED</span>`
        : isFinal
          ? `<span class="badge" style="background:rgba(0,255,170,0.1);color:var(--accent-green);border:1px solid rgba(0,255,170,0.3);">FINAL</span>`
          : released
            ? `<span class="badge" style="background:rgba(0,180,216,0.1);color:var(--accent-blue);border:1px solid rgba(0,180,216,0.3);">RELEASED</span>`
            : `<span class="badge" style="background:rgba(255,214,10,0.1);color:var(--accent-gold);border:1px solid rgba(255,214,10,0.3);">PENDING</span>`;
      const actionCell = isRejected
        ? `<span style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:9px;">—</span>`
        : pdIsBillPending(b)
          ? `<button data-bill-action="reject" data-bill-id="${b.bill_id}"
               style="background:transparent;border:1px solid var(--accent-red);color:var(--accent-red);
               padding:3px 8px;border-radius:4px;cursor:pointer;font-family:'Share Tech Mono',monospace;
               font-size:9px;letter-spacing:1px;white-space:nowrap;">✕ REJECT</button>`
          : `<span style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:9px;">—</span>`;
      const rowOpacity = isRejected ? 'opacity:0.55;' : '';
      return `<tr style="${rowStyle}${rowOpacity}cursor:pointer;" data-bill-action="edit" data-bill-id="${b.bill_id}" title="Click to edit this bill">
        <td style="padding:8px;color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:9px;">${i + 1}</td>
        <td style="padding:8px;color:var(--text-primary);font-family:'Share Tech Mono',monospace;font-size:10px;">${b.bill_number || '—'}</td>
        <td style="padding:8px;color:var(--text-secondary);font-family:'Share Tech Mono',monospace;font-size:10px;">${pdFormatDateDMY(b.bill_date)}</td>
        <td style="padding:8px;color:var(--accent-cyan);font-family:'Share Tech Mono',monospace;font-size:10px;text-align:right;font-weight:700;">
          ${b.bill_amount ? 'Rs.' + Number(b.bill_amount).toLocaleString('en-IN') : '—'}
        </td>
        <td style="padding:8px;color:var(--text-secondary);font-size:10px;">${b.bill_description || '—'}</td>
        <td style="padding:8px;color:var(--text-secondary);font-family:'Share Tech Mono',monospace;font-size:9px;">${b.co6_number || '—'} ${b.co6_date ? '(' + pdFormatDateDMY(b.co6_date) + ')' : ''}</td>
        <td style="padding:8px;color:var(--text-secondary);font-family:'Share Tech Mono',monospace;font-size:9px;">${b.co7_number || '—'} ${b.co7_date ? '(' + pdFormatDateDMY(b.co7_date) + ')' : ''}</td>
        <td style="padding:8px;color:var(--text-secondary);font-family:'Share Tech Mono',monospace;font-size:10px;">${pdFormatDateDMY(b.payment_date)}</td>
        <td style="padding:8px;text-align:center;" data-bill-action="stop">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">${statusBadge}${actionCell}</div>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('viewBillsTotal').innerHTML =
      `TOTAL BILLS RELEASED: <strong style="color:var(--accent-cyan);font-size:13px;">
        Rs.${totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
      </strong> &nbsp;·&nbsp; ${releasedCount} released, ${pendingCount} pending`;
  } catch (err) {
    document.getElementById('viewBillsTableBody').innerHTML =
      `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--accent-red);font-family:'Share Tech Mono',monospace;font-size:10px;">ERROR: ${err.message.slice(0, 80)}</td></tr>`;
  }
}

function pdCloseViewBillsModal() {
  document.getElementById('viewBillsModal').style.display = 'none';
}

document.getElementById('viewBillsCloseBtn').addEventListener('click', pdCloseViewBillsModal);
// Delegated click on the bill rows: REJECT button stops propagation
// (handled first, before the row's own "click to edit" fires); status
// cell also stops propagation so clicking a badge doesn't open edit.
document.getElementById('viewBillsTableBody').addEventListener('click', (e) => {
  const rejectBtn = e.target.closest('[data-bill-action="reject"]');
  if (rejectBtn) { e.stopPropagation(); pdRejectBillRow(rejectBtn.dataset.billId); return; }
  const stopCell = e.target.closest('[data-bill-action="stop"]');
  if (stopCell) return;
  const editRow = e.target.closest('[data-bill-action="edit"]');
  if (editRow) pdEditBillRow(editRow.dataset.billId);
});

/* ================================================================
   SUMMARY SUB-TAB
   ================================================================ */
function pdRenderSummary() {
  const rows = PD.filteredRows || [];
  const empty   = document.getElementById('summ_sub_empty');
  const summary = document.getElementById('summ_sub_content');

  if (!rows.length) {
    if (empty)   empty.style.display   = '';
    if (summary) summary.style.display = 'none';
    return;
  }
  if (empty)   empty.style.display   = 'none';
  if (summary) summary.style.display = '';

  const total = rows.length;
  const today = new Date().toISOString().split('T')[0];

  const active  = rows.filter(r => r.status !== 'Dropped' && r.status !== 'On Hold').length;
  const onHold  = rows.filter(r => r.status === 'On Hold').length;
  const dropped = rows.filter(r => r.status === 'Dropped').length;
  const overdue = rows.filter(r => r.next_process_due_on && r.next_process_due_on < today).length;

  const bannerEl = document.getElementById('summ_banner');
  if (bannerEl) {
    bannerEl.innerHTML = [
      { label: 'TOTAL ITEMS', val: total,   color: 'var(--accent-cyan)' },
      { label: 'ACTIVE',      val: active,  color: 'var(--accent-green)' },
      { label: 'ON HOLD',     val: onHold,  color: 'var(--accent-gold)' },
      { label: 'DROPPED',     val: dropped, color: 'var(--accent-red)' },
      { label: 'OVERDUE',     val: overdue, color: 'var(--accent-red)' },
    ].map(b => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid ${b.color};
                  padding:12px 20px;border-radius:4px;min-width:120px;flex:1;">
        <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:1px;">${b.label}</div>
        <div style="font-family:Rajdhani,sans-serif;font-size:28px;font-weight:700;color:${b.color};">${b.val}</div>
      </div>`).join('');
  }

  function renderBar(barId, legendId, segments) {
    const barEl    = document.getElementById(barId);
    const legendEl = document.getElementById(legendId);
    if (!barEl || !legendEl) return;
    const totalVal = segments.reduce((s, x) => s + x.count, 0) || 1;
    barEl.innerHTML = segments.filter(s => s.count > 0).map(s => {
      const pct = (s.count / totalVal * 100).toFixed(1);
      return `<div style="width:${pct}%;background:${s.color};display:flex;align-items:center;justify-content:center;overflow:hidden;min-width:2px;" title="${s.label}: ${s.count} (${pct}%)">
                ${pct > 5 ? `<span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#fff;white-space:nowrap;">${pct}%</span>` : ''}
              </div>`;
    }).join('');
    legendEl.innerHTML = segments.filter(s => s.count > 0).map(s => {
      const pct = (s.count / totalVal * 100).toFixed(1);
      return `<div style="display:flex;align-items:center;gap:5px;">
                <div style="width:10px;height:10px;border-radius:2px;background:${s.color};flex-shrink:0;"></div>
                <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-secondary);">
                  ${s.label} <span style="color:var(--text-primary);font-weight:600;">${s.count}</span>
                  <span style="color:var(--text-muted);">(${pct}%)</span>
                </span>
              </div>`;
    }).join('');
  }

  const STATUS_COLORS = {
    'Sanctioned': '#6366f1', 'DE Submitted': '#8b5cf6', 'DE Vetted': '#a78bfa',
    'Indent Under Prep': '#f59e0b', 'Indent Submitted': '#f97316', 'Tender Called': '#fb923c',
    'Under TC': '#fbbf24', 'PO/LOA Issued': '#34d399', 'Item Delivered': '#10b981',
    'CRN Generated': '#06b6d4', 'Bill Submitted': '#3b82f6', 'Bill Passed': '#22c55e',
    'On Hold': '#ef4444', 'Dropped': '#6b7280', 'Process Over': '#14b8a6', 'Work Completed': '#84cc16',
  };
  const statusCounts = {};
  rows.forEach(r => { const s = r.status || 'Unknown'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
  const statusSegs = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])
    .map(([s, c]) => ({ label: s, count: c, color: STATUS_COLORS[s] || 'var(--text-muted)' }));
  renderBar('summ_status_bar', 'summ_status_legend', statusSegs);

  const PW_COLORS = {
    'Owner SSE': 'var(--accent-cyan)', 'Div-Material Management': 'var(--accent-blue)',
    'Div-Finance': 'var(--accent-green)', 'Div-Planning': '#8b5cf6',
    'HQ-SWR': 'var(--accent-gold)', 'Vendor': '#f97316', 'Holdings': '#14b8a6',
  };
  const pwCounts = {};
  rows.forEach(r => { const pw = r.pending_with || 'Not Set'; pwCounts[pw] = (pwCounts[pw] || 0) + 1; });
  const pwSegs = Object.entries(pwCounts).sort((a, b) => b[1] - a[1])
    .map(([pw, c]) => ({ label: pw, count: c, color: PW_COLORS[pw] || 'var(--text-muted)' }));
  renderBar('summ_pending_bar', 'summ_pending_legend', pwSegs);

  const totalVetted    = rows.reduce((s, r) => s + (parseFloat(r.vetted_cost) || 0), 0);
  const billsPassed    = rows.filter(r => ['Bill Passed', 'Process Over', 'Work Completed'].includes(r.status))
                              .reduce((s, r) => s + (parseFloat(r.total_bills) || 0), 0);
  const billsSubmitted = rows.filter(r => r.status === 'Bill Submitted')
                              .reduce((s, r) => s + (parseFloat(r.total_bills) || 0), 0);
  const yetToReceive   = Math.max(0, totalVetted - billsPassed - billsSubmitted);
  const fmt = v => v >= 10000000 ? `Rs.${(v / 10000000).toFixed(2)}Cr` : v >= 100000 ? `Rs.${(v / 100000).toFixed(2)}L` : `Rs.${Math.round(v).toLocaleString('en-IN')}`;
  const finTotal = totalVetted || 1;
  const finSegs = [
    { label: `Bills Passed (${fmt(billsPassed)})`,       count: billsPassed,    color: 'var(--accent-green)' },
    { label: `Bills Submitted (${fmt(billsSubmitted)})`, count: billsSubmitted, color: 'var(--accent-gold)' },
    { label: `Yet to Receive (${fmt(yetToReceive)})`,    count: yetToReceive,   color: 'rgba(100,116,139,0.4)' },
  ].filter(s => s.count > 0);

  const finBarEl = document.getElementById('summ_finance_bar');
  const finLegEl = document.getElementById('summ_finance_legend');
  if (finBarEl) {
    finBarEl.innerHTML = finSegs.map(s => {
      const pct = (s.count / finTotal * 100).toFixed(1);
      return `<div style="width:${pct}%;background:${s.color};display:flex;align-items:center;justify-content:center;overflow:hidden;min-width:2px;" title="${s.label} (${pct}%)">
                ${pct > 5 ? `<span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#fff;white-space:nowrap;">${pct}%</span>` : ''}
              </div>`;
    }).join('');
  }
  if (finLegEl) {
    finLegEl.innerHTML = [
      ...finSegs.map(s => {
        const pct = (s.count / finTotal * 100).toFixed(1);
        return `<div style="display:flex;align-items:center;gap:5px;">
                  <div style="width:10px;height:10px;border-radius:2px;background:${s.color};flex-shrink:0;"></div>
                  <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-secondary);">
                    ${s.label} <span style="color:var(--text-muted);">(${pct}%)</span>
                  </span>
                </div>`;
      }),
      `<div style="display:flex;align-items:center;gap:5px;margin-left:16px;">
         <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">TOTAL VETTED COST:</span>
         <span style="font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;color:var(--accent-cyan);">${fmt(totalVetted)}</span>
       </div>`
    ].join('');
  }
}

function pdRenderSummaryExtras() {
  const labelEl = document.getElementById('summ_filter_labels');
  if (labelEl) {
    const ph  = document.getElementById('pd_f_planhead')?.value || 'ALL';
    const dep = document.getElementById('pd_f_depot')?.value || 'ALL';
    const up  = document.getElementById('pd_f_underpower')?.value || 'ALL';
    const li  = document.getElementById('pd_f_lineitem')?.value || 'ALL';
    const si  = document.getElementById('pd_f_subitem')?.value || '';
    const st  = document.getElementById('pd_f_stage')?.value || 'ALL';
    const pw  = document.getElementById('pd_f_pending')?.value || 'ALL';
    const parts = [
      ph  !== 'ALL' ? `PLAN HEAD: ${ph}` : null,
      dep !== 'ALL' ? `DEPOT: ${dep}` : null,
      up  !== 'ALL' ? `UNDER POWER: ${up}` : null,
      li  !== 'ALL' ? `LINE ITEM: ${li}` : null,
      si              ? `SUB-ITEM: ${si}` : null,
      st  !== 'ALL' ? `STAGE: ${st}` : null,
      pw  !== 'ALL' ? `PENDING WITH: ${pw}` : null,
    ].filter(Boolean);
    labelEl.innerHTML = parts.length
      ? parts.map(p => `<span style='margin-right:16px;color:var(--accent-cyan);'>◊ ${p}</span>`).join('')
      : '<span style="color:var(--text-muted);">No filters active — showing all items</span>';
  }
  pdRenderSummaryList();
}

const SUMM_TABLE_COLUMNS = [
  { label: 'Line Item',           field: 'item_name',           type: 'text',  width: '13%' },
  { label: 'Item Name',           field: 'sub_item_name',       type: 'text',  width: '13%' },
  { label: 'Qty',                 field: 'qty',                 type: 'num',   width: '5%' },
  { label: 'Unit Rate',           field: 'unit_price',          type: 'money', width: '8%' },
  { label: 'Vetted Cost',         field: 'vetted_cost',         type: 'money', width: '9%' },
  { label: 'Status',              field: 'status',              type: 'badge', width: '9%' },
  { label: 'Process Stage',       field: 'process_stage',       type: 'text',  width: '8%' },
  { label: 'Pending With',        field: 'pending_with',        type: 'text',  width: '8%' },
  { label: 'Next Process Due On', field: 'next_process_due_on', type: 'date',  width: '8%' },
  { label: 'Process PDC',         field: 'process_pdc',         type: 'date',  width: '8%' },
  { label: 'Latest Grant',        field: 'latest_grant',        type: 'money', width: '8%' },
];
const SUMM_IDX_COL_WIDTH = '3%';

function pdRenderSummaryList() {
  const rows = PD.filteredRows || [];
  const listEl = document.getElementById('summ_items_list');
  if (!listEl) return;

  const fmtMoney = v => 'Rs.' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const cellValue = (r, col) => {
    let v = r[col.field];
    if (col.field === 'unit_price' && !v && r.qty) {
      v = r.vetted_cost ? (Number(r.vetted_cost) / Number(r.qty)) : v;
    }
    if (v === undefined || v === null || v === '') return '—';
    if (col.type === 'money') return fmtMoney(v);
    return String(v);
  };

  listEl.innerHTML = `
    <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px;font-family:'Share Tech Mono',monospace;">
      <thead>
        <tr style="background:var(--table-head-bg);border-bottom:1px solid var(--border-accent);position:sticky;top:0;z-index:5;">
          <th style="width:${SUMM_IDX_COL_WIDTH};padding:7px 8px;text-align:left;color:var(--accent-cyan);font-size:9px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">#</th>
          ${SUMM_TABLE_COLUMNS.map(c => `<th style="width:${c.width};padding:7px 8px;text-align:left;color:var(--accent-cyan);font-size:9px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.label}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr style="border-bottom:1px solid rgba(26,58,92,0.2);">
            <td style="padding:5px 8px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;">${i + 1}</td>
            ${SUMM_TABLE_COLUMNS.map(c => {
              const disp = cellValue(r, c);
              if (c.type === 'badge') {
                return `<td style="padding:5px 8px;overflow:hidden;"><span style="font-size:9px;padding:1px 6px;border-radius:2px;background:rgba(99,102,241,0.15);color:var(--accent-cyan);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:100%;vertical-align:middle;">${disp}</span></td>`;
              }
              return `<td style="padding:5px 8px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${disp}">${disp}</td>`;
            }).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ================================================================
   SUMMARY — GET PDF (lazy-loads html2canvas + jsPDF from CDN)
   ================================================================ */
function pdLoadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

async function pdDownloadSummaryPDF() {
  const btn    = document.getElementById('pd_get_pdf_btn');
  const target = document.getElementById('summ_sub_content');
  if (!target || target.style.display === 'none') {
    showToast('FETCH SUB-ITEMS FIRST', 'error');
    return;
  }

  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ GENERATING PDF...';

  const itemsPanel = document.getElementById('summ_items_panel');
  const prevMaxH = itemsPanel ? itemsPanel.style.maxHeight : '';
  const prevOvY  = itemsPanel ? itemsPanel.style.overflowY : '';
  if (itemsPanel) { itemsPanel.style.maxHeight = 'none'; itemsPanel.style.overflowY = 'visible'; }

  try {
    await pdLoadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await pdLoadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

    const canvas = await html2canvas(target, {
      backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
      onclone: (clonedDoc) => {
        const style = clonedDoc.createElement('style');
        style.textContent = `
          :root, [data-theme] {
            --bg-dark:#ffffff !important; --bg-panel:#ffffff !important; --bg-card:#ffffff !important;
            --text-primary:#1a1a1a !important; --text-secondary:#333333 !important; --text-muted:#666666 !important;
            --border:#cccccc !important; --border-accent:#999999 !important;
            --table-head-bg:#f2f2f2 !important; --table-row-hover:#f7f7f7 !important; --modal-bg:#ffffff !important;
          }`;
        clonedDoc.head.appendChild(style);
        const clonedTarget = clonedDoc.getElementById('summ_sub_content');
        if (clonedTarget) clonedTarget.style.backgroundColor = '#ffffff';
      },
    });

    if (!canvas.width || !canvas.height) throw new Error('Capture produced an empty canvas');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    const MAX_PAGES = 200;
    let heightLeft = imgH, position = 0, pageCount = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
    heightLeft -= pageH; pageCount++;

    while (heightLeft > 0 && pageCount < MAX_PAGES) {
      position = -(imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH; pageCount++;
    }

    const FOOTER_H = 26;
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, pageH - FOOTER_H, pageW, FOOTER_H, 'F');
    pdf.setDrawColor(210, 210, 210);
    pdf.line(30, pageH - FOOTER_H + 4, pageW - 30, pageH - FOOTER_H + 4);

    const session = getActiveSession();
    const fullName    = session?.user || 'Unknown User';
    const designation = session?.profile?.designation || (session?.role ? session.role.toUpperCase() : '');
    const stampStr = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const sigText = `Generated by: ${fullName}${designation ? ', ' + designation : ''} on ${stampStr}.`;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(90, 90, 90);
    pdf.text(sigText, pageW / 2, pageH - 11, { align: 'center' });

    pdf.save(`DRGSBC_Summary_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('SUMMARY PDF DOWNLOADED');
  } catch (e) {
    console.error('[PD] Summary PDF generation failed:', e);
    showToast('PDF GENERATION FAILED: ' + e.message.slice(0, 60), 'error');
  } finally {
    if (itemsPanel) { itemsPanel.style.maxHeight = prevMaxH; itemsPanel.style.overflowY = prevOvY; }
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Event wiring for the Process tab ──
['pd_f_planhead', 'pd_f_depot', 'pd_f_underpower', 'pd_f_lineitem', 'pd_f_stage', 'pd_f_pending'].forEach(id => {
  document.getElementById(id).addEventListener('change', pdCascadeFilters);
});
document.getElementById('pd_f_subitem').addEventListener('input', (e) => pdSubItemSearch(e.target.value));
document.getElementById('pd_f_subitem').addEventListener('change', (e) => pdSubItemAutoFill(e.target.value));
document.getElementById('pd_fetch_btn').addEventListener('click', pdFetchData);
document.getElementById('pd_reset_btn').addEventListener('click', pdResetFiltersConfirm);
document.getElementById('pd_get_pdf_btn').addEventListener('click', pdDownloadSummaryPDF);
document.querySelectorAll('[data-pdtab]').forEach(btn => {
  btn.addEventListener('click', () => pdSwitchSubTab(btn.dataset.pdtab));
});

/* ================================================================
   BOOT
   ================================================================ */
function bootUpdationPage() {
  applyUtabRbac();
  switchUtab('my-space');
}

renderSessionBadge();
if (renderAuthGate(document.getElementById('pageWrap'), 'page:updation', bootUpdationPage)) {
  bootUpdationPage();
}

window.addEventListener('storage', (e) => {
  if (!e.key) return;
  if (e.key.startsWith('drgsbc_user') || e.key.startsWith('drgsbc_role') || e.key.startsWith('drgsbc_profile')) {
    renderSessionBadge();
    if (renderAuthGate(document.getElementById('pageWrap'), 'page:updation')) {
      applyUtabRbac();
      const activeTab = document.querySelector('#utabStrip .stab.active')?.dataset.utab || 'my-space';
      if (activeTab === 'my-space') buildMySpace();
    }
  }
  if (e.key === 'drgsbc_db_config' && renderAuthGate(document.getElementById('pageWrap'), 'page:updation')) {
    const activeTab = document.querySelector('#utabStrip .stab.active')?.dataset.utab || 'my-space';
    if (activeTab === 'my-space') buildMySpace();
  }
});
