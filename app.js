/* =========================================================
   Internal Purchase Order — frontend
   Talks to Cloudflare Worker API
   ========================================================= */

const API_BASE = 'https://dark-truth-f3df.chamith-c96.workers.dev';
const TOKEN_KEY = 'po_token';
const USER_KEY  = 'po_user';

let CURRENT_USER = null;
let CURRENT_TOKEN = null;
let CURRENT_VIEW = 'orders';
let PRODUCT_CACHE = new Map();     // product_code -> { description, pack }
let STOCK_CACHE   = new Map();     // product_code -> { available_qty, stock_date }
let AMS_CACHE     = new Map();     // product_code -> { avg_ams, ... }
let EDITING_ORDER_ID = null;
let EDITING_ORDER_STATUS = null;

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt2 = n => isFinite(n) ? Number(n).toFixed(2) : '0.00';
const numOr = (v, d=0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const todayISO = () => new Date().toISOString().slice(0,10);

function msg(id, text, kind) {
  const el = $(id); if (!el) return;
  el.textContent = text || '';
  el.className = 'msg ' + (kind || '');
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (CURRENT_TOKEN) headers.Authorization = 'Bearer ' + CURRENT_TOKEN;
  const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) { logout(); }
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  return data;
}

/* =========================================================
   AUTH
   ========================================================= */
async function doLogin() {
  const emp = $('loginEmp').value.trim();
  const pw  = $('loginPw').value;
  $('loginErr').textContent = '';
  if (!emp || !pw) { $('loginErr').textContent = 'Enter employee no and password.'; return; }

  $('loginBtn').disabled = true;
  try {
    const data = await api('/api/login', {
      method: 'POST', body: JSON.stringify({ emp, password: pw })
    });
    CURRENT_TOKEN = data.token;
    CURRENT_USER  = data.user;
    localStorage.setItem(TOKEN_KEY, CURRENT_TOKEN);
    localStorage.setItem(USER_KEY, JSON.stringify(CURRENT_USER));
    startApp();
  } catch (e) {
    $('loginErr').textContent = e.message || 'Login failed';
  } finally {
    $('loginBtn').disabled = false;
  }
}

function logout() {
  CURRENT_TOKEN = null; CURRENT_USER = null;
  localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('loginPw').value = '';
}

function restoreSession() {
  const t = localStorage.getItem(TOKEN_KEY);
  const u = localStorage.getItem(USER_KEY);
  if (t && u) {
    try { CURRENT_TOKEN = t; CURRENT_USER = JSON.parse(u); startApp(); return true; }
    catch { logout(); }
  }
  return false;
}

/* =========================================================
   APP START / NAV
   ========================================================= */
function startApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');

  $('meName').textContent = CURRENT_USER.name || CURRENT_USER.emp;
  $('meMeta').textContent = (CURRENT_USER.role || '') + (CURRENT_USER.division ? ' · ' + CURRENT_USER.division : '');

  buildNav();
  loadReferenceData();          // products, stock, AMS caches
  showView('orders');
}

function buildNav() {
  const role = CURRENT_USER.role;
  const items = [{ id:'orders', label:'Orders' }];
  if (role === 'admin' || role === 'super_admin') {
    items.push({ id:'products', label:'Products' });
    items.push({ id:'stock',    label:'Stock' });
    items.push({ id:'ams',      label:'AMS' });
  }
  if (role === 'super_admin') items.push({ id:'users', label:'Users' });

  const nav = $('nav'); nav.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.dataset.view = it.id;
    b.addEventListener('click', () => showView(it.id));
    nav.appendChild(b);
  });
}

