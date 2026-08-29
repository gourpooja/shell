// ================================================================
// drgsbc_procurement.js
// Logic for the standalone Procurement / Dashboard view
// (drgsbc_procurement.html).
//
// Ported from v16's pageDash code (data fetch, filters, search, sort,
// pagination, CSV export, column settings). Adaptations:
//   - DB.fetchProcurement()      → fetchProcurement() below, using
//     nxFetch()/getDbConfig() from core/services.js
//   - currentUser/currentUserRole/window.currentUserProfile → getActiveSession()
//   - rbacFilterRows(rows) was a documented no-op for Dashboard in v16
//     ("All roles see all dashboard rows — access is controlled at
//     page/tab level, not here") — not ported, just not called.
//
// NO DEMO DATA FALLBACK: if neither Nexus nor Google Sheets is
// configured/reachable, this shows an empty state, never synthetic
// data. This is a deliberate standing rule for this and every future
// standalone shell page, not just this one.
// ================================================================

import { showToast, getActiveSession, getDbConfig, nxFetch, renderAuthGate } from './core/services.js';

/* ================================================================
   SESSION BADGE
   ================================================================ */
function renderSessionBadge() {
  const el = document.getElementById('sessionBadge');
  const welcomeEl = document.getElementById('welcomeName');
  if (!el) return; // pageWrap was wiped by auth gate — bail safely
  const session = getActiveSession();
  if (session) {
    el.textContent = `${(session.user || '').toUpperCase()} · ${(session.role || '').toUpperCase()}`;
    if (welcomeEl) welcomeEl.textContent = session.user || '—';
  } else {
    el.textContent = 'NOT SIGNED IN — click your name in the Shell top bar to sign in';
    if (welcomeEl) welcomeEl.textContent = 'Guest';
  }
}

/* ================================================================
   STATE
   ================================================================ */
let allData = [], filteredData = [], searchData = [], allHeaders = [];
let colSettings = {};
let sortCol = null, sortAsc = true;
let currentPage = 1, PAGE_SIZE = 20;
let _colYear, _colHead, _colDepot, _colConsignee, _colUnderPower, _colStatus;

const ROLES_SEE_ALL = new Set(['admin', 'master']);

function parseMultiVal(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  const s = String(val).trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map(String); } catch {}
  }
  return s.split(',').map(v => v.trim()).filter(Boolean);
}

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
// Same as v16: never persisted, resets to defaults every load.
let statusColors = JSON.parse(JSON.stringify(DEFAULT_STATUS_COLORS));

const HEADER_LABELS = {
  code: 'Sl No.', sanction_id: 'Sanction ID', line_item_id: 'Line Item ID',
  under_power: 'Under Power', sanction_detail: 'Sanction Detail', sanctioned_on: 'Sanctioned On',
  sanction_year: 'Sanction Year', plan_head: 'Plan Head', allocation_type: 'Allocation',
  item_no: 'Item No.', item_name: 'Item Name', consignee_depot: 'Consignee Depot',
  processing_depot: 'Processing Depot', sub_item_name: 'Sub-Item Name', item_description: 'Item Description',
  make_model: 'Make / Model', unit: 'Unit', qty: 'Qty', base_price: 'Base Price',
  tax_and_others: 'Tax & Others', unit_price: 'Unit Price', total_value: 'Total Value (Rs.)',
  vetted_cost: 'Vetted Cost', status: 'Status', owner_sse: 'Owner SSE', vendor_name: 'Vendor Name',
  process_stage: 'Process Stage', indent_number: 'Indent / Demand No.', indent_date: 'Indent Date',
  loa_po_number: 'LOA/PO Number', loa_po_date: 'LOA/PO Date', loa_po_cost: 'LOA/PO Cost',
  delivery_due_on: 'Delivery Due On', delivery_date: 'Delivery Date', crn_number: 'CRN / Receipt Note No.',
  crn_date: 'Handover / CRN Date', commissioning_date: 'Commissioning Date', ptc_date: 'PTC Date',
  process_pdc: 'Process PDC', manual_pdc: 'Manual PDC', remarks: 'Remarks',
  next_process_due_on: 'Next Process Due On', pending_with: 'Pending With', bill_amount: 'Bill Amount',
  co6_number: 'CO6', co6_date: 'CO6 Date', co7_number: 'CO7', co7_date: 'CO7 Date',
  latest_grant: 'Latest Grant',
};

/* ================================================================
   FETCH  (Nexus → Sheets → empty. NO demo fallback, ever.)
   ================================================================ */
