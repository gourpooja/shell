// ================================================================
// drgsbc_report.js
// Custom Report Builder — DRGSBC Shell
//
// Data source : master_dashboard_view (PostgreSQL/NEXUS)
// Persistence : saved_reports table (JSONB definition column)
// All filtering, calc fields, grouping, sorting: client-side
// ================================================================

import { nxFetch, getActiveSession, showToast, fmtDate,
         isAdminRole, renderAuthGate } from '../core/services.js';

// ── 0. CONSTANTS ─────────────────────────────────────────────────
const VIEW  = 'master_dashboard_view';
const TABLE = 'saved_reports';
const FETCH_LIMIT = 5000;

// ── 1. FIELD DEFINITIONS ─────────────────────────────────────────
const FIELD_GROUPS = [
  { group: 'SANCTION', fields: [
    { field:'sanction_id',           label:'Sanction ID',        type:'id'   },
    { field:'code',                  label:'Code',               type:'ref'  },
    { field:'under_power',           label:'Under Power',        type:'cat'  },
    { field:'original_sanction_name',label:'Sanction Name',      type:'text' },
    { field:'sanction_year',         label:'Financial Year',     type:'cat'  },
    { field:'plan_head',             label:'Plan Head',          type:'cat'  },
    { field:'allocation_type',       label:'Allocation Type',    type:'cat'  },
    { field:'sanctioned_amount',     label:'Sanctioned Amount',  type:'num'  },
    { field:'sanction_state',        label:'Sanction State',     type:'cat'  },
    { field:'sanction_remarks',      label:'Sanction Remarks',   type:'text' },
  ]},
  { group: 'LINE ITEM', fields: [
    { field:'line_item_id',          label:'Line Item ID',       type:'id'   },
    { field:'item_name',             label:'Item Name',          type:'text' },
    { field:'item_description',      label:'Item Description',   type:'text' },
    { field:'unit',                  label:'Unit',               type:'cat'  },
    { field:'line_qty',              label:'Line Quantity',      type:'num'  },
    { field:'unit_rate',             label:'Unit Rate',          type:'num'  },
    { field:'line_total',            label:'Line Total',         type:'num'  },
    { field:'department',            label:'Department',         type:'cat'  },
  ]},
  { group: 'SUB ITEM', fields: [
    { field:'sub_item_id',           label:'Sub Item ID',        type:'id'   },
    { field:'sub_item_name',         label:'Sub Item Name',      type:'text' },
    { field:'consignee_depot',       label:'Consignee Depot',    type:'cat'  },
    { field:'processing_depot',      label:'Processing Depot',   type:'cat'  },
    { field:'sub_qty',               label:'Sub Quantity',       type:'num'  },
    { field:'vetted_cost',           label:'Vetted Cost',        type:'num'  },
    { field:'sub_total',             label:'Sub Total',          type:'num'  },
    { field:'status',                label:'Status',             type:'cat'  },
    { field:'sub_state',             label:'Sub State',          type:'cat'  },
    { field:'sub_remarks',           label:'Sub Remarks',        type:'text' },
    { field:'latest_grant',          label:'Latest Grant',       type:'num'  },
  ]},
  { group: 'PROCESS', fields: [
    { field:'process_id',            label:'Process ID',         type:'id'   },
    { field:'process_stage',         label:'Process Stage',      type:'cat'  },
    { field:'process_pdc',           label:'Process PDC',        type:'date' },
    { field:'next_process_due_on',   label:'Next Due Date',      type:'date' },
    { field:'pending_with',          label:'Pending With',       type:'cat'  },
    { field:'owner_sse',             label:'Owner SSE',          type:'text' },
    { field:'vendor_name',           label:'Vendor Name',        type:'text' },
    { field:'indent_number',         label:'Indent Number',      type:'ref'  },
    { field:'indent_date',           label:'Indent Date',        type:'date' },
    { field:'loa_po_number',         label:'LOA/PO Number',      type:'ref'  },
    { field:'loa_po_date',           label:'LOA/PO Date',        type:'date' },
    { field:'delivery_due_on',       label:'Delivery Due On',    type:'date' },
    { field:'delivery_date',         label:'Delivery Date',      type:'date' },
    { field:'crn_number',            label:'CRN Number',         type:'ref'  },
    { field:'crn_date',              label:'CRN Date',           type:'date' },
    { field:'commissioning_date',    label:'Commissioning Date', type:'date' },
    { field:'ptc_date',              label:'PTC Date',           type:'date' },
    { field:'process_remarks',       label:'Process Remarks',    type:'text' },
  ]},
  { group: 'BILLING', fields: [
    { field:'bill_id',               label:'Bill ID',            type:'id'   },
    { field:'total_bills',           label:'Total Bills',        type:'num'  },
    { field:'bill_number',           label:'Bill Number',        type:'ref'  },
    { field:'bill_amount',           label:'Bill Amount',        type:'num'  },
    { field:'bill_date',             label:'Bill Date',          type:'date' },
    { field:'co6_number',            label:'CO6 Number',         type:'ref'  },
    { field:'co7_number',            label:'CO7 Number',         type:'ref'  },
    { field:'payment_date',          label:'Payment Date',       type:'date' },
    { field:'bill_description',      label:'Bill Description',   type:'text' },
  ]},
];

const FIELD_MAP = {};
FIELD_GROUPS.forEach(g => g.fields.forEach(f => { FIELD_MAP[f.field] = f; }));

const CAT_FIELDS   = Object.values(FIELD_MAP).filter(f => f.type === 'cat').map(f => f.field);
const NUM_FIELDS   = Object.values(FIELD_MAP).filter(f => f.type === 'num').map(f => f.field);
const DATE_FIELDS  = Object.values(FIELD_MAP).filter(f => f.type === 'date').map(f => f.field);
const ALL_FIELDS   = Object.values(FIELD_MAP);

// ── 2. STATE ─────────────────────────────────────────────────────
const S = {
  reportId: null,
  isOwner: true,
  shareType: 'none',
  sharedWithUsers: [],
  sharedWithTeams: [],
  columns: [],        // [{ field, label, visible }]
  calcFields: [],     // [{ id, label, slotA, op1, slotB, op2, slotC, bracketFirst, format }]
  filters: [],        // [{ id, field, op, value, join }]
  groupBy: '',
  aggregations: [],   // [{ id, field, fn, label }]
  sortRules: [],      // [{ id, field, dir }]
  rawData: [],
  processedData: [],
  page: 1,
  rowsPerPage: 50,
  _dragSrc: null,
};

let _session = null;
let _allUsers = [];
let _allTeams = [];

// ── 3. HELPERS ────────────────────────────────────────────────────
function uid() { return `_${Math.random().toString(36).slice(2, 8)}`; }

function loading(show) {
  document.getElementById('loadingBar').classList.toggle('show', show);
}

function toast(msg, type = 'success') {
  const el = document.getElementById('rpToast');
  const colors = { success: 'var(--accent-green)', error: 'var(--accent-red)', info: 'var(--accent-blue)' };
  el.style.background = colors[type] || colors.success;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 2800);
}

