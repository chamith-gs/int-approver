const API = 'https://dark-truth-f3df.chamith-c96.workers.dev/api';
const APP_ID = 'int_purchase_order';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt2 = n => isFinite(n) ? Number(n).toFixed(2) : '0.00';
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const SHIPPING_TERMS = ['FOB','EXW','FCA'];
const getTerm = () => $('incoTerm').value;
const getCurrency = () => $('currency').value;
const hasShipping = () => SHIPPING_TERMS.includes(getTerm());

let token = sessionStorage.getItem('po_jwt') || '';
let me = null, caps = {}, perm = { review:false, approve:false }, cur = null, mySig = null;
let PRODUCTS = [];
const isAdmin = () => !!caps.manage_data;
const roleLabel = r => String(r || '').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
const safeSig = s => (typeof s === 'string' && /^data:image\/png;base64,/.test(s)) ? s : null;

function goHome() { location.replace('index.html'); }
function logout() { sessionStorage.removeItem('po_jwt'); goHome(); }

async function api(path, method='GET', payload) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type':'application/json', Authorization:'Bearer ' + token },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || (r.status === 403 && /password change/i.test(j.error || ''))) { logout(); throw new Error(j.error || 'Signed out'); }
  if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
  return j;
}

function toast(m, bad) {
  const t = $('toast'); t.textContent = m; t.className = bad ? 'err' : ''; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 4500);
}

const openModal = id => $(id).classList.add('show');
const closeModal = id => $(id).classList.remove('show');
document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('mousedown', e => { if (e.target === m) m.classList.remove('show'); });
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.classList.remove('show'));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'));
});

function updatePaymentUI() { $('ttDaysWrap').style.display = $('paymentMethod').value === 'T/T' ? '' : 'none'; }
function updateOnHandHeader() { const d = $('orderDate').value; $('onHandTh').textContent = d ? 'On Hand Balance at ' + d : 'On Hand Balance'; }
function syncMonthFromDate() {
  const d = $('orderDate').value; if (!d) return;
  const m = Number(d.split('-')[1]); if (!m) return;
  $('month').value = ['January','February','March','April','May','June','July','August','September','October','November','December'][m-1] || '';
}
function updateTermUI() {
  const term = getTerm(), cur2 = getCurrency(), ship = hasShipping();
  $('productTable').classList.toggle('show-ship', ship);
  $('priceTh').textContent = `${term} (${cur2})`;
  $('shipTh').textContent = `Shipping (${cur2})`;
  const totalLabel = ship ? `Total ((${term}+Shipping)×Qty) ${cur2}` : `Total (${term}×Qty) ${cur2}`;
  $('totalTh').textContent = totalLabel; $('totalLabel').textContent = `Total Order Value (${cur2})`;
  document.querySelectorAll('#productBody tr').forEach(tr => recalcRow(tr));
  recalcTotal();
}
$('orderDate').addEventListener('input', () => { updateOnHandHeader(); syncMonthFromDate(); });
$('incoTerm').addEventListener('change', updateTermUI);
$('currency').addEventListener('change', updateTermUI);
$('paymentMethod').addEventListener('change', updatePaymentUI);

function autoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function addRow(data = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="c-code" data-label="Product Code"><input type="text" class="code-input" autocomplete="off" placeholder="code"></td>
    <td class="c-desc" data-label="Description"><textarea class="desc-input" rows="1" placeholder="description"></textarea></td>
    <td class="num c-packs" data-label="Packs"><input type="text" class="packs-input num"></td>
    <td class="num c-price price-td" data-label="Price"><input type="number" step="0.01" class="cif-input num"></td>
    <td class="num c-ship ship-col" data-label="Shipping"><input type="number" step="0.01" class="ship-input num"></td>
    <td class="num c-onhand" data-label="On Hand"><input type="text" class="onhand-input num"></td>
    <td class="num c-sdq" data-label="SDQ"><input type="text" class="sdq-input num"></td>
    <td class="num c-qty" data-label="Qty"><input type="number" step="1" class="qty-input num"></td>
    <td class="calc total-cell c-total" data-label="Total">—</td>
    <td class="num c-ams" data-label="AMS"><input type="number" step="0.01" class="ams-input num"></td>
    <td class="calc dur-cell c-dur" data-label="Stock Duration">—</td>
    <td class="num c-free" data-label="Free Goods"><input type="text" class="free-goods-input num"></td>
    <td class="c-urg" data-label="Urgency">
      <select class="shipment-input"><option value="">—</option><option>Immediate</option><option>Urgent</option><option>Normal</option><option>Low</option><option>On Hold</option><option value="__date__">Pick a date…</option></select>
      <input type="date" class="shipment-date" style="display:none;width:100%;margin-top:4px;font-size:11px">
    </td>
    <td class="c-eta" data-label="ETA"><input type="date" class="eta-input"></td>
    <td class="c-del"><button class="del-btn" title="Remove row">×</button></td>`;
  $('productBody').appendChild(tr);
  const desc = tr.querySelector('.desc-input');
  desc.addEventListener('input', () => autoGrow(desc));
  wireAutocomplete(tr, 'code');
  wireAutocomplete(tr, 'desc');
  tr.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('input', () => { recalcRow(tr); recalcTotal(); }));
  tr.querySelector('.del-btn').addEventListener('click', () => { tr.remove(); if (!document.querySelector('#productBody tr')) addRow(); recalcTotal(); });
  tr.querySelector('.shipment-input').addEventListener('change', e => {
    const d = tr.querySelector('.shipment-date');
    if (e.target.value === '__date__') { d.style.display = 'block'; d.focus(); } else { d.style.display = 'none'; d.value = ''; }
  });
  if (data.code) tr.querySelector('.code-input').value = data.code;
  if (data.description) { desc.value = data.description; autoGrow(desc); }
  if (data.packs) tr.querySelector('.packs-input').value = data.packs;
  updateTermUI();
  return tr;
}

const acList = document.createElement('div');
acList.className = 'ac-list';
document.body.appendChild(acList);
let ac = { input:null, tr:null, kind:'', matches:[], idx:-1 };

function acClose() { acList.style.display = 'none'; acList.innerHTML = ''; ac.idx = -1; }
function acPosition() {
  const r = ac.input.getBoundingClientRect();
  acList.style.left = r.left + 'px'; acList.style.top = (r.bottom + 4) + 'px'; acList.style.width = Math.max(r.width, 320) + 'px';
}
function acShow(input, tr, kind) {
  const q = input.value.trim().toLowerCase();
  ac = { input, tr, kind, matches:[], idx:-1 };
  if (q.length < 2) { acClose(); return; }
  const f = kind === 'code' ? 'cl' : 'dl', m = [];
  for (const p of PRODUCTS) { if (p[f].includes(q)) { m.push(p); if (m.length >= 50) break; } }
  if (!m.length) { acClose(); return; }
  ac.matches = m;
  acList.innerHTML = m.map((p, i) =>
    `<div data-idx="${i}"><span class="code">${esc(p.code)}</span><span class="desc">${esc(p.description)}</span><span class="packs">${esc(p.packs)}</span></div>`).join('');
  acList.style.display = 'block'; acPosition();
}
function acPick(i) {
  const p = ac.matches[i]; if (!p) return;
  const tr = ac.tr;
  tr.querySelector('.code-input').value = p.code || '';
  const d = tr.querySelector('.desc-input'); d.value = p.description || ''; autoGrow(d);
  tr.querySelector('.packs-input').value = p.packs || '';
  applyAms(tr, p.code); applyStock(tr, p.code);
  acClose(); recalcRow(tr); recalcTotal();
}
function wireAutocomplete(tr, kind) {
  const input = tr.querySelector('.' + kind + '-input');
  input.addEventListener('input', () => acShow(input, tr, kind));
  input.addEventListener('focus', () => { if (input.value) acShow(input, tr, kind); });
  input.addEventListener('keydown', e => {
    if (ac.input !== input || acList.style.display === 'none') return;
    const items = acList.querySelectorAll('div'); if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      ac.idx = e.key === 'ArrowDown' ? Math.min(ac.idx + 1, items.length - 1) : Math.max(ac.idx - 1, 0);
      items.forEach((d, i) => d.classList.toggle('active', i === ac.idx));
      items[ac.idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && ac.idx >= 0) { e.preventDefault(); acPick(ac.idx); }
    else if (e.key === 'Escape') acClose();
  });
}
acList.addEventListener('mousedown', e => { const d = e.target.closest('[data-idx]'); if (d) { e.preventDefault(); acPick(+d.dataset.idx); } });
document.addEventListener('mousedown', e => { if (acList.style.display === 'block' && !acList.contains(e.target) && e.target !== ac.input) acClose(); });
window.addEventListener('scroll', () => { if (acList.style.display === 'block') acPosition(); }, true);

const numOf = el => { const v = parseFloat(el.value); return isFinite(v) ? v : 0; };
function recalcRow(tr) {
  const price = numOf(tr.querySelector('.cif-input'));
  const ship = hasShipping() ? numOf(tr.querySelector('.ship-input')) : 0;
  const qty = numOf(tr.querySelector('.qty-input'));
  const onhand = numOf(tr.querySelector('.onhand-input'));
  const sdq = numOf(tr.querySelector('.sdq-input'));
  const ams = numOf(tr.querySelector('.ams-input'));
  const hasTotal = tr.querySelector('.cif-input').value !== '' && tr.querySelector('.qty-input').value !== '';
  tr.querySelector('.total-cell').textContent = hasTotal ? fmt2((price + ship) * qty) : '—';
  tr.querySelector('.dur-cell').textContent = ams > 0 ? fmt2((sdq + onhand) / ams) : 'N/A';
}
function recalcTotal() {
  let sum = 0;
  document.querySelectorAll('#productBody .total-cell').forEach(td => { const v = parseFloat(td.textContent); if (isFinite(v)) sum += v; });
  $('totalOrderValue').textContent = fmt2(sum);
}

const csvEscape = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
function exportCSV() {
  const term = getTerm(), cur2 = getCurrency(), ship = hasShipping(), pay = $('paymentMethod').value;
  const rows = [['INTERNAL PURCHASE ORDER'],[],['Supplier',$('supplier').value],['Month',$('month').value],['Order Ref No',$('orderRef').value],['Date',$('orderDate').value],['INCO Terms',term],['Currency',cur2],['Payment Method',pay + (pay === 'T/T' && $('ttDays').value ? ' [' + $('ttDays').value + ' days]' : '')],['Shipping Method',$('shippingMethod').value],['Market',$('market').value],[]];
  const head = ['Product Code','Description','Packs',`${term} (${cur2})`];
  if (ship) head.push(`Shipping (${cur2})`);
  head.push('On Hand','SDQ','Qty',$('totalTh').textContent,'AMS','Stock Duration','Free Goods','Urgency','ETA');
  rows.push(head);
  document.querySelectorAll('#productBody tr').forEach(tr => {
    const sel = tr.querySelector('.shipment-input').value;
    const urg = sel === '__date__' ? tr.querySelector('.shipment-date').value : sel;
    const total = tr.querySelector('.total-cell').textContent;
    const r = [tr.querySelector('.code-input').value, tr.querySelector('.desc-input').value, tr.querySelector('.packs-input').value, tr.querySelector('.cif-input').value];
    if (ship) r.push(tr.querySelector('.ship-input').value);
    r.push(tr.querySelector('.onhand-input').value, tr.querySelector('.sdq-input').value, tr.querySelector('.qty-input').value, total === '—' ? '' : total, tr.querySelector('.ams-input').value, tr.querySelector('.dur-cell').textContent, tr.querySelector('.free-goods-input').value, urg, tr.querySelector('.eta-input').value);
    rows.push(r);
  });
  rows.push([], ['Notes',$('notes').value],[], [`Total Order Value (${cur2})`, $('totalOrderValue').textContent]);
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `PurchaseOrder_${$('orderRef').value || 'purchase-order'}_${todayISO()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = []; let row = [], cur2 = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cur2 += '"'; i++; } else q = false; } else cur2 += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur2); cur2 = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(cur2); cur2 = ''; rows.push(row); row = []; }
    else cur2 += c;
  }
  if (cur2 !== '' || row.length) { row.push(cur2); rows.push(row); }
  return rows;
}
async function readRows(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCSV(await file.text());
  if (typeof XLSX === 'undefined') throw new Error('Excel reader unavailable. Save as CSV.');
  const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:true, defval:'' });
}
const keyOf = v => String(v == null ? '' : v).trim().toLowerCase();
const round2 = n => Math.round(n * 100) / 100;
const setMsg = (id, text, kind) => { const m = $(id); m.textContent = text || ''; m.className = 'pm-msg ' + (kind || ''); };