async function fetchProcurement() {
  const cfg = getDbConfig();

  // 1. Nexus
  if (cfg?.nexus?.url && cfg?.nexus?.key) {
    try {
      const probe = await nxFetch('master_dashboard_view?select=code&limit=1');
      if (!Array.isArray(probe)) throw new Error('View probe returned non-array');

      let allRows = [], offset = 0, batch;
      do {
        batch = await nxFetch(`master_dashboard_view?select=*&order=code.asc&offset=${offset}&limit=1000`);
        if (!Array.isArray(batch)) batch = [];
        allRows = allRows.concat(batch);
        offset += 1000;
      } while (batch.length === 1000);

      return { source: 'nexus', data: allRows };
    } catch (e) {
      console.error('[procurement] Nexus fetch error:', e.message);
      return { source: 'nexus_error', error: e.message, data: [] };
    }
  }

  // 2. Google Sheets fallback
  if (cfg?.sheets?.url) {
    try {
      const resp = await fetch(cfg.sheets.url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      if (json.headers && json.rows) {
        const headers = json.headers.map(h => String(h).trim()).filter(Boolean);
        const data = json.rows
          .filter(r => Object.values(r).some(v => String(v).trim()))
          .map(r => {
            const clean = {};
            headers.forEach(h => { clean[h] = String(r[h] ?? '').trim(); });
            return clean;
          });
        return { source: 'sheets', data, headers };
      }
      throw new Error('Unexpected response structure');
    } catch (e) {
      console.warn('[procurement] Sheets fetch failed:', e.message);
    }
  }

  // 3. Nothing configured/reachable — blank, not demo data.
  return { source: 'none', data: [] };
}

/* ================================================================
   LOAD
   ================================================================ */
async function loadData() {
  const loadingBar = document.getElementById('loadingBar');
  if (loadingBar) loadingBar.classList.add('show');
  const tableBody = document.getElementById('tableBody');
  if (tableBody) tableBody.innerHTML = `
    <tr><td colspan="30"><div class="empty-state">
      <div class="empty-icon" style="animation:loading 1s infinite;">⏳</div>
      <div class="empty-text">FETCHING DATA...</div>
    </div></td></tr>`;

  const result = await fetchProcurement();
  const badge = document.getElementById('dbSourceBadge');
  if (!badge) return; // pageWrap was wiped — abort silently

  if (result.source === 'nexus_error') {
    badge.className = 'db-source-badge none'; badge.textContent = '⚠ VIEW ERROR'; badge.style.display = '';
    showToast('Nexus connected but view fetch failed: ' + result.error.slice(0, 60), 'error');
    allHeaders = []; allData = [];
  } else if (result.source === 'nexus') {
    const headers = result.data.length ? Object.keys(result.data[0]) : [];
    allHeaders = headers;
    allData = result.data.map(r => {
      const clean = {};
      headers.forEach(h => { clean[h] = String(r[h] ?? '').trim(); });
      clean['_id'] = r.code;
      return clean;
    });
    badge.className = 'db-source-badge nexus'; badge.textContent = 'NEXUS LIVE'; badge.style.display = '';
  } else if (result.source === 'sheets') {
    allHeaders = result.headers || Object.keys(result.data[0] || {});
    allData = result.data;
    badge.className = 'db-source-badge sheets'; badge.textContent = 'SHEETS FALLBACK'; badge.style.display = '';
    showToast('Running on Google Sheets fallback — Nexus not configured/reachable.', 'info');
  } else {
    allHeaders = []; allData = [];
    badge.className = 'db-source-badge none'; badge.textContent = 'NO CONNECTION'; badge.style.display = '';
    const tb2 = document.getElementById('tableBody');
    if (tb2) tb2.innerHTML = `
      <tr><td colspan="30"><div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">NO DATABASE CONFIGURED — set up Nexus or Google Sheets in Settings → Database</div>
      </div></td></tr>`;
  }

  if (loadingBar) loadingBar.classList.remove('show');
  buildColSettings();
  populateDropdowns();
  renderTableHead();
  filteredData = [...allData];
  searchData = [...allData];
  updateStats(allData);
  renderTableBody();
  dashCascadeFilters();
}

/* ================================================================
   COLUMN SETTINGS  (folded in here — this is the table it controls)
   ================================================================ */
function buildColSettings() {
  allHeaders.forEach(h => {
    if (!colSettings[h]) colSettings[h] = { visible: true, label: HEADER_LABELS[h] || h.replace(/_/g, ' ') };
  });
  Object.keys(colSettings).forEach(k => { if (!allHeaders.includes(k)) delete colSettings[k]; });
}

function buildColToggleUI() {
  const grid = document.getElementById('colToggleGrid');
  grid.innerHTML = '';
  allHeaders.forEach((h, i) => {
    const s = colSettings[h] || { visible: true, label: h };
    const div = document.createElement('label');
    div.className = 'col-toggle';
    div.innerHTML = `<input type="checkbox" data-col="${h}" ${s.visible ? 'checked' : ''}><span class="col-toggle-label">${s.label || h}</span><span class="col-order">#${i + 1}</span>`;
    grid.appendChild(div);
  });
}

function saveColumnSettings() {
  document.querySelectorAll('#colToggleGrid input[type="checkbox"]').forEach(cb => {
    const col = cb.dataset.col;
    if (colSettings[col]) colSettings[col].visible = cb.checked;
  });
  renderTableHead();
  applyFilters();
  showToast('COLUMN SETTINGS APPLIED');
}

document.getElementById('btnToggleCols').addEventListener('click', () => {
  const panel = document.getElementById('colsPanel');
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) buildColToggleUI();
});
document.getElementById('btnApplyCols').addEventListener('click', saveColumnSettings);