function fmtNum(v) {
  const n = Number(v);
  return isNaN(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtCurrency(v) {
  const n = Number(v);
  return isNaN(n) ? '—' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtPct(v) {
  const n = Number(v);
  return isNaN(n) ? '—' : n.toFixed(2) + '%';
}

function formatCellValue(field, value, calcFmt) {
  if (value === null || value === undefined || value === '') return '—';
  if (calcFmt === 'currency') return fmtCurrency(value);
  if (calcFmt === 'percent')  return fmtPct(value);
  if (calcFmt === 'number')   return fmtNum(value);
  const def = FIELD_MAP[field];
  if (!def) return String(value);
  if (def.type === 'date') return fmtDate(value);
  if (def.type === 'num')  return fmtNum(value);
  return String(value);
}

function getFieldType(field) {
  return FIELD_MAP[field]?.type || 'text';
}

// ── 4. INIT ──────────────────────────────────────────────────────
async function init() {
  _session = getActiveSession();
  const badge = document.getElementById('sessionBadge');

  if (!_session) {
    badge.textContent = 'NOT SIGNED IN';
    renderAuthGate(document.getElementById('rpMain'), 'page:dash', init);
    return;
  }

  badge.textContent = `${(_session.user || '').toUpperCase()} · ${(_session.role || '').toUpperCase()}`;

  wireEvents();
  buildFieldLibrary();
  populateGroupByAndSortSelects();
  await loadSidebar();
}

// ── 5. EVENT WIRING ───────────────────────────────────────────────
function wireEvents() {
  // Config tabs
  document.querySelectorAll('.rp-ctab[data-ctab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rp-ctab[data-ctab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.rp-ctab-content').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`rp-ctab-${btn.dataset.ctab}`).classList.add('active');
    });
  });

  // Collapse/expand config
  document.getElementById('btnConfigToggle').addEventListener('click', () => {
    const body = document.getElementById('rpConfigBody');
    const btn  = document.getElementById('btnConfigToggle');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    btn.textContent = collapsed ? '▲ COLLAPSE' : '▼ EXPAND';
  });

  // New report
  document.getElementById('btnNewReport').addEventListener('click', newReport);

  // Save
  document.getElementById('btnSaveReport').addEventListener('click', saveReport);

  // Copy as mine
  document.getElementById('btnCopyReport').addEventListener('click', copyAsMine);

  // Share
  document.getElementById('btnShareReport').addEventListener('click', openShareModal);
  document.getElementById('btnShareClose').addEventListener('click', closeShareModal);
  document.getElementById('btnShareCancel').addEventListener('click', closeShareModal);
  document.getElementById('btnShareApply').addEventListener('click', applyShare);

  // Share type radio buttons
  document.querySelectorAll('input[name="shareType"]').forEach(radio => {
    radio.addEventListener('change', updateShareTargetVisibility);
  });

  // Delete
  document.getElementById('btnDeleteReport').addEventListener('click', openDeleteConfirm);
  document.getElementById('btnConfirmCancel').addEventListener('click', closeDeleteConfirm);
  document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);

  // Run report
  document.getElementById('btnApply').addEventListener('click', runReport);

  // Rows per page
  document.getElementById('rpRowsPerPage').addEventListener('change', e => {
    S.rowsPerPage = parseInt(e.target.value) || 0;
    S.page = 1;
    renderPreviewTable();
  });

  // Pagination
  document.getElementById('btnPrevPage').addEventListener('click', () => { S.page--; renderPreviewTable(); });
  document.getElementById('btnNextPage').addEventListener('click', () => { S.page++; renderPreviewTable(); });

  // Add rules
  document.getElementById('btnAddFilter').addEventListener('click', addFilter);
  document.getElementById('btnAddCalc').addEventListener('click', addCalcField);
  document.getElementById('btnAddSort').addEventListener('click', addSortRule);
  document.getElementById('btnAddAgg').addEventListener('click', addAggRule);

  // Group-by select
  document.getElementById('rpGroupBy').addEventListener('change', e => {
    S.groupBy = e.target.value;
    renderAggList();
  });

  // Clear all columns
  document.getElementById('btnClearCols').addEventListener('click', () => {
    S.columns = [];
    renderActiveCols();
    syncFieldLibraryAdded();
  });

  // Export
  document.getElementById('btnExportXlsx').addEventListener('click', exportXlsx);
  document.getElementById('btnExportPdf').addEventListener('click', exportPdf);
  document.getElementById('btnPrint').addEventListener('click', printReport);

  // Name input
  document.getElementById('rpNameInput').addEventListener('input', e => {
    document.getElementById('rpPrintTitle').textContent = e.target.value || 'Untitled Report';
  });
}