function showView(id) {
  CURRENT_VIEW = id;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = $('view-' + id);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('#nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === id));

  if (id === 'orders')   loadOrders();
  if (id === 'users')    loadUsers();
  if (id === 'products') loadProducts();
  if (id === 'stock')    loadStock();
  if (id === 'ams')      loadAms();
}

/* =========================================================
   REFERENCE DATA (products / stock / AMS caches)
   ========================================================= */
async function loadReferenceData() {
  await Promise.all([ primeStock(), primeAms() ]);
  // products are fetched lazily via /search for autocomplete
}

async function primeStock() {
  try {
    const data = await api('/api/stock/latest');
    STOCK_CACHE.clear();
    (data.stock || []).forEach(s => STOCK_CACHE.set(String(s.product_code), s));
  } catch (e) { /* no stock yet — fine */ }
}
async function primeAms() {
  try {
    const data = await api('/api/ams');
    AMS_CACHE.clear();
    (data.ams || []).forEach(a => AMS_CACHE.set(String(a.part_no), a));
  } catch (e) { /* no AMS yet — fine */ }
}

/* =========================================================
   ORDERS LIST
   ========================================================= */
async function loadOrders() {
  msg('ordersMsg', 'Loading…');
  try {
    const data = await api('/api/orders');
    const orders = data.orders || [];
    if (!orders.length) {
      $('ordersTableWrap').innerHTML = '<div class="empty-state">No orders yet.</div>';
      msg('ordersMsg', '');
      return;
    }
    const rows = orders.map(o => {
      const actions = [];
      const isOwner = o.created_by === CURRENT_USER.emp;
      if (CURRENT_USER.role === 'manager' && isOwner && o.status === 'draft')
        actions.push(`<button class="btn-sm btn-outline" data-act="edit" data-id="${o.id}">Edit</button>`);
      if (CURRENT_USER.role === 'admin' && o.status === 'in_review')
        actions.push(`<button class="btn-sm btn-warn" data-act="review" data-id="${o.id}">Review</button>`);
      if (CURRENT_USER.role === 'super_admin' && o.status === 'pending_super_admin')
        actions.push(`<button class="btn-sm btn-success" data-act="approve" data-id="${o.id}">Approve</button>`);
      actions.push(`<button class="btn-sm btn-outline" data-act="view" data-id="${o.id}">View</button>`);
      return `<tr>
        <td>#${o.id}</td>
        <td>${esc(o.order_ref || '')}</td>
        <td>${esc(o.supplier || '')}</td>
        <td>${esc(o.order_date || '')}</td>
        <td>${esc(o.currency || '')}</td>
        <td>${fmt2(o.total_value || 0)}</td>
        <td><span class="badge ${o.status}">${o.status.replace(/_/g,' ')}</span></td>
        <td>${esc(o.created_by_name || o.created_by)}</td>
        <td>${esc(o.reviewed_by_name || '')}</td>
        <td>${esc(o.approved_by_name || '')}</td>
        <td style="white-space:nowrap">${actions.join(' ')}</td>
      </tr>`;
    }).join('');

    $('ordersTableWrap').innerHTML = `
      <table class="data">
        <thead><tr>
          <th>ID</th><th>Ref</th><th>Supplier</th><th>Date</th><th>Cur</th>
          <th>Total</th><th>Status</th><th>Created By</th><th>Reviewed By</th><th>Approved By</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    $('ordersTableWrap').querySelectorAll('button[data-act]').forEach(b =>
      b.addEventListener('click', () => handleOrderAction(b.dataset.act, +b.dataset.id)));
    msg('ordersMsg', '');
  } catch (e) { msg('ordersMsg', e.message, 'err'); }
}

async function handleOrderAction(act, id) {
  try {
    if (act === 'edit')    return openOrderForm(id);
    if (act === 'view')    return openOrderForm(id, true);
    if (act === 'review')  return openOrderForm(id, false, 'admin');
    if (act === 'approve') {
      if (!confirm('Approve order #' + id + '? This will lock it permanently.')) return;
      await api('/api/orders/' + id + '/approve', { method: 'PATCH' });
      await loadOrders();
      return;
    }
  } catch (e) { alert(e.message); }
}

/* =========================================================
   ORDER FORM
   ========================================================= */
async function newOrder() {
  EDITING_ORDER_ID = null; EDITING_ORDER_STATUS = 'draft';
  $('orderFormTitle').textContent = 'New Order';
  clearOrderForm();
  $('f_prepared_by').value = CURRENT_USER.name || '';
  $('f_order_date').value = todayISO();
  addProductRow();
  buildFormActions('manager', 'draft');
  showViewRaw('order-form');
}

async function openOrderForm(id, readOnly, mode) {
  msg('orderMsg', 'Loading…');
  try {
    const data = await api('/api/orders/' + id);
    const o = data.order;
    EDITING_ORDER_ID = o.id; EDITING_ORDER_STATUS = o.status;
    $('orderFormTitle').textContent = 'Order #' + o.id + ' — ' + o.status.replace(/_/g,' ');
    fillOrderForm(o);
    const role = CURRENT_USER.role;
    const isOwner = o.created_by === CURRENT_USER.emp;
    if (readOnly || o.status === 'approved') buildFormActions(role, o.status, true);
    else if (role === 'manager' && isOwner && o.status === 'draft') buildFormActions('manager', 'draft');
    else if (role === 'admin' && mode === 'admin' && o.status === 'in_review') buildFormActions('admin', 'in_review');
    else buildFormActions(role, o.status, true);
    showViewRaw('order-form');
    msg('orderMsg', '');
  } catch (e) { msg('orderMsg', e.message, 'err'); }
}

function showViewRaw(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + id).classList.remove('hidden');
}

function clearOrderForm() {
  ['f_supplier','f_month','f_order_ref','f_notes','f_credit_days','f_prepared_by']
    .forEach(id => $(id).value = '');
  $('f_inco_term').value = 'CIF';
  $('f_currency').value = 'USD';
  $('f_payment_method').value = 'L/C';
  $('f_shipping_method').value = 'Air freight';
  $('f_market').value = 'Tender Market';
  $('productBody').innerHTML = '';
  $('totalOrderValue').textContent = '0.00';
  updateTermUI();
}

function fillOrderForm(o) {
  clearOrderForm();
  $('f_supplier').value = o.supplier || '';
  $('f_order_date').value = o.order_date || '';
  $('f_month').value = o.month || '';
  $('f_order_ref').value = o.order_ref || '';
  $('f_inco_term').value = o.inco_term || 'CIF';
  $('f_currency').value = o.currency || 'USD';
  $('f_payment_method').value = o.payment_method || 'L/C';
  $('f_credit_days').value = o.credit_days != null ? o.credit_days : '';
  $('f_shipping_method').value = o.shipping_method || 'Air freight';
  $('f_market').value = o.market || 'Tender Market';
  $('f_notes').value = o.notes || '';
  $('f_prepared_by').value = o.prepared_by || '';
  (o.items || []).forEach(it => addProductRow(it));
  if (!o.items || !o.items.length) addProductRow();
  updateTermUI();
  recalcTotal();
}

function buildFormActions(role, status, readOnly) {
  const wrap = $('orderFormActions'); wrap.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'btn-outline'; back.textContent = '← Back to Orders';
  back.addEventListener('click', () => showView('orders'));
  wrap.appendChild(back);

  if (readOnly || status === 'approved') return;

  if (role === 'manager' && status === 'draft') {
    const save = document.createElement('button');
    save.className = 'btn-outline'; save.textContent = 'Save Draft';
    save.addEventListener('click', () => saveOrder(false));
    const submit = document.createElement('button');
    submit.className = 'btn-primary'; submit.textContent = 'Submit for Review';
    submit.addEventListener('click', () => saveOrder(true));
    wrap.appendChild(save); wrap.appendChild(submit);
  }
  if (role === 'admin' && status === 'in_review') {
    const save = document.createElement('button');
    save.className = 'btn-outline'; save.textContent = 'Save Changes';
    save.addEventListener('click', () => saveOrderAsAdmin(false));
    const forward = document.createElement('button');
    forward.className = 'btn-primary'; forward.textContent = 'Save & Forward to Super Admin';
    forward.addEventListener('click', () => saveOrderAsAdmin(true));
    wrap.appendChild(save); wrap.appendChild(forward);
  }
}

/* ---------- collect form -> payload ---------- */
function collectHeader() {
  return {
    supplier: $('f_supplier').value.trim(),
    order_date: $('f_order_date').value,
    month: $('f_month').value.trim(),
    order_ref: $('f_order_ref').value.trim(),
    inco_term: $('f_inco_term').value,
    currency: $('f_currency').value,
    payment_method: $('f_payment_method').value,
    credit_days: $('f_credit_days').value ? Number($('f_credit_days').value) : null,
    shipping_method: $('f_shipping_method').value,
    market: $('f_market').value,
    notes: $('f_notes').value,
    total_value: numOr($('totalOrderValue').textContent, 0),
    prepared_by: $('f_prepared_by').value.trim(),
  };
}

function collectItems() {
  const rows = [];
  document.querySelectorAll('#productBody tr').forEach(tr => {
    const get = sel => tr.querySelector(sel);
    const urgencySel = get('.shipment-input').value;
    const urgencyDate = get('.shipment-date').value;
    const urgency = urgencySel === '__date__' ? urgencyDate : urgencySel;
    rows.push({
      product_code:  get('.code-input').value.trim(),
      description:   get('.desc-input').value.trim(),
      packs:         get('.packs-input').value.trim(),
      price:         get('.cif-input').value ? numOr(get('.cif-input').value, null) : null,
      shipping:      get('.ship-input').value ? numOr(get('.ship-input').value, null) : null,
      on_hand:       get('.onhand-input').value ? numOr(get('.onhand-input').value, null) : null,
      sdq:           get('.sdq-input').value ? numOr(get('.sdq-input').value, null) : null,
      quantity:      get('.qty-input').value ? numOr(get('.qty-input').value, null) : null,
      total:         get('.total-cell').textContent === '—' ? null : numOr(get('.total-cell').textContent, null),
      ams:           get('.ams-input').value ? numOr(get('.ams-input').value, null) : null,
      stock_duration: get('.dur-cell').textContent === 'N/A' ? null : numOr(get('.dur-cell').textContent, null),
      free_goods:    get('.free-goods-input').value.trim(),
      urgency:       urgency || null,
      eta:           get('.eta-input').value || null,
    });
  });
  return rows.filter(r => r.product_code || r.description || r.quantity);
}

async function saveOrder(submit) {
  const payload = { header: collectHeader(), items: collectItems() };
  if (!payload.items.length) { msg('orderMsg', 'Add at least one product row.', 'err'); return; }
  msg('orderMsg', 'Saving…');
  try {
    let id = EDITING_ORDER_ID;
    if (!id) {
      const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      id = r.id; EDITING_ORDER_ID = id;
    } else {
      await api('/api/orders/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    }
    if (submit) {
      await api('/api/orders/' + id + '/submit', { method: 'PATCH' });
      msg('orderMsg', 'Submitted for review.', 'ok');
    } else {
      msg('orderMsg', 'Draft saved.', 'ok');
    }
    setTimeout(() => showView('orders'), 600);
  } catch (e) { msg('orderMsg', e.message, 'err'); }
}

async function saveOrderAsAdmin(forward) {
  const id = EDITING_ORDER_ID;
  if (!id) return;
  const payload = { header: collectHeader(), items: collectItems() };
  msg('orderMsg', 'Saving…');
  try {
    await api('/api/orders/' + id + '/review-edit', { method: 'PUT', body: JSON.stringify(payload) });
    if (forward) {
      await api('/api/orders/' + id + '/review', { method: 'PATCH' });
      msg('orderMsg', 'Forwarded to Super Admin.', 'ok');
    } else {
      msg('orderMsg', 'Changes saved.', 'ok');
    }
    setTimeout(() => showView('orders'), 600);
  } catch (e) { msg('orderMsg', e.message, 'err'); }
}

/* =========================================================
   PRODUCT ROWS + AUTCOMPLETE + CALC
   ========================================================= */
function addProductRow(data = {}) {
  const tbody = $('productBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="autocomplete c-code"><input type="text" class="code-input" autocomplete="off" placeholder="code"></td>
    <td class="autocomplete c-desc"><input type="text" class="desc-input" autocomplete="off" placeholder="description"></td>
    <td class="num c-packs"><input type="text" class="packs-input num"></td>
    <td class="num c-price"><input type="number" step="0.01" class="cif-input num"></td>
    <td class="num c-ship ship-col"><input type="number" step="0.01" class="ship-input num"></td>
    <td class="num c-onhand"><input type="text" class="onhand-input num"></td>
    <td class="num c-sdq"><input type="text" class="sdq-input num"></td>
    <td class="num c-qty"><input type="number" step="1" class="qty-input num"></td>
    <td class="calc total-cell c-total">—</td>
    <td class="num c-ams"><input type="number" step="0.01" class="ams-input num"></td>
    <td class="calc dur-cell c-dur">—</td>
    <td class="num c-free"><input type="text" class="free-goods-input num"></td>
    <td class="c-urg">
      <select class="shipment-input">
        <option value="">—</option><option>Immediate</option><option>Urgent</option>
        <option>Normal</option><option>Low</option><option>On Hold</option>
        <option value="__date__">Pick a date…</option>
      </select>
      <input type="date" class="shipment-date" style="display:none;width:100%;margin-top:4px;font-size:11px;">
    </td>
    <td class="c-eta"><input type="date" class="eta-input"></td>
    <td class="c-del"><button class="del-btn" title="Remove row">×</button></td>
  `;
  tbody.appendChild(tr);

  wireAutocomplete(tr, 'code');
  wireAutocomplete(tr, 'desc');
  tr.querySelectorAll('input, select').forEach(inp =>
    inp.addEventListener('input', () => { recalcRow(tr); recalcTotal(); }));
  tr.querySelector('.del-btn').addEventListener('click', () => {
    tr.remove(); ensureAtLeastOneRow(); recalcTotal();
  });
  tr.querySelector('.shipment-input').addEventListener('change', e => {
    const d = tr.querySelector('.shipment-date');
    if (e.target.value === '__date__') { d.style.display = 'block'; d.focus(); }
    else { d.style.display = 'none'; d.value = ''; }
  });

  if (data.product_code) tr.querySelector('.code-input').value = data.product_code;
  if (data.description)  tr.querySelector('.desc-input').value  = data.description;
  if (data.packs)        tr.querySelector('.packs-input').value = data.packs;
  ['price','shipping','on_hand','sdq','quantity','ams','free_goods']
    .forEach(k => { const cls = {price:'cif-input',shipping:'ship-input',on_hand:'onhand-input',sdq:'sdq-input',quantity:'qty-input',ams:'ams-input',free_goods:'free-goods-input'}[k];
      if (data[k] != null) tr.querySelector('.' + cls).value = data[k]; });
  if (data.eta) tr.querySelector('.eta-input').value = data.eta;
  if (data.urgency) {
    const sel = tr.querySelector('.shipment-input');
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(data.urgency);
    if (isDate) { sel.value = '__date__'; const d = tr.querySelector('.shipment-date'); d.style.display='block'; d.value = data.urgency; }
    else sel.value = data.urgency;
  }

  recalcRow(tr);
  recalcTotal();
}

function ensureAtLeastOneRow() {
  if (!document.querySelector('#productBody tr')) addProductRow();
}

/* --- autocomplete via /api/products/search --- */
let acTimer = null;
function wireAutocomplete(tr, kind) {
  const input = tr.querySelector('.' + kind + '-input');
  const other = tr.querySelector('.' + (kind === 'code' ? 'desc' : 'code') + '-input');
  const list = document.createElement('div');
  list.className = 'ac-list'; document.body.appendChild(list);
  let matches = [], activeIdx = -1;

  function position() {
    const r = input.getBoundingClientRect();
    list.style.left = r.left + 'px';
    list.style.top = (r.bottom + 4) + 'px';
    list.style.width = Math.max(r.width, 340) + 'px';
  }
  function close() { list.style.display = 'none'; list.innerHTML = ''; activeIdx = -1; matches = []; }

  function pick(idx) {
    const p = matches[idx]; if (!p) return;
    input.value = kind === 'code' ? p.product_code : p.description;
    other.value = kind === 'code' ? p.description  : p.product_code;
    tr.querySelector('.packs-input').value = p.pack || '';
    const code = tr.querySelector('.code-input').value.trim();
    applyStock(tr, code);
    applyAms(tr, code);
    close(); recalcRow(tr); recalcTotal();
  }

  async function search(q) {
    if (!q || q.length < 2) { close(); return; }
    try {
      const data = await api('/api/products/search?q=' + encodeURIComponent(q));
      matches = data.products || [];
      if (!matches.length) { close(); return; }
      list.innerHTML = matches.map((p, i) =>
        `<div data-idx="${i}"><span class="code">${esc(p.product_code)}</span>` +
        `<span class="desc">${esc(p.description)}</span>` +
        `<span class="packs">${esc(p.pack)}</span></div>`).join('');
      list.style.display = 'block'; position(); activeIdx = -1;
      list.querySelectorAll('div').forEach(d =>
        d.addEventListener('mousedown', e => { e.preventDefault(); pick(+d.dataset.idx); }));
    } catch (e) { close(); }
  }

  input.addEventListener('input', e => {
    clearTimeout(acTimer);
    const v = e.target.value;
    acTimer = setTimeout(() => search(v), 220);
  });
  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('div');
    if (!items.length || list.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); }
    else if (e.key === 'Enter') { if (activeIdx >= 0) { e.preventDefault(); pick(activeIdx); } return; }
    else if (e.key === 'Escape') { close(); return; }
    items.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
  });
  window.addEventListener('scroll', () => { if (list.style.display === 'block') position(); }, true);
  document.addEventListener('mousedown', e => {
    if (list.style.display === 'block' && !list.contains(e.target) && e.target !== input) close();
  });
  new MutationObserver(() => { if (!document.body.contains(tr)) list.remove(); })
    .observe($('productBody'), { childList: true });
}