/* ================================================================
   TABLE RENDERING
   ================================================================ */
function renderTableHead() {
  const tr = document.getElementById('tableHead');
  tr.innerHTML = '<th>#</th>';
  allHeaders.filter(h => h !== '_id').forEach(h => {
    const s = colSettings[h] || { visible: true };
    if (!s.visible) return;
    const th = document.createElement('th');
    th.textContent = HEADER_LABELS[h] || h.replace(/_/g, ' ').toUpperCase();
    th.onclick = () => sortByCol(h);
    tr.appendChild(th);
  });
}

function sortByCol(col) {
  if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
  searchData.sort((a, b) => {
    const av = a[col] || '', bv = b[col] || '';
    const an = parseFloat(av.replace(/[^0-9.-]/g, '')), bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
    if (!isNaN(an) && !isNaN(bn)) return sortAsc ? an - bn : bn - an;
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  currentPage = 1; renderTableBody();
}

function renderBadge(status) {
  const sc = statusColors[status] || statusColors[Object.keys(statusColors).find(k => k.toLowerCase() === status.toLowerCase())];
  if (!sc) return `<span class="badge" style="background:rgba(100,100,100,0.15);color:#aaa;border:1px solid rgba(100,100,100,0.3);">${status}</span>`;
  return `<span class="badge" style="background:${sc.bg};color:${sc.text};border:1px solid ${sc.border};">${status}</span>`;
}

function highlightDashRow(tr) {
  document.querySelectorAll('#tableBody tr.dash-row-highlight').forEach(r => r.classList.remove('dash-row-highlight'));
  tr.classList.add('dash-row-highlight');
}

function renderTableBody() {
  const tbody = document.getElementById('tableBody');
  const footer = document.getElementById('tableFooter');
  const countEl = document.getElementById('recordCount');
  countEl.textContent = searchData.length + ' RECORDS';

  if (!searchData.length) {
    tbody.innerHTML = `<tr><td colspan="30"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">NO RECORDS MATCH SELECTED FILTERS</div></div></td></tr>`;
    footer.style.display = 'none';
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = searchData.slice(start, start + PAGE_SIZE);
  const statusCol = _colStatus || 'Current Status';

  tbody.innerHTML = pageData.map((r, i) => `
    <tr onclick="window._dashHighlight(this)" style="cursor:pointer;" title="Click to highlight this row">
      <td class="mono">${start + i + 1}</td>
      ${allHeaders.filter(h => h !== '_id').map(h => {
        const s = colSettings[h] || { visible: true };
        if (!s.visible) return '';
        const v = r[h] || '—';
        if (h === statusCol) return `<td>${renderBadge(v)}</td>`;
        return `<td>${v}</td>`;
      }).join('')}
    </tr>
  `).join('');
  // Expose for the inline onclick above (kept inline to match v16's row markup 1:1)
  window._dashHighlight = highlightDashRow;

  const totalPages = Math.ceil(searchData.length / PAGE_SIZE);
  document.getElementById('pageInfo').textContent =
    `SHOWING ${start + 1}–${Math.min(start + PAGE_SIZE, searchData.length)} OF ${searchData.length} RECORDS`;
  const pb = document.getElementById('pageBtns');
  pb.innerHTML = '';
  const maxBtns = 9;
  let pagesToShow = [];
  if (totalPages <= maxBtns) {
    for (let i = 1; i <= totalPages; i++) pagesToShow.push(i);
  } else {
    pagesToShow = [1];
    let lo = Math.max(2, currentPage - 3), hi = Math.min(totalPages - 1, currentPage + 3);
    if (lo > 2) pagesToShow.push('…');
    for (let i = lo; i <= hi; i++) pagesToShow.push(i);
    if (hi < totalPages - 1) pagesToShow.push('…');
    pagesToShow.push(totalPages);
  }
  pagesToShow.forEach(p => {
    if (p === '…') {
      const sp = document.createElement('span');
      sp.textContent = '…'; sp.style.cssText = 'color:var(--text-muted);padding:3px 6px;font-size:12px;';
      pb.appendChild(sp);
    } else {
      const btn = document.createElement('button');
      btn.className = 'page-btn' + (p === currentPage ? ' active' : '');
      btn.textContent = p;
      btn.onclick = (pp => () => { currentPage = pp; renderTableBody(); })(p);
      pb.appendChild(btn);
    }
  });
  footer.style.display = 'flex';
}

document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
  PAGE_SIZE = parseInt(e.target.value) || 20;
  currentPage = 1;
  renderTableBody();
});

/* ================================================================
   FILTERS / SEARCH
   ================================================================ */
function truncOpt(v, max = 50) { return v && v.length > max ? v.slice(0, max) + '...' : v; }

function fillDropdown(id, colKey) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  if (!colKey) return;
  const unique = [...new Set(allData.map(r => r[colKey]).filter(v => v && v.trim()))].sort();
  unique.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = truncOpt(v); sel.appendChild(o);
  });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function populateDropdowns() {
  const find = (...cands) => allHeaders.find(h => cands.some(c => c.toLowerCase() === h.toLowerCase())) || null;
  _colYear = find('sanction_year', 'Sanction Year', 'year');
  _colHead = find('plan_head', 'Plan Head', 'planhead');
  _colDepot = find('processing_depot', 'Processing Depot', 'depot');
  _colConsignee = find('consignee_depot', 'Consignee Depot', 'consigneedepot');
  _colUnderPower = find('under_power', 'Under Power', 'underpower');
  _colStatus = find('process_stage', 'status', 'Current Status', 'state');

  fillDropdown('filterYear', _colYear);
  fillDropdown('filterHead', _colHead);
  fillDropdown('filterDepot', _colDepot);
  fillDropdown('filterConsignee', _colConsignee);
  fillDropdown('filterUnderPower', _colUnderPower);
  fillDropdown('filterStatus', _colStatus);

  // Auto-assign filters from profile if the user has exactly one assigned
  // (same convenience behaviour as v16) — admin/master never auto-filtered.
  const session = getActiveSession();
  if (session && !ROLES_SEE_ALL.has(session.role)) {
    const myPlanHeads = parseMultiVal(session.profile?.planHeads);
    const myDepots = parseMultiVal(session.profile?.depots);
    const ph = document.getElementById('filterHead');
    const dep = document.getElementById('filterDepot');
    const cons = document.getElementById('filterConsignee');
    if (myPlanHeads.length === 1 && ph && [...ph.options].some(o => o.value === myPlanHeads[0])) ph.value = myPlanHeads[0];
    if (myDepots.length === 1 && dep && [...dep.options].some(o => o.value === myDepots[0])) dep.value = myDepots[0];
    if (cons) {
      if (myDepots.length === 1 && [...cons.options].some(o => o.value === myDepots[0])) cons.value = myDepots[0];
      else cons.value = 'ALL';
    }
  }
}