// ── 6. SIDEBAR ────────────────────────────────────────────────────
async function loadSidebar() {
  if (!_session) return;
  const username = _session.profile?.username || _session.user;
  try {
    loading(true);

    // My reports
    const mine = await nxFetch(
      `${TABLE}?created_by=eq.${encodeURIComponent(username)}&order=updated_at.desc&select=id,name,share_type,updated_at`
    ).catch(() => []);
    renderSidebarSection('myReportsList', mine || [], false);

    // Shared with me: share_type=all, or my username in shared_with_users, or my team in shared_with_teams
    const team = _session.profile?.team || '';
    let sharedQuery = `${TABLE}?created_by=neq.${encodeURIComponent(username)}&order=updated_at.desc&select=id,name,share_type,created_by,updated_at`;
    const shared = await nxFetch(sharedQuery).catch(() => []);
    const visibleShared = (shared || []).filter(r => {
      if (r.share_type === 'all') return true;
      if (r.share_type === 'users' && Array.isArray(r.shared_with_users) && r.shared_with_users.includes(username)) return true;
      if (r.share_type === 'teams' && team && Array.isArray(r.shared_with_teams) && r.shared_with_teams.includes(team)) return true;
      return false;
    });
    renderSidebarSection('sharedReportsList', visibleShared, true);

  } catch (e) {
    toast('Error loading reports: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

function renderSidebarSection(elId, reports, isShared) {
  const el = document.getElementById(elId);
  if (!reports.length) {
    el.innerHTML = `<div class="rp-sidebar-empty">${isShared ? 'NONE SHARED WITH YOU' : 'NO REPORTS YET'}</div>`;
    return;
  }
  el.innerHTML = reports.map(r => {
    let badge = '';
    if (r.share_type === 'all')   badge = `<span class="rp-share-badge rsb-all">ALL</span>`;
    if (r.share_type === 'teams') badge = `<span class="rp-share-badge rsb-teams">TEAM</span>`;
    if (r.share_type === 'users') badge = `<span class="rp-share-badge rsb-users">SHARED</span>`;
    const owner = isShared ? `<span class="rp-share-badge" style="color:var(--text-muted);border-color:rgba(100,100,120,.3);">${(r.created_by||'').toUpperCase()}</span>` : '';
    return `<div class="rp-report-item" data-id="${r.id}" data-shared="${isShared}">
      <span class="rp-report-name" title="${r.name}">${r.name}</span>
      ${owner}${badge}
    </div>`;
  }).join('');

  el.querySelectorAll('.rp-report-item').forEach(item => {
    item.addEventListener('click', () => loadReport(parseInt(item.dataset.id), item.dataset.shared === 'true'));
  });
}

function highlightSidebarItem(id) {
  document.querySelectorAll('.rp-report-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id) === id);
  });
}

// ── 7. NEW REPORT ─────────────────────────────────────────────────
function newReport() {
  resetState();
  showBuilder(true);
  document.getElementById('rpNameInput').value = 'Untitled Report';
  document.getElementById('rpPrintTitle').textContent = 'Untitled Report';
  document.getElementById('rpOwnerHint').textContent = '';
  setOwnerMode(true);
  document.querySelectorAll('.rp-report-item').forEach(el => el.classList.remove('active'));
  renderAll();
  clearPreview();
}

function resetState() {
  S.reportId = null;
  S.isOwner = true;
  S.shareType = 'none';
  S.sharedWithUsers = [];
  S.sharedWithTeams = [];
  S.columns = [];
  S.calcFields = [];
  S.filters = [];
  S.groupBy = '';
  S.aggregations = [];
  S.sortRules = [];
  S.rawData = [];
  S.processedData = [];
  S.page = 1;
  document.getElementById('rpGroupBy').value = '';
  document.getElementById('rpRowsPerPage').value = '50';
  S.rowsPerPage = 50;
}

function showBuilder(show) {
  document.getElementById('rpEmptyState').style.display = show ? 'none' : 'flex';
  document.getElementById('rpBuilder').style.display = show ? 'flex' : 'none';
}

function setOwnerMode(isOwner) {
  S.isOwner = isOwner;
  document.getElementById('btnSaveReport').style.display = isOwner ? '' : 'none';
  document.getElementById('btnShareReport').style.display = isOwner ? '' : 'none';
  document.getElementById('btnCopyReport').style.display = isOwner ? 'none' : '';
}

function checkCanDelete() {
  const role = _session?.role || '';
  return S.isOwner || role === 'admin' || role === 'master';
}

// ── 8. LOAD REPORT ────────────────────────────────────────────────
async function loadReport(id, isShared) {
  try {
    loading(true);
    const rows = await nxFetch(`${TABLE}?id=eq.${id}&select=*`);
    if (!rows || !rows.length) { toast('Report not found', 'error'); return; }
    const r = rows[0];

    resetState();
    S.reportId = r.id;
    S.shareType = r.share_type || 'none';
    S.sharedWithUsers = r.shared_with_users || [];
    S.sharedWithTeams = r.shared_with_teams || [];

    const username = _session.profile?.username || _session.user;
    const ownerOfRecord = r.created_by === username;
    setOwnerMode(ownerOfRecord);

    if (checkCanDelete() && !ownerOfRecord) {
      document.getElementById('btnDeleteReport').style.display = '';
    } else if (ownerOfRecord) {
      document.getElementById('btnDeleteReport').style.display = '';
    } else {
      document.getElementById('btnDeleteReport').style.display = 'none';
    }

    const def = typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition;
    populateFromDefinition(def);

    document.getElementById('rpNameInput').value = r.name || 'Untitled';
    document.getElementById('rpPrintTitle').textContent = r.name || 'Untitled';
    if (!ownerOfRecord) {
      document.getElementById('rpOwnerHint').textContent = `BY ${(r.created_by||'').toUpperCase()}`;
    } else {
      document.getElementById('rpOwnerHint').textContent = '';
    }

    showBuilder(true);
    highlightSidebarItem(id);
    renderAll();
    clearPreview();

  } catch (e) {
    toast('Failed to load report: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

function populateFromDefinition(def) {
  if (!def) return;
  S.columns      = Array.isArray(def.columns)          ? def.columns      : [];
  S.calcFields   = Array.isArray(def.calculated_fields)? def.calculated_fields : [];
  S.filters      = Array.isArray(def.filters)          ? def.filters      : [];
  S.groupBy      = def.grouping?.group_by || '';
  S.aggregations = Array.isArray(def.grouping?.aggregations) ? def.grouping.aggregations : [];
  S.sortRules    = Array.isArray(def.sort)             ? def.sort         : [];
  S.rowsPerPage  = def.rows_per_page || 50;

  document.getElementById('rpGroupBy').value = S.groupBy || '';
  const rppEl = document.getElementById('rpRowsPerPage');
  rppEl.value = String(S.rowsPerPage);
  if (!rppEl.value) rppEl.value = '50';
}

// ── 9. RENDER ALL CONFIG UI ───────────────────────────────────────
function renderAll() {
  syncFieldLibraryAdded();
  renderActiveCols();
  renderCalcList();
  renderFilterList();
  renderAggList();
  renderSortList();
}

// ── 10. FIELD LIBRARY ─────────────────────────────────────────────
function buildFieldLibrary() {
  const el = document.getElementById('rpFieldLibrary');
  const total = ALL_FIELDS.length;
  document.getElementById('fieldLibCount').textContent = `${total} FIELDS`;

  el.innerHTML = FIELD_GROUPS.map(g => `
    <div class="rp-field-group-head">${g.group}</div>
    ${g.fields.map(f => `
      <div class="rp-field-item" data-field="${f.field}" title="Click to add · ${f.field}">
        <span class="rp-field-label">${f.label}</span>
        <span class="rp-type-badge rtb-${f.type}">${f.type.toUpperCase()}</span>
      </div>
    `).join('')}
  `).join('');

  el.querySelectorAll('.rp-field-item').forEach(item => {
    item.addEventListener('click', () => addColumn(item.dataset.field));
  });
}

function syncFieldLibraryAdded() {
  const addedFields = new Set(S.columns.map(c => c.field));
  document.querySelectorAll('#rpFieldLibrary .rp-field-item').forEach(item => {
    item.classList.toggle('added', addedFields.has(item.dataset.field));
    item.title = addedFields.has(item.dataset.field)
      ? `Already added · ${item.dataset.field}`
      : `Click to add · ${item.dataset.field}`;
  });
}

function addColumn(field) {
  if (S.columns.find(c => c.field === field)) { toast('Already added', 'info'); return; }
  if (!S.isOwner) { toast('VIEW ONLY — Save a copy to edit', 'info'); return; }
  const def = FIELD_MAP[field];
  S.columns.push({ field, label: def?.label || field, visible: true });
  renderActiveCols();
  syncFieldLibraryAdded();
}

// ── 11. ACTIVE COLUMNS (DRAG & DROP) ─────────────────────────────
function renderActiveCols() {
  const el = document.getElementById('rpActiveCols');
  const empty = document.getElementById('rpActiveEmpty');
  document.getElementById('activeColCount').textContent = `${S.columns.length}`;

  if (!S.columns.length) {
    empty.style.display = '';
    el.querySelectorAll('.rp-col-row').forEach(r => r.remove());
    return;
  }
  empty.style.display = 'none';

  // Remove existing rows, rebuild
  el.querySelectorAll('.rp-col-row').forEach(r => r.remove());

  S.columns.forEach((col, idx) => {
    const row = document.createElement('div');
    row.className = 'rp-col-row';
    row.draggable = true;
    row.dataset.idx = idx;
    row.innerHTML = `
      <span class="rp-drag-handle" title="Drag to reorder">⠿</span>
      <input class="rp-col-rename" type="text" value="${col.label}" placeholder="${col.label}" ${!S.isOwner ? 'disabled' : ''}>
      <span class="rp-col-field" title="${col.field}">${col.field}</span>
      <input class="rp-col-vis" type="checkbox" title="Toggle visibility" ${col.visible ? 'checked' : ''} ${!S.isOwner ? 'disabled' : ''}>
      <button class="btn-rm-col" title="Remove column" ${!S.isOwner ? 'disabled' : ''}>✕</button>
    `;

    // Rename
    row.querySelector('.rp-col-rename').addEventListener('change', e => {
      S.columns[idx].label = e.target.value || S.columns[idx].field;
    });

    // Visibility
    row.querySelector('.rp-col-vis').addEventListener('change', e => {
      S.columns[idx].visible = e.target.checked;
    });

    // Remove
    row.querySelector('.btn-rm-col').addEventListener('click', () => {
      S.columns.splice(idx, 1);
      renderActiveCols();
      syncFieldLibraryAdded();
    });

    // Drag events
    row.addEventListener('dragstart', e => {
      S._dragSrc = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.style.opacity = '0.4', 0);
    });
    row.addEventListener('dragend', () => { row.style.opacity = '1'; });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.querySelectorAll('.rp-col-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const src = S._dragSrc;
      const tgt = idx;
      if (src === null || src === tgt) return;
      const [moved] = S.columns.splice(src, 1);
      S.columns.splice(tgt, 0, moved);
      S._dragSrc = null;
      renderActiveCols();
    });

    el.appendChild(row);
  });
}

// ── 12. CALC FIELDS ───────────────────────────────────────────────
function addCalcField() {
  if (!S.isOwner) { toast('VIEW ONLY — Save a copy to edit', 'info'); return; }
  S.calcFields.push({
    id: uid(),
    label: 'Calc Field',
    slotA: { type: 'field', value: '' },
    op1: '-',
    slotB: { type: 'field', value: '' },
    op2: '',
    slotC: { type: 'field', value: '' },
    bracketFirst: true,
    format: 'number',
  });
  renderCalcList();
}

function renderCalcList() {
  const el = document.getElementById('rpCalcList');
  el.innerHTML = '';
  S.calcFields.forEach((cf, idx) => {
    const div = document.createElement('div');
    div.className = 'rp-calc-row';

    const fieldOptions = ALL_FIELDS.filter(f => f.type === 'num')
      .map(f => `<option value="${f.field}" ${f.field === '?' ? 'selected' : ''}>${f.label}</option>`)
      .join('');

    const slotHtml = (slot, name) => {
      const isField = slot.type !== 'constant';
      return `
        <select class="rp-calc-op slot-type-${name}" ${!S.isOwner ? 'disabled' : ''}>
          <option value="field" ${isField ? 'selected' : ''}>FIELD</option>
          <option value="constant" ${!isField ? 'selected' : ''}>VALUE</option>
        </select>
        ${isField
          ? `<select class="rp-calc-operand slot-val-${name}" ${!S.isOwner ? 'disabled' : ''}>
               <option value="">— select —</option>${fieldOptions}
             </select>`
          : `<input class="rp-calc-const slot-val-${name}" type="number" value="${slot.value || 0}" ${!S.isOwner ? 'disabled' : ''}>`
        }`;
    };

    div.innerHTML = `
      <input class="rp-calc-name" type="text" value="${cf.label}" placeholder="Field name" ${!S.isOwner ? 'disabled' : ''}>
      <div class="rp-calc-expr">
        ${slotHtml(cf.slotA, 'A')}
        <select class="rp-calc-op op1-sel" ${!S.isOwner ? 'disabled' : ''}>
          <option value="+" ${cf.op1==='+' ? 'selected' : ''}>＋</option>
          <option value="-" ${cf.op1==='-' ? 'selected' : ''}>－</option>
          <option value="*" ${cf.op1==='*' ? 'selected' : ''}>×</option>
          <option value="/" ${cf.op1==='/' ? 'selected' : ''}>÷</option>
        </select>
        ${slotHtml(cf.slotB, 'B')}
        <select class="rp-calc-op op2-sel" title="Second operator (optional)" ${!S.isOwner ? 'disabled' : ''}>
          <option value="" ${!cf.op2 ? 'selected' : ''}>— stop —</option>
          <option value="+" ${cf.op2==='+' ? 'selected' : ''}>＋</option>
          <option value="-" ${cf.op2==='-' ? 'selected' : ''}>－</option>
          <option value="*" ${cf.op2==='*' ? 'selected' : ''}>×</option>
          <option value="/" ${cf.op2==='/' ? 'selected' : ''}>÷</option>
        </select>
        <span class="rp-calc-op" style="cursor:default;border:none;color:var(--text-muted);font-size:9px;padding:4px 2px;" title="Third operand (active when op2 is set)">C:</span>
        ${slotHtml(cf.slotC, 'C')}
      </div>
      <label style="display:flex;align-items:center;gap:4px;font-family:'Share Tech Mono',monospace;font-size:8px;color:var(--text-muted);cursor:pointer;white-space:nowrap;" title="( A op B ) op C vs A op ( B op C )">
        <input type="checkbox" class="bracket-chk" ${cf.bracketFirst ? 'checked' : ''} ${!S.isOwner ? 'disabled' : ''}> (A·B)·C
      </label>
      <select class="rp-calc-fmt fmt-sel" title="Format" ${!S.isOwner ? 'disabled' : ''}>
        <option value="number"   ${cf.format==='number'   ? 'selected' : ''}># NUM</option>
        <option value="currency" ${cf.format==='currency' ? 'selected' : ''}>₹ INR</option>
        <option value="percent"  ${cf.format==='percent'  ? 'selected' : ''}>% PCT</option>
      </select>
      <button class="btn-rm-row" title="Remove" ${!S.isOwner ? 'disabled' : ''}>✕</button>
    `;

    // Set current slot values in the selects/inputs
    const setSlotVal = (name, slot) => {
      const valEl = div.querySelector(`.slot-val-${name}`);
      if (valEl && slot.value !== undefined) {
        if (valEl.tagName === 'SELECT') valEl.value = slot.value;
        else valEl.value = slot.value;
      }
    };
    setSlotVal('A', cf.slotA);
    setSlotVal('B', cf.slotB);
    setSlotVal('C', cf.slotC);

    // Wire changes back to state
    const sync = () => {
      S.calcFields[idx].label        = div.querySelector('.rp-calc-name').value;
      S.calcFields[idx].op1          = div.querySelector('.op1-sel').value;
      S.calcFields[idx].op2          = div.querySelector('.op2-sel').value;
      S.calcFields[idx].bracketFirst  = div.querySelector('.bracket-chk').checked;
      S.calcFields[idx].format       = div.querySelector('.fmt-sel').value;

      for (const name of ['A','B','C']) {
        const typeSel = div.querySelector(`.slot-type-${name}`);
        const valEl   = div.querySelector(`.slot-val-${name}`);
        if (typeSel && valEl) {
          S.calcFields[idx][`slot${name}`] = {
            type: typeSel.value,
            value: valEl.tagName === 'SELECT' ? valEl.value : Number(valEl.value),
          };
        }
      }
    };

    div.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('change', () => {
        sync();
        // If slot type changed, re-render to swap select/input
        if (el.classList.contains('slot-type-A') || el.classList.contains('slot-type-B') || el.classList.contains('slot-type-C')) {
          renderCalcList();
        }
      });
    });

    div.querySelector('.btn-rm-row').addEventListener('click', () => {
      S.calcFields.splice(idx, 1);
      renderCalcList();
    });

    el.appendChild(div);
  });
}

function evalCalcField(row, cf) {
  const getVal = slot => {
    if (!slot) return 0;
    if (slot.type === 'constant') return Number(slot.value) || 0;
    const v = Number(row[slot.value]);
    return isNaN(v) ? 0 : v;
  };
  const applyOp = (a, op, b) => {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b !== 0 ? a / b : 0;
    return 0;
  };

  const a = getVal(cf.slotA);
  const b = getVal(cf.slotB);
  if (!cf.op2 || !cf.slotC?.value) return applyOp(a, cf.op1, b);

  const c = getVal(cf.slotC);
  return cf.bracketFirst
    ? applyOp(applyOp(a, cf.op1, b), cf.op2, c)
    : applyOp(a, cf.op1, applyOp(b, cf.op2, c));
}

// ── 13. FILTERS ───────────────────────────────────────────────────
function addFilter() {
  if (!S.isOwner) { toast('VIEW ONLY — Save a copy to edit', 'info'); return; }
  S.filters.push({ id: uid(), field: ALL_FIELDS[0]?.field || '', op: '=', value: '', join: S.filters.length ? 'AND' : null });
  renderFilterList();
}

const OPS_NUM  = ['=','≠','>','<','≥','≤'];
const OPS_DATE = ['=','≠','>','<','≥','≤'];
const OPS_TEXT = ['=','≠','contains','starts with'];

function opsForType(type) {
  if (type === 'num') return OPS_NUM;
  if (type === 'date') return OPS_DATE;
  return OPS_TEXT;
}

function renderFilterList() {
  const el = document.getElementById('rpFilterList');
  el.innerHTML = '';
  S.filters.forEach((f, idx) => {
    const row = document.createElement('div');
    row.className = 'rp-filter-row';
    const type = getFieldType(f.field);
    const ops  = opsForType(type);
    const fieldOpts = ALL_FIELDS.map(fd =>
      `<option value="${fd.field}" ${fd.field === f.field ? 'selected' : ''}>${fd.label}</option>`
    ).join('');
    const opOpts = ops.map(o => `<option value="${o}" ${o === f.op ? 'selected' : ''}>${o}</option>`).join('');
    const valInput = type === 'date'
      ? `<input class="rp-f-val f-val" type="date" value="${f.value || ''}" ${!S.isOwner ? 'disabled' : ''}>`
      : type === 'num'
        ? `<input class="rp-f-val f-val" type="number" value="${f.value || ''}" placeholder="value" ${!S.isOwner ? 'disabled' : ''}>`
        : `<input class="rp-f-val f-val" type="text" value="${f.value || ''}" placeholder="value" ${!S.isOwner ? 'disabled' : ''}>`;

    const joinHtml = idx === 0 ? `<span style="width:42px;text-align:center;font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);">WHERE</span>`
      : `<button class="rp-join-badge ${f.join === 'OR' ? 'rp-join-or' : 'rp-join-and'} join-toggle">${f.join || 'AND'}</button>`;

    row.innerHTML = `
      ${joinHtml}
      <select class="rp-f-select field-sel f-field" ${!S.isOwner ? 'disabled' : ''}>${fieldOpts}</select>
      <select class="rp-f-select op-sel f-op" ${!S.isOwner ? 'disabled' : ''}>${opOpts}</select>
      ${valInput}
      <button class="btn-rm-row" ${!S.isOwner ? 'disabled' : ''}>✕</button>
    `;

    // Join toggle
    const joinBtn = row.querySelector('.join-toggle');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        S.filters[idx].join = S.filters[idx].join === 'OR' ? 'AND' : 'OR';
        renderFilterList();
      });
    }

    // Field change → rebuild ops + value input
    row.querySelector('.f-field').addEventListener('change', e => {
      S.filters[idx].field = e.target.value;
      S.filters[idx].op    = opsForType(getFieldType(e.target.value))[0];
      S.filters[idx].value = '';
      renderFilterList();
    });

    row.querySelector('.f-op').addEventListener('change', e => { S.filters[idx].op = e.target.value; });
    row.querySelector('.f-val').addEventListener('change', e => { S.filters[idx].value = e.target.value; });
    row.querySelector('.btn-rm-row').addEventListener('click', () => {
      S.filters.splice(idx, 1);
      if (S.filters.length && S.filters[0].join) S.filters[0].join = null;
      renderFilterList();
    });

    el.appendChild(row);
  });
}