function applyStock(tr, code) {
  const el = tr.querySelector('.onhand-input');
  const s = STOCK_CACHE.get(String(code));
  if (s) el.value = s.available_qty;
}
function applyAms(tr, code) {
  const el = tr.querySelector('.ams-input');
  const a = AMS_CACHE.get(String(code));
  if (a) el.value = a.avg_ams;
}

/* --- calculations --- */
const SHIPPING_TERMS = ['FOB', 'EXW', 'FCA'];
function hasShipping() { return SHIPPING_TERMS.includes($('f_inco_term').value); }

function updateTermUI() {
  const term = $('f_inco_term').value, cur = $('f_currency').value, ship = hasShipping();
  $('productTable').classList.toggle('show-ship', ship);
  $('priceTh').textContent = `${term} (${cur})`;
  $('shipTh').textContent = `Shipping (${cur})`;
  $('totalTh').textContent = ship ? `Total ((${term}+Ship)×Qty) ${cur}` : `Total (${term}×Qty) ${cur}`;
  $('totalLabel').textContent = `Total Order Value (${cur})`;
  document.querySelectorAll('#productBody tr').forEach(recalcRow);
  recalcTotal();
}

function recalcRow(tr) {
  const price = numOr(tr.querySelector('.cif-input').value);
  const ship  = hasShipping() ? numOr(tr.querySelector('.ship-input').value) : 0;
  const qty   = numOr(tr.querySelector('.qty-input').value);
  const onhand = numOr(tr.querySelector('.onhand-input').value);
  const sdq    = numOr(tr.querySelector('.sdq-input').value);
  const ams    = numOr(tr.querySelector('.ams-input').value);
  const totalCell = tr.querySelector('.total-cell');
  const durCell   = tr.querySelector('.dur-cell');
  const hasTotal = tr.querySelector('.cif-input').value !== '' && tr.querySelector('.qty-input').value !== '';
  totalCell.textContent = hasTotal ? fmt2((price + ship) * qty) : '—';
  durCell.textContent = ams > 0 ? fmt2((sdq + onhand) / ams) : 'N/A';
}