const DASH_FILTER_MAP = {
  filterYear: () => _colYear, filterHead: () => _colHead, filterDepot: () => _colDepot,
  filterConsignee: () => _colConsignee, filterUnderPower: () => _colUnderPower, filterStatus: () => _colStatus,
};

function dashCascadeFilters() {
  const selections = {};
  Object.keys(DASH_FILTER_MAP).forEach(id => {
    const el = document.getElementById(id);
    selections[id] = el ? el.value : 'ALL';
  });

  Object.keys(DASH_FILTER_MAP).forEach(id => {
    const colKey = DASH_FILTER_MAP[id]();
    if (!colKey) return;
    const subset = allData.filter(r => Object.keys(selections).every(otherId => {
      if (otherId === id) return true;
      const otherVal = selections[otherId];
      if (otherVal === 'ALL' || !otherVal) return true;
      const otherCol = DASH_FILTER_MAP[otherId]();
      if (!otherCol) return true;
      return r[otherCol] === otherVal;
    }));
    const unique = [...new Set(subset.map(r => r[colKey]).filter(v => v && v.trim()))].sort();
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    unique.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = truncOpt(v); sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'ALL';
  });

  applyFilters();
}

function applyFilters() {
  const y = document.getElementById('filterYear').value;
  const h = document.getElementById('filterHead').value;
  const d = document.getElementById('filterDepot').value;
  const cd = document.getElementById('filterConsignee')?.value || 'ALL';
  const up = document.getElementById('filterUnderPower')?.value || 'ALL';
  const s = document.getElementById('filterStatus').value;

  filteredData = allData.filter(r =>
    (y === 'ALL' || r[_colYear] === y) &&
    (h === 'ALL' || r[_colHead] === h) &&
    (d === 'ALL' || r[_colDepot] === d) &&
    (cd === 'ALL' || r[_colConsignee] === cd) &&
    (up === 'ALL' || r[_colUnderPower] === up) &&
    (s === 'ALL' || r[_colStatus] === s)
  );

  currentPage = 1; sortCol = null;
  document.getElementById('tableSearch').value = '';
  searchData = [...filteredData];
  updateFilterTag(y, h, d, cd, up, s);
  updateStats(filteredData);
  renderTableBody();
}