function evalFilter(row, f) {
  const raw = row[f.field];
  const type = getFieldType(f.field);

  if (type === 'num') {
    const a = Number(raw), b = Number(f.value);
    if (f.op === '=')  return a === b;
    if (f.op === '≠')  return a !== b;
    if (f.op === '>')  return a > b;
    if (f.op === '<')  return a < b;
    if (f.op === '≥')  return a >= b;
    if (f.op === '≤')  return a <= b;
  }
  if (type === 'date') {
    const a = raw ? new Date(raw).getTime() : null;
    const b = f.value ? new Date(f.value).getTime() : null;
    if (a === null || b === null) return false;
    if (f.op === '=')  return a === b;
    if (f.op === '≠')  return a !== b;
    if (f.op === '>')  return a > b;
    if (f.op === '<')  return a < b;
    if (f.op === '≥')  return a >= b;
    if (f.op === '≤')  return a <= b;
  }
  const a = String(raw ?? '').toLowerCase();
  const b = String(f.value ?? '').toLowerCase();
  if (f.op === '=')          return a === b;
  if (f.op === '≠')          return a !== b;
  if (f.op === 'contains')   return a.includes(b);
  if (f.op === 'starts with') return a.startsWith(b);
  if (f.op === '>')          return a > b;
  if (f.op === '<')          return a < b;
  return true;
}