let AMS_MAP = new Map(), AMS_MONTHS = [];
const MONTH_RE = /^([A-Za-z]+)[\s_]*invoiced[\s_]*quantity$/i;
function applyAms(tr, code) {
  const el = tr.querySelector('.ams-input'), e = AMS_MAP.get(keyOf(code));
  if (e) { el.value = e.avg; el.title = 'Average of ' + AMS_MONTHS.join(', '); }
  else { el.title = 'No AMS found for this product'; }
}
async function loadAms() {
  try {
    const j = await api('/ams');
    if (j.months && j.months.length === 3) {
      AMS_MONTHS = j.months;
      AMS_MAP = new Map((j.ams || []).map(r => [keyOf(r.part_no), r]));
      $('amsInfo').textContent = `AMS loaded: ${j.months.join(' · ')} · ${j.ams.length} parts.`;
    }
  } catch (e) { $('amsInfo').textContent = 'AMS not loaded.'; }
}
$('amsFile').addEventListener('change', async e => {
  const inp = e.target, f = inp.files && inp.files[0]; if (!f) return;
  setMsg('amsMsg', 'Reading ' + f.name + '…');
  try {
    const allRows = await readRows(f);
    const numbered = allRows.map((r, i) => ({ r, n: i+1 })).filter(x => x.r.some(c => String(c == null ? '' : c).trim() !== ''));
    if (!numbered.length) throw new Error('The file is empty.');
    const head = numbered[0].r.map(c => String(c == null ? '' : c).trim());
    while (head.length && head[head.length-1] === '') head.pop();
    const months = [1,2,3].map(i => (MONTH_RE.exec(head[i] || '') || [])[1]);
    if (head.length !== 4 || !/^part\s*no\.?$/i.test(head[0]) || !months.every(Boolean)) throw new Error('Wrong structure. Need Part No + 3 Invoiced Quantity columns.');
    const labels = months.map(m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
    const rows = [];
    numbered.slice(1).forEach(({ r }) => {
      const part = String(r[0] == null ? '' : r[0]).trim(); if (!part) return;
      const vals = [1,2,3].map(i => { const raw = r[i]; if (raw === '' || raw == null) return 0; const v = Number(String(raw).replace(/,/g,'')); return isFinite(v) ? v : 0; });
      rows.push({ part_no: part, vals });
    });
    if (!rows.length) throw new Error('No data rows.');
    setMsg('amsMsg', 'Saving ' + rows.length + ' rows…');
    await api('/ams', 'POST', { months: labels, rows });
    setMsg('amsMsg', '✓ ' + rows.length + ' AMS records saved (' + labels.join(', ') + ').', 'ok');
    await loadAms();
  } catch (err) { setMsg('amsMsg', err.message, 'err'); }
  finally { inp.value = ''; }
});

let STK_MAP = new Map(), STK_DATE = '';
function applyStock(tr, code) {
  const el = tr.querySelector('.onhand-input'), e = STK_MAP.get(keyOf(code));
  if (e) { el.value = e.qty; el.title = 'Available qty' + (STK_DATE ? ' as of ' + STK_DATE : ''); }
}
async function loadStock() {
  try {
    const j = await api('/stock/latest');
    STK_DATE = j.stock_date || '';
    STK_MAP = new Map((j.stock || []).map(r => [keyOf(r.product_code), r]));
    $('stkInfo').textContent = `Stock: ${j.stock.length} products${STK_DATE ? ' as of ' + STK_DATE : ''}.`;
  } catch (e) { $('stkInfo').textContent = 'Stock not loaded.'; }
}
$('stkFile').addEventListener('change', async e => {
  const inp = e.target, f = inp.files && inp.files[0]; if (!f) return;
  setMsg('stkMsg', 'Reading ' + f.name + '…');
  try {
    const allRows = await readRows(f);
    const numbered = allRows.map((r, i) => ({ r, n: i+1 })).filter(x => x.r.some(c => String(c == null ? '' : c).trim() !== ''));
    if (!numbered.length) throw new Error('The file is empty.');
    const head = numbered[0].r.map(c => String(c == null ? '' : c).trim());
    if (head.length < 2 || !/^(row\s*labels|product\s*code)$/i.test(head[0])) throw new Error('Wrong structure. Need "Row Labels" and "Sum of Available Qty".');
    const map = new Map();
    numbered.slice(1).forEach(({ r }) => {
      const code = String(r[0] == null ? '' : r[0]).trim();
      if (!code || /^grand\s*total$/i.test(code)) return;
      const raw = r[1]; let q = 0;
      if (raw !== '' && raw != null) { q = Number(String(raw).replace(/[,\s\u00a0]/g,'')); if (!isFinite(q)) q = 0; }
      map.set(code, (map.get(code) || 0) + q);
    });
    const rows = [...map].map(([product_code, available_qty]) => ({ product_code, available_qty }));
    if (!rows.length) throw new Error('No data rows.');
    setMsg('stkMsg', 'Saving ' + rows.length + ' rows (batched)…');
    await api('/stock', 'POST', { stock_date: todayISO(), rows });
    setMsg('stkMsg', '✓ ' + rows.length + ' products saved; previous stock replaced.', 'ok');
    await loadStock();
  } catch (err) { setMsg('stkMsg', err.message, 'err'); }
  finally { inp.value = ''; }
});

async function loadProducts() {
  try {
    const j = await api('/products');
    PRODUCTS = (j.products || []).map(p => { const code = p.product_code || '', description = p.description || ''; return { code, description, packs:p.pack || '', cl:code.toLowerCase(), dl:description.toLowerCase() }; });
  } catch (e) { PRODUCTS = []; }
}

let pmSelected = null, pmMatches = [], pmActive = -1;
const pmMsg = (t, k) => setMsg('pmMsg', t, k);
const pmCloseList = () => { $('pmList').style.display = 'none'; pmActive = -1; };
const pmReadForm = () => ({ code:$('pmCode').value.trim(), description:$('pmDesc').value.trim(), packs:$('pmPacks').value.trim() });
function pmClear() {
  pmSelected = null;
  ['pmSearch','pmCode','pmDesc','pmPacks'].forEach(id => $(id).value = '');
  $('pmUpdateBtn').disabled = true; pmCloseList(); pmMsg('');
}
function pmSelect(p) {
  pmSelected = p;
  $('pmSearch').value = p.code; $('pmCode').value = p.code; $('pmDesc').value = p.description; $('pmPacks').value = p.packs;
  $('pmUpdateBtn').disabled = false; pmCloseList(); pmMsg('');
}
function pmSearchRun() {
  const q = $('pmSearch').value.trim().toLowerCase(), list = $('pmList');
  pmMatches = [];
  if (q.length >= 2) { for (const p of PRODUCTS) { if (p.cl.includes(q) || p.dl.includes(q)) { pmMatches.push(p); if (pmMatches.length >= 50) break; } } }
  if (!pmMatches.length) { pmCloseList(); return; }
  list.innerHTML = pmMatches.map((p, i) => `<div data-idx="${i}" style="padding:8px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid #f1f3f7"><b>${esc(p.code)}</b> ${esc(p.description)}</div>`).join('');
  list.style.display = 'block'; pmActive = -1;
}
$('pmList').addEventListener('mousedown', e => { const d = e.target.closest('[data-idx]'); if (d) { e.preventDefault(); pmSelect(pmMatches[+d.dataset.idx]); } });
$('pmSearch').addEventListener('input', pmSearchRun);
$('pmClearBtn').onclick = pmClear;

$('pmUpdateBtn').onclick = async () => {
  if (!pmSelected) return;
  const r = pmReadForm(); if (!r.code) return pmMsg('Code required.', 'err');
  try {
    await api('/products', 'POST', { product_code:r.code, description:r.description, pack:r.packs });
    await loadProducts(); pmMsg('✓ Updated.', 'ok');
  } catch (e) { pmMsg(e.message, 'err'); }
};
$('pmAddBtn').onclick = async () => {
  const r = pmReadForm(); if (!r.code) return pmMsg('Code required.', 'err');
  try { await api('/products', 'POST', { product_code:r.code, description:r.description, pack:r.packs }); await loadProducts(); pmClear(); pmMsg('✓ Added.', 'ok'); }
  catch (e) { pmMsg(e.message, 'err'); }
};
$('pmImport').onclick = async () => {
  const seed = Array.isArray(window.PRODUCTS_DATA) ? window.PRODUCTS_DATA : [];
  if (!seed.length) return pmMsg('products.js not loaded on this page.', 'err');
  if (!confirm('Upload ' + seed.length + ' products?')) return;
  try {
    pmMsg('Uploading…');
    for (let i = 0; i < seed.length; i += 1000)
      await api('/products/bulk', 'POST', { rows: seed.slice(i, i + 1000).map(p => ({ product_code:p.code, description:p.description, pack:p.packs })) });
    await loadProducts(); pmMsg('✓ Imported.', 'ok');
  } catch (e) { pmMsg(e.message, 'err'); }
};

const nz = x => (x === '' || x == null || !isFinite(+x)) ? null : +x;
const val = (tr, s) => tr.querySelector(s).value;

function collect() {
  const items = [...document.querySelectorAll('#productBody tr')].map(tr => {
    const sel = val(tr, '.shipment-input');
    return {
      product_code: val(tr, '.code-input').trim(), description: val(tr, '.desc-input').trim(), packs: val(tr, '.packs-input'),
      price: nz(val(tr, '.cif-input')), shipping: hasShipping() ? nz(val(tr, '.ship-input')) : null, on_hand: nz(val(tr, '.onhand-input')),
      sdq: nz(val(tr, '.sdq-input')), quantity: nz(val(tr, '.qty-input')), total: nz(tr.querySelector('.total-cell').textContent),
      ams: nz(val(tr, '.ams-input')), stock_duration: nz(tr.querySelector('.dur-cell').textContent), free_goods: val(tr, '.free-goods-input'),
      urgency: sel === '__date__' ? val(tr, '.shipment-date') : sel, eta: val(tr, '.eta-input'),
    };
  }).filter(i => i.product_code || i.description);
  const tt = $('paymentMethod').value === 'T/T';
  return {
    app_id: APP_ID, items,
    header: {
      supplier: $('supplier').value, order_date: $('orderDate').value, month: $('month').value, order_ref: $('orderRef').value,
      inco_term: getTerm(), currency: getCurrency(), payment_method: $('paymentMethod').value, credit_days: tt ? nz($('ttDays').value) : null,
      shipping_method: $('shippingMethod').value, market: $('market').value, notes: $('notes').value,
      total_value: parseFloat($('totalOrderValue').textContent) || 0,
    },
  };
}

function fill(o) {
  const s = (id, x) => { $(id).value = x == null ? '' : x; };
  s('supplier', o.supplier); s('orderDate', o.order_date || todayISO()); s('month', o.month); s('orderRef', o.order_ref);
  s('incoTerm', o.inco_term || 'CIF'); s('currency', o.currency || 'USD'); s('paymentMethod', o.payment_method || 'L/C'); s('ttDays', o.credit_days);
  s('shippingMethod', o.shipping_method || 'Air freight'); s('market', o.market || 'Tender Market'); s('notes', o.notes);
  if (!o.month) syncMonthFromDate();
  updatePaymentUI(); $('productBody').innerHTML = '';
  (o.items && o.items.length ? o.items : [{}]).forEach(it => {
    const tr = addRow({ code: it.product_code, description: it.description, packs: it.packs });
    [['.cif-input', it.price],['.ship-input', it.shipping],['.onhand-input', it.on_hand],['.sdq-input', it.sdq],['.qty-input', it.quantity],['.ams-input', it.ams],['.free-goods-input', it.free_goods],['.eta-input', it.eta]].forEach(([sel, x]) => { tr.querySelector(sel).value = x == null ? '' : x; });
    const sel = tr.querySelector('.shipment-input'), u = it.urgency || '';
    if ([...sel.options].some(op => op.value === u)) sel.value = u;
    else if (u) { sel.value = '__date__'; const d = tr.querySelector('.shipment-date'); d.style.display = 'block'; d.value = u; }
  });
  updateTermUI(); updateOnHandHeader(); recalcTotal();
}

function paintSigs(o) {
  [['Prep', o?.prepared_sig, o?.created_by_name || o?.prepared_by, o?.submitted_at],
   ['Rev', o?.reviewed_sig, o?.reviewed_by_name, o?.reviewed_at],
   ['App', o?.approved_sig, o?.approved_by_name, o?.approved_at]].forEach(([k, sig, name, at]) => {
    sig = safeSig(sig);
    $('sig' + k).innerHTML = sig ? `<img src="${sig}" alt="signature">` : '<span class="sig-ph">—</span>';
    $('sig' + k + 'N').textContent = name || '';
    $('sig' + k + 'D').textContent = sig && at ? at.slice(0, 16) : '';
  });
}

const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
const STAGES = [
  { key:'draft',            label:'Draft' },
  { key:'in_review',        label:'Submitted' },
  { key:'pending_approval', label:'Reviewed' },
  { key:'approved',         label:'Approved' },
  { key:'rejected',         label:'Rejected' },
];
const stageLabel = k => (STAGES.find(s => s.key === k) || { label: String(k || '').replace(/_/g, ' ') }).label;
let ORDERS = [], activeTab = 'draft', ordQuery = '';
const visibleStages = () => STAGES.filter(s => s.key !== 'draft' || caps.prepare);

function refreshUi() {
  const st = cur ? cur.status : 'new', mgr = !!caps.prepare, mine = !cur || cur.created_by === me.emp;
  const edit = mgr && mine && (st === 'new' || st === 'draft');
  const rev = st === 'in_review' && perm.review && cur && cur.created_by !== me.emp;
  const apr = st === 'pending_approval' && perm.approve && cur && cur.created_by !== me.emp && cur.reviewed_by !== me.emp;
  show('bNew', mgr); show('bSave', edit); show('bSubmit', edit); show('bAddRow', edit || rev);
  show('bReview', rev); show('bApprove', apr); show('bReject', rev || apr);
  show('bProducts', isAdmin()); show('bAms', isAdmin()); show('bStock', isAdmin());
  show('sheetBody', !!cur || mgr); show('emptyHint', !cur && !mgr);
  $('stChip').textContent = cur ? `#${cur.id} · ${stageLabel(st)}` : 'New order';
  $('sheetBody').classList.toggle('ro', !(edit || rev));
  renderOrders();
}

function newOrder() { cur = null; fill({}); paintSigs(null); refreshUi(); }

async function openOrder(id) {
  const { order } = await api('/orders/' + id);
  cur = order; fill(order); paintSigs(order);
  if (STAGES.some(s => s.key === order.status)) activeTab = order.status;
  refreshUi();
  if (order.reject_reason && order.status === 'draft') toast('Returned by reviewer: ' + order.reject_reason, true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadOrders() {
  try { ORDERS = (await api('/orders?app_id=' + APP_ID)).orders || []; }
  catch (e) { ORDERS = []; toast(e.message, true); }
  renderOrders();
}

function renderOrders() {
  const stages = visibleStages();
  if (!stages.some(s => s.key === activeTab)) activeTab = stages[0].key;
  const count = k => ORDERS.filter(o => o.status === k).length;
  $('ordTabs').innerHTML = stages.map(s =>
    `<button class="tab ${s.key === activeTab ? 'on' : ''}" role="tab" data-tab="${s.key}">${s.label}<span class="cnt">${count(s.key)}</span></button>`).join('');
  const q = ordQuery.trim().toLowerCase();
  const rows = ORDERS.filter(o => o.status === activeTab && (!q ||
    String(o.id).includes(q) || (o.supplier || '').toLowerCase().includes(q) || (o.order_ref || '').toLowerCase().includes(q) || (o.created_by_name || '').toLowerCase().includes(q)));
  $('ordList').innerHTML = rows.length ? rows.map(o => {
    const who = activeTab === 'approved' ? 'Approved by ' + (o.approved_by_name || '—')
      : activeTab === 'pending_approval' ? 'Reviewed by ' + (o.reviewed_by_name || '—') : (o.created_by_name || '');
    const note = o.reject_reason && (o.status === 'draft' || o.status === 'rejected') ? ` <span class="rj" title="${esc(o.reject_reason)}">↩ ${esc(o.reject_reason)}</span>` : '';
    const del = o.status === 'draft' && caps.prepare && o.created_by === me.emp ? `<button class="del-btn" data-del="${o.id}" title="Delete draft">×</button>` : '<span></span>';
    return `<div class="ord-row ${cur && cur.id === o.id ? 'sel' : ''}" data-id="${o.id}"><b>#${o.id}</b>` +
      `<span class="g">${esc(o.supplier || '(no supplier)')}${o.order_ref ? ' · ' + esc(o.order_ref) : ''}${note}</span>` +
      `<span class="g">${esc(who)}</span><span class="g">${esc(String(o.order_date || o.created_at || '').slice(0, 10))}</span>` +
      `<span class="amt">${esc(Number(o.total_value || 0).toFixed(2))} ${esc(o.currency || '')}</span>${del}</div>`;
  }).join('') : `<div class="empty">No ${esc(stageLabel(activeTab).toLowerCase())} orders${q ? ' match your search' : ''}.</div>`;
}

$('ordTabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { activeTab = t.dataset.tab; renderOrders(); } });
$('ordSearch').addEventListener('input', e => { ordQuery = e.target.value; renderOrders(); });
$('ordList').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    e.stopPropagation();
    if (!confirm('Delete draft #' + d.dataset.del + '?')) return;
    try { await api('/orders/' + d.dataset.del, 'DELETE'); if (cur && String(cur.id) === d.dataset.del) newOrder(); await loadOrders(); toast('Draft deleted'); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const row = e.target.closest('.ord-row'); if (!row) return;
  try { await openOrder(row.dataset.id); } catch (err) { toast(err.message, true); }
});

async function act(kind) {
  try {
    if (['submit','review','approve'].includes(kind) && !mySig) return toast('Upload your PNG signature first.', true);
    const data = collect();
    if (kind === 'save' || kind === 'submit') {
      if (kind === 'submit' && !confirm('Submit for review? Your signature will be applied automatically.')) return;
      if (cur && cur.id) await api('/orders/' + cur.id, 'PUT', data);
      else { const r = await api('/orders', 'POST', data); cur = { id:r.id, status:'draft', created_by:me.emp }; }
      if (kind === 'submit') await api(`/orders/${cur.id}/submit`, 'PATCH');
    } else if (kind === 'review') {
      await api(`/orders/${cur.id}/review-edit`, 'PUT', data);
      await api(`/orders/${cur.id}/review`, 'PATCH');
    } else if (kind === 'approve') {
      if (!confirm('Approve this order? Your signature will be applied.')) return;
      await api(`/orders/${cur.id}/approve`, 'PATCH');
    } else if (kind === 'reject') {
      const reason = prompt('Reason for rejection (required):'); if (!reason) return;
      const r = await api(`/orders/${cur.id}/reject`, 'PATCH', { reason });
      activeTab = 'rejected'; newOrder(); await loadOrders();
      toast(`Rejected. Draft #${r.draft_id} returned to preparer.`); return;
    }
    await loadOrders();
    await openOrder(cur.id);
    toast({ save:'Draft saved', submit:'Submitted for review', review:'Reviewed — sent for approval', approve:'Approved' }[kind]);
  } catch (e) { toast(e.message, true); }
}

function paintMySig() { $('sigPrev').innerHTML = mySig ? `<img src="${mySig}" alt="signature">` : '<span class="sig-ph">No signature uploaded</span>'; }
$('bSig').onclick = () => { setMsg('sigMsg',''); openModal('sigModal'); paintMySig(); };
$('sigFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.type !== 'image/png') return setMsg('sigMsg', 'Please choose a PNG file.', 'err');
  if (f.size > 150 * 1024) return setMsg('sigMsg', 'File too large (max 150 KB).', 'err');
  const rd = new FileReader();
  rd.onload = () => { $('sigPrev').innerHTML = `<img src="${rd.result}" alt="signature">`; $('sigSave').disabled = false; $('sigSave').dataset.d = rd.result; setMsg('sigMsg',''); };
  rd.readAsDataURL(f);
};
$('sigSave').onclick = async () => {
  try {
    await api('/me/profile', 'PATCH', { signature_image: $('sigSave').dataset.d });
    mySig = $('sigSave').dataset.d; $('sigSave').disabled = true; setMsg('sigMsg', '✓ Signature saved.', 'ok');
  } catch (e) { setMsg('sigMsg', e.message, 'err'); }
};

$('bBack').onclick = goHome;
$('bOut').onclick = logout;
$('bNew').onclick = () => { if (confirm('Start new order? Unsaved changes lost.')) newOrder(); };
$('bList').onclick = () => { const p = $('ordPanel'); p.hidden = !p.hidden; if (!p.hidden) loadOrders(); };
$('bAddRow').onclick = () => addRow();
$('bCsv').onclick = exportCSV;
$('bPrint').onclick = () => window.print();
$('bProducts').onclick = () => { pmClear(); openModal('pmModal'); $('pmSearch').focus(); };
$('bAms').onclick = () => { setMsg('amsMsg',''); openModal('amsModal'); };
$('bStock').onclick = () => { setMsg('stkMsg',''); openModal('stkModal'); };
['Save','Submit','Review','Approve','Reject'].forEach(k => { $('b' + k).onclick = () => act(k.toLowerCase()); });

async function boot() {
  try {
    const r = await api('/me');
    me = r.user; caps = r.caps || {};
    if (me.must_change_password) return goHome();
    mySig = safeSig(me.signature_image); paintMySig();
    const cfg = (await api('/app-config')).apps.find(a => a.app_id === APP_ID);
    perm = { review: cfg?.can_review === 1, approve: cfg?.can_approve === 1 };
    $('whoChip').textContent = `${me.name} · ${roleLabel(me.role)}`;
    activeTab = caps.prepare ? 'draft' : perm.review ? 'in_review' : perm.approve ? 'pending_approval' : 'in_review';
    await Promise.all([loadProducts(), loadAms(), loadStock(), loadOrders()]);
    newOrder();
    if (!mySig && (caps.prepare || perm.review || perm.approve)) toast('Upload your PNG signature (✍ Signature) before submitting, reviewing or approving.');
  } catch (e) { toast(e.message, true); }
}
if (token) boot(); else goHome();