function recalcTotal() {
  let sum = 0;
  document.querySelectorAll('#productBody tr .total-cell').forEach(td => {
    const v = parseFloat(td.textContent); if (isFinite(v)) sum += v;
  });
  $('totalOrderValue').textContent = fmt2(sum);
}

/* =========================================================
   USERS (super admin)
   ========================================================= */
async function loadUsers() {
  msg('usersMsg', 'Loading…');
  try {
    const data = await api('/api/users');
    const users = data.users || [];
    if (!users.length) { $('usersTableWrap').innerHTML = '<div class="empty-state">No users yet.</div>'; msg('usersMsg',''); return; }
    const rows = users.map(u => `
      <tr>
        <td>${esc(u.emp)}</td>
        <td>${esc(u.name)}</td>
        <td>${esc(u.designation || '')}</td>
        <td>${esc(u.role)}</td>
        <td>${esc(u.division || '')}</td>
        <td>${u.is_active ? 'Yes' : 'No'}</td>
        <td><button class="btn-sm btn-outline" data-emp="${esc(u.emp)}">Edit</button></td>
      </tr>`).join('');
    $('usersTableWrap').innerHTML = `
      <table class="data">
        <thead><tr><th>Emp</th><th>Name</th><th>Designation</th><th>Role</th><th>Division</th><th>Active</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    $('usersTableWrap').querySelectorAll('button[data-emp]').forEach(b =>
      b.addEventListener('click', () => editUser(b.dataset.emp)));
    msg('usersMsg','');
    $('userFormWrap').classList.add('hidden');
  } catch (e) { msg('usersMsg', e.message, 'err'); }
}

function editUser(emp) {
  $('userFormWrap').classList.remove('hidden');
  $('userFormTitle').textContent = 'Edit User ' + emp;
  $('u_emp').value = emp; $('u_emp').disabled = true;
  $('u_pwHint').textContent = '(leave blank to keep current)';
  msg('userMsg','');
  // fetch fresh from cached list (loadUsers already did)
  fetch(API_BASE + '/api/users', { headers: { Authorization: 'Bearer ' + CURRENT_TOKEN } })
    .then(r => r.json()).then(d => {
      const u = (d.users || []).find(x => x.emp === emp); if (!u) return;
      $('u_name').value = u.name || '';
      $('u_designation').value = u.designation || '';
      $('u_role').value = u.role;
      $('u_division').value = u.division || '';
      $('u_is_active').value = u.is_active ? '1' : '0';
      $('u_password').value = '';
    }).catch(()=>{});
}

function newUser() {
  $('userFormWrap').classList.remove('hidden');
  $('userFormTitle').textContent = 'New User';
  $('u_emp').value = ''; $('u_emp').disabled = false;
  $('u_name').value = ''; $('u_designation').value = ''; $('u_role').value = 'manager';
  $('u_division').value = ''; $('u_password').value = ''; $('u_is_active').value = '1';
  $('u_pwHint').textContent = '(required for new)';
  msg('userMsg','');
}

async function saveUser() {
  const emp = $('u_emp').value.trim();
  const isEdit = !!emp && $('u_emp').disabled;
  const body = {
    name: $('u_name').value.trim(),
    designation: $('u_designation').value.trim(),
    role: $('u_role').value,
    division: $('u_division').value.trim(),
    is_active: Number($('u_is_active').value),
  };
  const pw = $('u_password').value;
  msg('userMsg', 'Saving…');
  try {
    if (isEdit) {
      if (pw) body.password = pw;
      await api('/api/users/' + emp, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      if (!emp || !body.name || !pw) { msg('userMsg','emp, name and password required.','err'); return; }
      body.emp = emp; body.password = pw;
      await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    }
    msg('userMsg','Saved.', 'ok');
    await loadUsers();
  } catch (e) { msg('userMsg', e.message, 'err'); }
}

/* =========================================================
   PRODUCTS
   ========================================================= */
async function loadProducts() {
  msg('productsMsg', 'Loading…');
  try {
    const data = await api('/api/products');
    const list = data.products || [];
    renderProducts(list);
    msg('productsMsg', `${list.length} products.`);
  } catch (e) { msg('productsMsg', e.message, 'err'); }
}
function renderProducts(list) {
  const rows = list.slice(0, 500).map(p => `
    <tr><td>${esc(p.product_code)}</td><td>${esc(p.description)}</td><td>${esc(p.pack || '')}</td></tr>`).join('');
  $('productsTableWrap').innerHTML = list.length ? `
    <table class="data">
      <thead><tr><th>Code</th><th>Description</th><th>Pack</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${list.length > 500 ? '<div class="empty-state">Showing first 500 of ' + list.length + '. Use search.</div>' : ''}
  ` : '<div class="empty-state">No products.</div>';
}
let prodSearchTimer = null;
function onProductSearchInput(e) {
  clearTimeout(prodSearchTimer);
  const q = e.target.value.trim();
  prodSearchTimer = setTimeout(async () => {
    if (q.length < 2) { return; }
    try {
      const data = await api('/api/products/search?q=' + encodeURIComponent(q));
      renderProducts(data.products || []);
      msg('productsMsg', (data.products || []).length + ' matches');
    } catch (err) { msg('productsMsg', err.message, 'err'); }
  }, 250);
}

/* =========================================================
   STOCK UPLOAD
   ========================================================= */
async function loadStock() {
  msg('stockMsg', 'Loading…');
  try {
    const data = await api('/api/stock/latest');
    const list = data.stock || [];
    renderStock(list);
    msg('stockMsg', list.length + ' products with stock.');
    STOCK_CACHE.clear(); list.forEach(s => STOCK_CACHE.set(String(s.product_code), s));
  } catch (e) { msg('stockMsg', e.message, 'err'); }
}
function renderStock(list) {
  const rows = list.map(s => `<tr><td>${esc(s.product_code)}</td><td style="text-align:right">${s.available_qty}</td><td>${esc(s.stock_date)}</td></tr>`).join('');
  $('stockTableWrap').innerHTML = list.length ? `
    <table class="data"><thead><tr><th>Product Code</th><th>Available Qty</th><th>Stock Date</th></tr></thead>
    <tbody>${rows}</tbody></table>` : '<div class="empty-state">No stock uploaded yet.</div>';
}

async function readSpreadsheet(file) {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = await file.text();
    return parseCSV(text);
  }
  if (typeof XLSX === 'undefined') throw new Error('Excel parser not loaded. Save as CSV and retry.');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}
function parseCSV(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(cur); cur=''; rows.push(row); row=[]; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function uploadStock() {
  const f = $('stockFile').files[0]; if (!f) { msg('stockMsg','Choose a file first.','err'); return; }
  msg('stockMsg', 'Reading…');
  try {
    const rows = await readSpreadsheet(f);
    const header = (rows[0] || []).map(c => String(c).trim().toLowerCase());
    if (!/^row\s*labels|^product\s*code/.test(header[0] || ''))
      throw new Error('First column must be "Row Labels" or "Product Code".');
    const out = [];
    rows.slice(1).forEach(r => {
      const code = String(r[0] || '').trim();
      if (!code || /^grand\s*total$/i.test(code)) return;
      const qty = Number(String(r[1] || '').replace(/[,\s]/g,''));
      if (!isFinite(qty)) return;
      out.push({ product_code: code, available_qty: qty, stock_date: todayISO() });
    });
    if (!out.length) throw new Error('No data rows found.');
    msg('stockMsg', 'Uploading ' + out.length + ' rows…');
    const res = await api('/api/stock', { method: 'POST', body: JSON.stringify(out) });
    msg('stockMsg', 'Uploaded ' + res.inserted + ' rows.', 'ok');
    await loadStock();
    $('stockFile').value = '';
  } catch (e) { msg('stockMsg', e.message, 'err'); }
}

/* =========================================================
   AMS UPLOAD
   ========================================================= */
async function loadAms() {
  msg('amsMsg', 'Loading…');
  try {
    const data = await api('/api/ams');
    const list = data.ams || [];
    renderAms(list);
    msg('amsMsg', list.length + ' AMS records.');
    AMS_CACHE.clear(); list.forEach(a => AMS_CACHE.set(String(a.part_no), a));
  } catch (e) { msg('amsMsg', e.message, 'err'); }
}
function renderAms(list) {
  const rows = list.map(a => `<tr>
    <td>${esc(a.part_no)}</td>
    <td style="text-align:right">${a.sep_invoiced_qty ?? 0}</td>
    <td style="text-align:right">${a.oct_invoiced_qty ?? 0}</td>
    <td style="text-align:right">${a.nov_invoiced_qty ?? 0}</td>
    <td style="text-align:right">${a.avg_ams ?? 0}</td></tr>`).join('');
  $('amsTableWrap').innerHTML = list.length ? `
    <table class="data"><thead><tr><th>Part No</th><th>Sep</th><th>Oct</th><th>Nov</th><th>Avg AMS</th></tr></thead>
    <tbody>${rows}</tbody></table>` : '<div class="empty-state">No AMS uploaded yet.</div>';
}

async function uploadAms() {
  const f = $('amsFile').files[0]; if (!f) { msg('amsMsg','Choose a file first.','err'); return; }
  msg('amsMsg', 'Reading…');
  try {
    const rows = await readSpreadsheet(f);
    const header = (rows[0] || []).map(c => String(c).trim());
    const MONTH_RE = /^([A-Za-z]+)[\s_]*invoiced[\s_]*quantity$/i;
    const months = [1,2,3].map(i => (MONTH_RE.exec(header[i] || '') || [])[1]);
    if (!/^part\s*no/i.test(header[0] || '') || months.some(m => !m))
      throw new Error('Expected 4 columns: "Part No", then three "<Month>_Invoiced Quantity".');
    const out = [];
    rows.slice(1).forEach(r => {
      const part = String(r[0] || '').trim(); if (!part) return;
      const sep = Number(String(r[1] || '').replace(/[,\s]/g,'')) || 0;
      const oct = Number(String(r[2] || '').replace(/[,\s]/g,'')) || 0;
      const nov = Number(String(r[3] || '').replace(/[,\s]/g,'')) || 0;
      out.push({ part_no: part, sep, oct, nov, avg: Math.round(((sep+oct+nov)/3)*100)/100 });
    });
    if (!out.length) throw new Error('No data rows found.');
    msg('amsMsg', 'Uploading ' + out.length + ' rows…');
    const res = await api('/api/ams', { method: 'POST', body: JSON.stringify(out) });
    msg('amsMsg', 'Uploaded ' + res.upserted + ' rows.', 'ok');
    await loadAms();
    $('amsFile').value = '';
  } catch (e) { msg('amsMsg', e.message, 'err'); }
}

/* =========================================================
   EVENT WIRING + BOOT
   ========================================================= */
window.addEventListener('DOMContentLoaded', () => {
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').addEventListener('click', logout);

  $('btnNewOrder').addEventListener('click', newOrder);
  $('btnRefreshOrders').addEventListener('click', loadOrders);
  $('btnAddRow').addEventListener('click', () => { addProductRow(); });

  $('f_inco_term').addEventListener('change', updateTermUI);
  $('f_currency').addEventListener('change', updateTermUI);

  $('btnNewUser').addEventListener('click', newUser);
  $('btnRefreshUsers').addEventListener('click', loadUsers);
  $('btnSaveUser').addEventListener('click', saveUser);
  $('btnCancelUser').addEventListener('click', () => $('userFormWrap').classList.add('hidden'));

  $('prodSearch').addEventListener('input', onProductSearchInput);
  $('btnUploadStock').addEventListener('click', uploadStock);
  $('btnUploadAms').addEventListener('click', uploadAms);

  if (!restoreSession()) $('loginView').classList.remove('hidden');
});