function applyFilters(rows) {
  if (!S.filters.length) return rows;
  return rows.filter(row => {
    let result = evalFilter(row, S.filters[0]);
    for (let i = 1; i < S.filters.length; i++) {
      const next = evalFilter(row, S.filters[i]);
      result = S.filters[i].join === 'OR' ? result || next : result && next;
    }
    return result;
  });
}

// ── 14. GROUPING & SORT ───────────────────────────────────────────
function populateGroupByAndSortSelects() {
  const sel = document.getElementById('rpGroupBy');
  sel.innerHTML = '<option value="">— NO GROUPING —</option>' +
    CAT_FIELDS.map(f => `<option value="${f}">${FIELD_MAP[f].label}</option>`).join('');
}

function addAggRule() {
  if (!S.isOwner) return;
  S.aggregations.push({ id: uid(), field: NUM_FIELDS[0] || '', fn: 'SUM', label: 'Total' });
  renderAggList();
}

function renderAggList() {
  const el = document.getElementById('rpAggList');
  el.innerHTML = '';
  const numOpts = NUM_FIELDS.map(f => `<option value="${f}">${FIELD_MAP[f].label}</option>`).join('');
  const fnOpts  = ['SUM','COUNT','AVG','MIN','MAX'].map(fn => `<option value="${fn}">${fn}</option>`).join('');

  S.aggregations.forEach((agg, idx) => {
    const row = document.createElement('div');
    row.className = 'rp-agg-row';
    row.innerHTML = `
      <select class="rp-f-select" style="min-width:80px;" ${!S.isOwner ? 'disabled' : ''}>${fnOpts}</select>
      <select class="rp-f-select" style="flex:1;" ${!S.isOwner ? 'disabled' : ''}>${numOpts}</select>
      <span style="font-family:'Share Tech Mono',monospace;font-size:8px;color:var(--text-muted);">AS</span>
      <input class="rp-calc-name" type="text" value="${agg.label}" placeholder="Label" style="width:110px;" ${!S.isOwner ? 'disabled' : ''}>
      <button class="btn-rm-row" ${!S.isOwner ? 'disabled' : ''}>✕</button>
    `;
    const [fnSel, fldSel, labelInp] = [row.querySelectorAll('select')[0], row.querySelectorAll('select')[1], row.querySelector('input')];
    fnSel.value  = agg.fn;
    fldSel.value = agg.field;
    fnSel.addEventListener('change',   e => { S.aggregations[idx].fn    = e.target.value; });
    fldSel.addEventListener('change',  e => { S.aggregations[idx].field = e.target.value; });
    labelInp.addEventListener('change', e => { S.aggregations[idx].label = e.target.value; });
    row.querySelector('.btn-rm-row').addEventListener('click', () => {
      S.aggregations.splice(idx, 1); renderAggList();
    });
    el.appendChild(row);
  });
}