function applySearch() {
  const q = document.getElementById('tableSearch').value.trim().toLowerCase();
  searchData = !q ? [...filteredData] : filteredData.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(q))
  );
  currentPage = 1;
  renderTableBody();
}

function resetFilters() {
  ['filterYear', 'filterHead', 'filterDepot', 'filterConsignee', 'filterUnderPower', 'filterStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'ALL';
  });
  document.getElementById('tableSearch').value = '';
  dashCascadeFilters();
}

function updateFilterTag(y, h, d, cd, up, s) {
  const p = [];
  if (y !== 'ALL') p.push('YR:' + y);
  if (h !== 'ALL') p.push('HEAD:' + h);
  if (d !== 'ALL') p.push('PRO:' + d);
  if (cd && cd !== 'ALL') p.push('CON:' + cd);
  if (up && up !== 'ALL') p.push('UP:' + up.slice(0, 20));
  if (s !== 'ALL') p.push(s.toUpperCase());
  document.getElementById('filterTag').textContent = p.length ? p.join(' | ') : 'ALL RECORDS';
}

function updateStats(data) {
  const sc = _colStatus || 'process_stage';
  document.getElementById('statTotal').textContent = data.length;
  document.getElementById('statPO').textContent = data.filter(r => ['PO/LOA Issued', 'PO/LOA issued'].includes(r[sc])).length;
  document.getElementById('statDel').textContent = data.filter(r => r[sc] === 'Item Delivered').length;
  document.getElementById('statBill').textContent = data.filter(r => ['Bill Passed', 'Work Completed', 'Work completed'].includes(r[sc])).length;
}

document.getElementById('filterYear').addEventListener('change', dashCascadeFilters);
document.getElementById('filterHead').addEventListener('change', dashCascadeFilters);
document.getElementById('filterDepot').addEventListener('change', dashCascadeFilters);
document.getElementById('filterConsignee').addEventListener('change', dashCascadeFilters);
document.getElementById('filterUnderPower').addEventListener('change', dashCascadeFilters);
document.getElementById('filterStatus').addEventListener('change', dashCascadeFilters);
document.getElementById('tableSearch').addEventListener('input', applySearch);
document.getElementById('btnFetchData').addEventListener('click', applyFilters);
document.getElementById('btnResetFilters').addEventListener('click', resetFilters);

/* ================================================================
   CSV EXPORT
   ================================================================ */
function exportCSV() {
  const src = searchData.length ? searchData : (filteredData.length ? filteredData : allData);
  if (!src.length) { showToast('No data to export.', 'error'); return; }
  const visibleCols = allHeaders.filter(h => h !== '_id' && (colSettings[h] || { visible: true }).visible);
  const rows = [visibleCols.join(','), ...src.map(r =>
    visibleCols.map(h => `"${(r[h] || '').replace(/"/g, '""')}"`).join(',')
  )];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
  a.download = `DRGSBC_Procurement_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('CSV EXPORTED');
}
document.getElementById('btnExportCsv').addEventListener('click', exportCSV);

/* ================================================================
   BOOT
   ================================================================ */
renderSessionBadge();
if (renderAuthGate(document.getElementById('pageWrap'), 'page:dash', loadData)) {
  loadData();
}

window.addEventListener('storage', (e) => {
  if (e.key && (e.key.startsWith('drgsbc_user') || e.key.startsWith('drgsbc_role') || e.key.startsWith('drgsbc_profile'))) {
    renderSessionBadge();
  }
  if (e.key === 'drgsbc_db_config' && renderAuthGate(document.getElementById('pageWrap'), 'page:dash')) {
    loadData();
  }
});