function addSortRule() {
  if (!S.isOwner) return;
  S.sortRules.push({ id: uid(), field: ALL_FIELDS[0]?.field || '', dir: 'ASC' });
  renderSortList();
}

function renderSortList() {
  const el = document.getElementById('rpSortList');
  el.innerHTML = '';
  const allOpts = ALL_FIELDS.map(f => `<option value="${f.field}">${f.label}</option>`).join('');

  S.sortRules.forEach((sr, idx) => {
    const row = document.createElement('div');
    row.className = 'rp-sort-row';
    row.innerHTML = `
      <select class="rp-f-select" style="flex:1;" ${!S.isOwner ? 'disabled' : ''}>${allOpts}</select>
      <select class="rp-f-select" style="width:70px;" ${!S.isOwner ? 'disabled' : ''}>
        <option value="ASC">ASC ↑</option>
        <option value="DESC">DESC ↓</option>
      </select>
      <button class="btn-rm-row" ${!S.isOwner ? 'disabled' : ''}>✕</button>
    `;
    const [fldSel, dirSel] = row.querySelectorAll('select');
    fldSel.value = sr.field;
    dirSel.value = sr.dir;
    fldSel.addEventListener('change', e => { S.sortRules[idx].field = e.target.value; });
    dirSel.addEventListener('change', e => { S.sortRules[idx].dir   = e.target.value; });
    row.querySelector('.btn-rm-row').addEventListener('click', () => {
      S.sortRules.splice(idx, 1); renderSortList();
    });
    el.appendChild(row);
  });
}

function applyGrouping(rows) {
  if (!S.groupBy || !S.aggregations.length) return rows;
  const groups = {};
  rows.forEach(row => {
    const key = row[S.groupBy] ?? '—';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });
  return Object.entries(groups).map(([key, grpRows]) => {
    const out = { [S.groupBy]: key };
    S.aggregations.forEach(agg => {
      const colKey = `${agg.fn}_${agg.field}`;
      const vals   = grpRows.map(r => Number(r[agg.field])).filter(v => !isNaN(v));
      if (agg.fn === 'SUM')   out[colKey] = vals.reduce((a, b) => a + b, 0);
      if (agg.fn === 'COUNT') out[colKey] = grpRows.length;
      if (agg.fn === 'AVG')   out[colKey] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
      if (agg.fn === 'MIN')   out[colKey] = vals.length ? Math.min(...vals) : null;
      if (agg.fn === 'MAX')   out[colKey] = vals.length ? Math.max(...vals) : null;
      out[`__agg_label_${colKey}`] = agg.label;
    });
    return out;
  });
}

function applySort(rows) {
  if (!S.sortRules.length) return rows;
  return [...rows].sort((a, b) => {
    for (const sr of S.sortRules) {
      const ta = a[sr.field], tb = b[sr.field];
      const type = getFieldType(sr.field);
      let cmp = 0;
      if (type === 'num') { cmp = (Number(ta)||0) - (Number(tb)||0); }
      else if (type === 'date') { cmp = new Date(ta||0) - new Date(tb||0); }
      else { cmp = String(ta??'').localeCompare(String(tb??'')); }
      if (cmp !== 0) return sr.dir === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });
}

// ── 15. RUN REPORT ────────────────────────────────────────────────
async function runReport() {
  if (!S.columns.length && !S.calcFields.length) {
    toast('Add at least one column first', 'info'); return;
  }
  loading(true);
  document.getElementById('btnApply').disabled = true;
  document.getElementById('rpPreviewStat').textContent = 'FETCHING…';
  try {
    // Fetch from the view
    const rows = await nxFetch(`${VIEW}?limit=${FETCH_LIMIT}&order=sanction_id.asc`);
    S.rawData = rows || [];

    // Pipeline: filter → calc fields → grouping → sort
    let data = applyFilters(S.rawData);

    // Attach calc field values to each row
    data = data.map(row => {
      const r = { ...row };
      S.calcFields.forEach(cf => {
        r[`__calc_${cf.id}`] = evalCalcField(row, cf);
      });
      return r;
    });

    // Grouping (if set)
    data = applyGrouping(data);

    // Sort
    data = applySort(data);

    S.processedData = data;
    S.page = 1;
    renderPreviewTable();

    document.getElementById('rpPreviewStat').textContent =
      `${S.rawData.length} ROWS FETCHED · ${data.length} AFTER FILTERS`;

  } catch (e) {
    toast('Failed to fetch data: ' + e.message, 'error');
    document.getElementById('rpPreviewStat').textContent = 'ERROR — see toast';
  } finally {
    loading(false);
    document.getElementById('btnApply').disabled = false;
  }
}

// ── 16. PREVIEW TABLE ─────────────────────────────────────────────
function renderPreviewTable() {
  const isEmpty = !S.processedData.length;
  document.getElementById('rpPreviewEmpty').style.display = isEmpty ? '' : 'none';
  document.getElementById('rpPreviewInner').style.display = isEmpty ? 'none' : '';
  document.getElementById('rpPagination').style.display   = isEmpty ? 'none' : '';
  if (isEmpty) return;

  const isGrouped   = !!(S.groupBy && S.aggregations.length);
  const visibleCols = S.columns.filter(c => c.visible);

  // Build header columns
  let headerCols = [];
  if (isGrouped) {
    headerCols.push({ key: S.groupBy, label: FIELD_MAP[S.groupBy]?.label || S.groupBy, isCalc: false, fmt: null });
    S.aggregations.forEach(agg => {
      const colKey = `${agg.fn}_${agg.field}`;
      headerCols.push({ key: colKey, label: agg.label || colKey, isCalc: false, fmt: 'number' });
    });
  } else {
    visibleCols.forEach(c => headerCols.push({ key: c.field, label: c.label, isCalc: false, fmt: null }));
    S.calcFields.forEach(cf => headerCols.push({ key: `__calc_${cf.id}`, label: cf.label, isCalc: true, fmt: cf.format }));
  }

  // Pagination
  const rpp     = S.rowsPerPage || S.processedData.length;
  const total   = S.processedData.length;
  const pages   = rpp ? Math.ceil(total / rpp) : 1;
  S.page        = Math.max(1, Math.min(S.page, pages));
  const start   = rpp ? (S.page - 1) * rpp : 0;
  const pageData = rpp ? S.processedData.slice(start, start + rpp) : S.processedData;

  // Render thead
  document.getElementById('rpPreviewHead').innerHTML = `<tr>${
    headerCols.map(h => `<th class="${h.isCalc ? 'calc-col' : ''}">${h.label}</th>`).join('')
  }</tr>`;

  // Render tbody
  document.getElementById('rpPreviewBody').innerHTML = pageData.map(row => `<tr>${
    headerCols.map(h => {
      const raw = row[h.key];
      const type = h.isCalc ? null : getFieldType(h.key);
      const cellClass = h.isCalc ? 'calc-col' : (type === 'num' ? 'num-col' : type === 'date' ? 'date-col' : '');
      const display = h.fmt ? formatCellValue(null, raw, h.fmt) : formatCellValue(h.key, raw, null);
      return `<td class="${cellClass}">${display}</td>`;
    }).join('')
  }</tr>`).join('');

  renderPagination(pages, total, start, rpp, pageData.length);
}

function clearPreview() {
  document.getElementById('rpPreviewEmpty').style.display = '';
  document.getElementById('rpPreviewEmpty').textContent = 'CONFIGURE YOUR REPORT AND CLICK ▶ RUN REPORT';
  document.getElementById('rpPreviewInner').style.display = 'none';
  document.getElementById('rpPagination').style.display = 'none';
  document.getElementById('rpPreviewStat').textContent = '';
  S.processedData = [];
  S.rawData = [];
}

// ── 17. PAGINATION ────────────────────────────────────────────────
function renderPagination(pages, total, start, rpp, pageCount) {
  const pgInfo  = document.getElementById('rpPageInfo');
  const pgBtns  = document.getElementById('rpPageButtons');
  const prevBtn = document.getElementById('btnPrevPage');
  const nextBtn = document.getElementById('btnNextPage');

  const end = Math.min(start + pageCount, total);
  pgInfo.textContent = rpp
    ? `SHOWING ${start + 1}–${end} OF ${total} ROWS · PAGE ${S.page} OF ${pages}`
    : `SHOWING ALL ${total} ROWS`;

  prevBtn.disabled = S.page <= 1;
  nextBtn.disabled = S.page >= pages;

  // Page number buttons (show up to 7 around current)
  const range = [];
  for (let p = Math.max(1, S.page - 3); p <= Math.min(pages, S.page + 3); p++) range.push(p);
  pgBtns.innerHTML = range.map(p =>
    `<button class="btn-page ${p === S.page ? 'active' : ''}" data-pg="${p}">${p}</button>`
  ).join('');
  pgBtns.querySelectorAll('[data-pg]').forEach(b => {
    b.addEventListener('click', () => { S.page = parseInt(b.dataset.pg); renderPreviewTable(); });
  });
}

// ── 18. SAVE REPORT ───────────────────────────────────────────────
async function saveReport() {
  if (!S.isOwner) return;
  const name = (document.getElementById('rpNameInput').value || '').trim();
  if (!name) { toast('Enter a report name', 'info'); return; }

  const definition = buildDefinition();
  const username   = _session.profile?.username || _session.user;
  const payload = {
    name,
    definition,
    created_by: username,
    share_type: S.shareType,
    shared_with_users: S.sharedWithUsers,
    shared_with_teams: S.sharedWithTeams,
    updated_at: new Date().toISOString(),
  };

  loading(true);
  try {
    if (S.reportId) {
      // UPDATE
      await nxFetch(`${TABLE}?id=eq.${S.reportId}`, {
        method: 'PATCH',
        body: payload,
        prefer: 'return=representation',
      });
      toast('REPORT SAVED');
    } else {
      // INSERT
      const res = await nxFetch(TABLE, {
        method: 'POST',
        body: { ...payload, created_at: new Date().toISOString() },
        prefer: 'return=representation',
      });
      if (res && res[0]) {
        S.reportId = res[0].id;
        document.getElementById('btnDeleteReport').style.display = '';
      }
      toast('REPORT CREATED');
    }
    await loadSidebar();
    if (S.reportId) highlightSidebarItem(S.reportId);
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

function buildDefinition() {
  return {
    version: 1,
    source: VIEW,
    columns: S.columns,
    calculated_fields: S.calcFields,
    filters: S.filters,
    grouping: {
      enabled: !!(S.groupBy && S.aggregations.length),
      group_by: S.groupBy,
      aggregations: S.aggregations,
    },
    sort: S.sortRules,
    rows_per_page: S.rowsPerPage,
  };
}

async function copyAsMine() {
  const name = (document.getElementById('rpNameInput').value || 'Untitled Report').trim();
  const username = _session.profile?.username || _session.user;
  const payload = {
    name: `${name} (Copy)`,
    definition: buildDefinition(),
    created_by: username,
    share_type: 'none',
    shared_with_users: [],
    shared_with_teams: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  loading(true);
  try {
    const res = await nxFetch(TABLE, {
      method: 'POST',
      body: payload,
      prefer: 'return=representation',
    });
    if (res && res[0]) {
      S.reportId = res[0].id;
      setOwnerMode(true);
      document.getElementById('rpNameInput').value = payload.name;
      document.getElementById('btnDeleteReport').style.display = '';
      toast('SAVED AS YOUR COPY');
    }
    await loadSidebar();
    if (S.reportId) highlightSidebarItem(S.reportId);
  } catch (e) {
    toast('Copy failed: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

// ── 19. SHARE MODAL ───────────────────────────────────────────────
async function openShareModal() {
  if (!S.isOwner) return;
  const overlay = document.getElementById('shareModalOverlay');
  overlay.classList.add('open');

  // Set current share state in modal
  document.querySelectorAll('input[name="shareType"]').forEach(r => {
    r.checked = (r.value === S.shareType);
    r.closest('.rp-share-option')?.classList.toggle('selected', r.value === S.shareType);
  });
  updateShareTargetVisibility();
  await loadUsersAndTeams();
}

function closeShareModal() {
  document.getElementById('shareModalOverlay').classList.remove('open');
}

function updateShareTargetVisibility() {
  const val = document.querySelector('input[name="shareType"]:checked')?.value || 'none';
  document.querySelectorAll('.rp-share-option').forEach(opt => {
    opt.classList.toggle('selected', opt.querySelector('input').value === val);
  });
  document.getElementById('shareTargetUsers').classList.toggle('visible', val === 'users');
  document.getElementById('shareTargetTeams').classList.toggle('visible', val === 'teams');
}

async function loadUsersAndTeams() {
  if (_allUsers.length && _allTeams.length) {
    populateShareSelects();
    return;
  }
  try {
    const [users, teams] = await Promise.all([
      nxFetch('user_roles?select=username,full_name&state=neq.deactivated&order=username.asc').catch(() => []),
      nxFetch('teams?select=id,team_name&order=team_name.asc').catch(() => []),
    ]);
    _allUsers = users || [];
    _allTeams = teams || [];
    populateShareSelects();
  } catch {}
}

function populateShareSelects() {
  const username = _session.profile?.username || _session.user;
  const uSel = document.getElementById('shareUserSelect');
  uSel.innerHTML = _allUsers
    .filter(u => u.username !== username)
    .map(u => `<option value="${u.username}" ${S.sharedWithUsers.includes(u.username) ? 'selected' : ''}>${u.full_name || u.username} (${u.username})</option>`)
    .join('');

  const tSel = document.getElementById('shareTeamSelect');
  tSel.innerHTML = _allTeams
    .map(t => `<option value="${t.team_name || t.id}" ${S.sharedWithTeams.includes(t.team_name || String(t.id)) ? 'selected' : ''}>${t.team_name || t.id}</option>`)
    .join('');
}

async function applyShare() {
  const type = document.querySelector('input[name="shareType"]:checked')?.value || 'none';
  S.shareType = type;
  S.sharedWithUsers = type === 'users'
    ? [...document.getElementById('shareUserSelect').selectedOptions].map(o => o.value)
    : [];
  S.sharedWithTeams = type === 'teams'
    ? [...document.getElementById('shareTeamSelect').selectedOptions].map(o => o.value)
    : [];

  // If report is already saved, persist share change immediately
  if (S.reportId) {
    loading(true);
    try {
      await nxFetch(`${TABLE}?id=eq.${S.reportId}`, {
        method: 'PATCH',
        body: {
          share_type: S.shareType,
          shared_with_users: S.sharedWithUsers,
          shared_with_teams: S.sharedWithTeams,
          updated_at: new Date().toISOString(),
        },
        prefer: 'return=representation',
      });
      toast('SHARING UPDATED');
      await loadSidebar();
      if (S.reportId) highlightSidebarItem(S.reportId);
    } catch (e) {
      toast('Share update failed: ' + e.message, 'error');
    } finally {
      loading(false);
    }
  } else {
    toast('SHARING WILL APPLY ON SAVE');
  }
  closeShareModal();
}

// ── 20. DELETE ────────────────────────────────────────────────────
function openDeleteConfirm() {
  if (!checkCanDelete()) { toast('Not permitted', 'error'); return; }
  const name = document.getElementById('rpNameInput').value || 'this report';
  document.getElementById('confirmMsg').textContent = `Delete "${name}"? This cannot be undone.`;
  document.getElementById('confirmOverlay').classList.add('open');
}

function closeDeleteConfirm() {
  document.getElementById('confirmOverlay').classList.remove('open');
}

async function confirmDelete() {
  closeDeleteConfirm();
  if (!S.reportId) { newReport(); return; }
  loading(true);
  try {
    await nxFetch(`${TABLE}?id=eq.${S.reportId}`, { method: 'DELETE' });
    toast('REPORT DELETED');
    newReport();
    await loadSidebar();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

// ── 21. EXPORT XLSX ───────────────────────────────────────────────
async function exportXlsx() {
  if (!S.processedData.length) { toast('RUN THE REPORT FIRST', 'info'); return; }
  loading(true);
  try {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs');
    const isGrouped  = !!(S.groupBy && S.aggregations.length);
    const visibleCols = S.columns.filter(c => c.visible);

    let headers = [];
    let colKeys  = [];
    let colFmts  = [];

    if (isGrouped) {
      headers  = [FIELD_MAP[S.groupBy]?.label || S.groupBy, ...S.aggregations.map(a => a.label)];
      colKeys  = [S.groupBy, ...S.aggregations.map(a => `${a.fn}_${a.field}`)];
      colFmts  = [null, ...S.aggregations.map(() => 'number')];
    } else {
      headers  = [...visibleCols.map(c => c.label), ...S.calcFields.map(cf => cf.label)];
      colKeys  = [...visibleCols.map(c => c.field), ...S.calcFields.map(cf => `__calc_${cf.id}`)];
      colFmts  = [...visibleCols.map(() => null), ...S.calcFields.map(cf => cf.format)];
    }

    const wsData = [
      headers,
      ...S.processedData.map(row =>
        colKeys.map((key, i) => {
          const v = row[key];
          if (v === null || v === undefined || v === '') return '';
          const type = colFmts[i] ? null : getFieldType(key);
          if (type === 'num' || colFmts[i] === 'number' || colFmts[i] === 'currency' || colFmts[i] === 'percent') {
            return Number(v) || 0;
          }
          if (type === 'date') return v ? String(v).slice(0, 10) : '';
          return String(v);
        })
      )
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const reportName = (document.getElementById('rpNameInput').value || 'report').replace(/[^\w\s-]/g, '').trim();
    XLSX.writeFile(wb, `DRGSBC_${reportName}_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast('XLSX DOWNLOADED');
  } catch (e) {
    toast('Export failed: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

// ── 22. EXPORT PDF (print window) ─────────────────────────────────
function exportPdf() {
  if (!S.processedData.length) { toast('RUN THE REPORT FIRST', 'info'); return; }
  const reportName = document.getElementById('rpNameInput').value || 'Report';
  const username   = _session.user || '—';
  const now        = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

  const isGrouped   = !!(S.groupBy && S.aggregations.length);
  const visibleCols = S.columns.filter(c => c.visible);
  let headers = [], colKeys = [], colFmts = [];

  if (isGrouped) {
    headers  = [FIELD_MAP[S.groupBy]?.label || S.groupBy, ...S.aggregations.map(a => a.label)];
    colKeys  = [S.groupBy, ...S.aggregations.map(a => `${a.fn}_${a.field}`)];
    colFmts  = [null, ...S.aggregations.map(() => 'number')];
  } else {
    headers  = [...visibleCols.map(c => c.label), ...S.calcFields.map(cf => cf.label)];
    colKeys  = [...visibleCols.map(c => c.field), ...S.calcFields.map(cf => `__calc_${cf.id}`)];
    colFmts  = [...visibleCols.map(() => null), ...S.calcFields.map(cf => cf.format)];
  }

  const rows = S.processedData.map(row =>
    `<tr>${colKeys.map((key, i) => {
      const v = row[key];
      const display = colFmts[i] ? formatCellValue(null, v, colFmts[i]) : formatCellValue(key, v, null);
      return `<td>${display}</td>`;
    }).join('')}</tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>${reportName}</title>
  <style>
    body{margin:20px;font-family:Arial,sans-serif;font-size:9pt;color:#111;}
    h1{font-size:14pt;margin:0 0 4px;letter-spacing:1px;}
    .meta{font-size:7pt;color:#555;margin-bottom:14px;}
    table{width:100%;border-collapse:collapse;font-size:8pt;}
    th{background:#1a3a5c;color:#fff;padding:5px 7px;text-align:left;font-size:7pt;letter-spacing:.5px;}
    td{padding:4px 7px;border-bottom:1px solid #ddd;}
    tr:nth-child(even) td{background:#f5f7fa;}
    .footer{margin-top:18px;font-size:7pt;color:#888;border-top:1px solid #ddd;padding-top:6px;}
    @media print{@page{size:landscape;margin:12mm;}}
  </style>
  </head><body>
  <h1>DRGSBC — ${reportName}</h1>
  <div class="meta">SOUTH WESTERN RAILWAY · SBC DIVISION · MECHANICAL ASSETS PROCUREMENT</div>
  <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="footer">Created by: ${username} &nbsp;|&nbsp; Generated on: ${now} &nbsp;|&nbsp; Total rows: ${S.processedData.length}</div>
  </body></html>`;

  const win = window.open('', '_blank', 'width=1100,height=700');
  if (!win) { toast('Allow pop-ups to export PDF', 'error'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 600);
  toast('PDF PRINT DIALOG OPENED');
}

// ── 23. PRINT ─────────────────────────────────────────────────────
function printReport() {
  if (!S.processedData.length) { toast('RUN THE REPORT FIRST', 'info'); return; }
  const reportName = document.getElementById('rpNameInput').value || 'Report';
  const username   = _session.user || '—';
  const now        = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  document.getElementById('rpPrintTitle').textContent   = reportName;
  document.getElementById('rpPrintFooter').textContent  = `Created by: ${username}  ·  Generated on: ${now}  ·  ${S.processedData.length} rows`;
  window.print();
}

// ── BOOT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
