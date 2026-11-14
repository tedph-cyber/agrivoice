import { $, api, ApiFail, clear, fmtLagos, h, msg } from './lib';

type Row = Record<string, unknown>;
const panel = $('#panel');
const err = $('#err');
const note = h('p', { class: 'msg hidden', role: 'status' });
let crops: { id: number; name: string }[] = [];

const show = (e: unknown) => msg(err, 'error', e instanceof ApiFail ? e.message : 'Something went wrong.');
const ok = (t: string) => { err.classList.add('hidden'); msg(note, 'ok', t); };
const A = <T = Row>(path: string, method = 'GET', body?: unknown) => api<T>(`/api/admin${path}`, { method, body });
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function table(cols: [string, string][], rows: Row[], actions?: (r: Row) => Node[]): HTMLElement {
  const head = h('tr', {}, ...cols.map(([, l]) => h('th', { scope: 'col' }, l)), actions ? h('th', { scope: 'col' }, 'Actions') : null);
  const body = rows.map((r) => h('tr', {}, ...cols.map(([k]) => h('td', {}, r[k] === true ? 'yes' : r[k] === false ? 'no' : s(r[k]).slice(0, 120))), actions ? h('td', {}, ...actions(r)) : null));
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}
const btn = (label: string, fn: () => void | Promise<void>, cls = 'secondary') => {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', () => void Promise.resolve(fn()).catch(show));
  return b;
};

// ---------- generic CRUD ----------
interface Field { key: string; label: string; type?: 'text' | 'textarea' | 'number' | 'crop' | 'checkbox' | 'select' | 'date' | 'json'; options?: string[]; required?: boolean }
interface Res { path: string; title: string; cols: [string, string][]; fields: Field[]; approval?: boolean }

const COMMON_APPROVAL: Field[] = [
  { key: 'reviewer', label: 'Reviewer name (required to approve)' },
  { key: 'status', label: 'Status', type: 'select', options: ['draft', 'approved', 'archived'] },
  { key: 'isPlaceholder', label: 'Placeholder (shows as Demo data)', type: 'checkbox' },
];
const RESOURCES: Res[] = [
  { path: 'briefs', title: 'Briefs', approval: true, cols: [['state', 'State'], ['cropId', 'Crop'], ['language', 'Lang'], ['weekStart', 'Week'], ['title', 'Title'], ['status', 'Status'], ['reviewer', 'Reviewer'], ['isPlaceholder', 'Demo']],
    fields: [{ key: 'state', label: 'State', required: true }, { key: 'cropId', label: 'Crop', type: 'crop', required: true }, { key: 'language', label: 'Language code' }, { key: 'weekStart', label: 'Week start (Monday, YYYY-MM-DD)', type: 'date', required: true }, { key: 'title', label: 'Title', required: true }, { key: 'body', label: 'Body', type: 'textarea', required: true }, { key: 'ussdSummary', label: 'USSD summary (max 140 characters)' }, { key: 'audioUrl', label: 'Audio URL (/audio/file.mp3 or https://...)' }, ...COMMON_APPROVAL] },
  { path: 'qa', title: 'Q&A', approval: true, cols: [['cropId', 'Crop'], ['language', 'Lang'], ['question', 'Question'], ['status', 'Status'], ['reviewer', 'Reviewer'], ['isPlaceholder', 'Demo']],
    fields: [{ key: 'cropId', label: 'Crop (blank = general)', type: 'crop' }, { key: 'language', label: 'Language code' }, { key: 'question', label: 'Question', required: true }, { key: 'answer', label: 'Answer', type: 'textarea', required: true }, { key: 'keywords', label: 'Keywords (space separated)' }, ...COMMON_APPROVAL] },
  { path: 'alert-advice', title: 'Alert advice', approval: true, cols: [['ruleKey', 'Rule'], ['cropId', 'Crop'], ['language', 'Lang'], ['text', 'Text'], ['status', 'Status'], ['reviewer', 'Reviewer'], ['isPlaceholder', 'Demo']],
    fields: [{ key: 'ruleKey', label: 'Rule key (heavy_rain, dry_spell, heat)', required: true }, { key: 'cropId', label: 'Crop (blank = any)', type: 'crop' }, { key: 'language', label: 'Language code' }, { key: 'text', label: 'Advice text', type: 'textarea', required: true }, ...COMMON_APPROVAL] },
  { path: 'alert-rules', title: 'Alert rules', cols: [['key', 'Key'], ['metric', 'Metric'], ['operator', 'Op'], ['threshold', 'Threshold'], ['windowDays', 'Window'], ['severity', 'Severity'], ['enabled', 'On'], ['needsReview', 'Needs review']],
    fields: [{ key: 'key', label: 'Key', required: true }, { key: 'metric', label: 'Metric', type: 'select', options: ['precip_day_mm', 'dry_days_consecutive', 'tmax_c'] }, { key: 'operator', label: 'Operator', type: 'select', options: ['>=', '>', '<=', '<'] }, { key: 'threshold', label: 'Threshold', type: 'number', required: true }, { key: 'windowDays', label: 'Window (days, 1-7)', type: 'number', required: true }, { key: 'severity', label: 'Severity', type: 'select', options: ['watch', 'warning'] }, { key: 'enabled', label: 'Enabled', type: 'checkbox' }, { key: 'needsReview', label: 'Needs review (untick only with a reviewer name below)', type: 'checkbox' }, { key: 'reviewer', label: 'Reviewer name (agronomist who confirmed the threshold)' }] },
  { path: 'markets', title: 'Markets', cols: [['name', 'Name'], ['state', 'State'], ['lga', 'LGA'], ['isPlaceholder', 'Demo']],
    fields: [{ key: 'name', label: 'Name', required: true }, { key: 'state', label: 'State', required: true }, { key: 'lga', label: 'LGA' }, { key: 'isPlaceholder', label: 'Placeholder', type: 'checkbox' }] },
  { path: 'crops', title: 'Crops', cols: [['slug', 'Slug'], ['nameEn', 'Name']], fields: [{ key: 'slug', label: 'Slug (lowercase)', required: true }, { key: 'nameEn', label: 'English name', required: true }, { key: 'names', label: 'Other names as JSON, e.g. {"ha":"Masara"}', type: 'json' }] },
];

function cropName(id: unknown): string { return crops.find((c) => c.id === Number(id))?.name ?? s(id); }

function formFor(res: Res, row: Row | null, done: () => void): HTMLElement {
  const form = h('form', { class: 'card', novalidate: true }, h('h3', {}, row ? `Edit ${res.title} #${row.id}` : `New ${res.title}`));
  const inputs: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {};
  for (const f of res.fields) {
    const id = `f-${f.key}`;
    let el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const cur = row?.[f.key];
    if (f.type === 'textarea') el = h('textarea', { id });
    else if (f.type === 'select') { el = h('select', { id }, ...f.options!.map((o) => h('option', { value: o }, o))); }
    else if (f.type === 'crop') { el = h('select', { id }, h('option', { value: '' }, '(none)'), ...crops.map((c) => h('option', { value: String(c.id) }, c.name))); }
    else el = h('input', { id, type: f.type === 'checkbox' ? 'checkbox' : f.type === 'number' ? 'number' : 'text', step: f.type === 'number' ? 'any' : undefined });
    if (f.type === 'checkbox') (el as HTMLInputElement).checked = row ? !!cur : f.key === 'enabled';
    else if (f.type === 'json') el.value = JSON.stringify(cur ?? {});
    else if (cur !== undefined && cur !== null) el.value = String(cur);
    inputs[f.key] = el;
    form.append(f.type === 'checkbox' ? h('p', {}, h('label', {}, el, ` ${f.label}`)) : h('div', {}, h('label', { for: id }, f.label), el));
  }
  form.append(h('p', {}, h('button', { type: 'submit' }, 'Save'), ' ', btn('Cancel', done)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body: Row = {};
    for (const f of res.fields) {
      const el = inputs[f.key]!;
      if (f.type === 'checkbox') body[f.key] = (el as HTMLInputElement).checked;
      else if (f.type === 'number') body[f.key] = el.value === '' ? undefined : Number(el.value);
      else if (f.type === 'crop') body[f.key] = el.value === '' ? null : Number(el.value);
      else if (f.type === 'json') { try { body.names = JSON.parse(el.value || '{}'); } catch { return show(new ApiFail(0, 'x', 'Names must be valid JSON')); } }
      else if (f.key === 'reviewer' || f.key === 'ussdSummary' || f.key === 'audioUrl' || f.key === 'lga') body[f.key] = el.value.trim() === '' ? null : el.value.trim();
      else body[f.key] = el.value;
    }
    if (res.path === 'alert-rules' && row === null) body.needsReview = body.needsReview ?? true;
    void (row ? A(`/${res.path}/${row.id}`, 'PUT', body) : A(`/${res.path}`, 'POST', body)).then(() => { ok('Saved.'); done(); }).catch(show);
  });
  return form;
}

async function crudPanel(res: Res) {
  clear(panel);
  panel.append(h('h2', {}, res.title), note);
  const list = h('div');
  const editor = h('div');
  panel.append(btn('New', () => { clear(editor); editor.append(formFor(res, null, () => void crudPanel(res))); }, ''), editor, list);
  const r = await A<{ items: Row[] }>(`/${res.path}`);
  const rows = r.items.map((x) => ({ ...x, cropId: x.cropId === undefined ? undefined : x.cropId === null ? '(general)' : cropName(x.cropId) }));
  list.append(table(res.cols, rows, (row) => {
    const orig = r.items.find((i) => i.id === row.id)!;
    const out: Node[] = [btn('Edit', () => { clear(editor); editor.append(formFor(res, orig, () => void crudPanel(res))); })];
    out.push(btn('Delete', async () => { if (confirm('Delete this item?')) { await A(`/${res.path}/${orig.id}`, 'DELETE'); await crudPanel(res); } }, 'danger'));
    return out;
  }));
}

// ---------- special panels ----------
async function dashboard() {
  clear(panel);
  const d = await A<{ placeholders: Record<string, number>; openQuestions: number; pendingPrices: number; openDeletionRequests: number }>('/dashboard');
  const p = d.placeholders;
  panel.append(h('h2', {}, 'Dashboard'),
    h('div', { class: 'card' }, h('p', {}, h('strong', {}, `${p.total} placeholder items remain`), ` (briefs ${p.briefs}, Q&A ${p.qa}, alert advice ${p.alertAdvice}, markets ${p.markets}, prices ${p.prices}). ${p.alertRulesNeedingReview} alert rule(s) still need review.`)),
    h('ul', {}, h('li', {}, `${d.pendingPrices} price report(s) waiting for approval`), h('li', {}, `${d.openQuestions} open question(s)`), h('li', {}, `${d.openDeletionRequests} open deletion request(s)`)));
  $('#banner').textContent = p.total ? `Demo data: ${p.total} placeholder item(s) still present` : 'No placeholder data';
}

async function prices() {
  clear(panel);
  panel.append(h('h2', {}, 'Prices waiting for approval'), note);
  const r = await A<{ prices: Row[] }>('/prices?status=pending');
  if (!r.prices.length) return void panel.append(h('p', {}, 'Nothing pending.'));
  panel.append(btn('Approve all', async () => { await A('/prices/bulk-approve', 'POST', { ids: r.prices.map((x) => x.id) }); ok('Approved.'); await prices(); }, ''));
  panel.append(table([['market', 'Market'], ['crop', 'Crop'], ['unit', 'Unit'], ['priceNgn', 'Price (N)'], ['reporter', 'Agent'], ['reportedAt', 'Reported']],
    r.prices.map((x) => ({ ...x, reportedAt: fmtLagos(s(x.reportedAt)) })),
    (row) => [btn('Approve', async () => { await A(`/prices/${row.id}/approve`, 'POST'); await prices(); }, ''), btn('Reject', async () => { await A(`/prices/${row.id}/reject`, 'POST'); await prices(); }, 'danger')]));
}

async function questions() {
  clear(panel);
  panel.append(h('h2', {}, 'Open questions'), note);
  const r = await A<{ questions: Row[] }>('/questions?status=open');
  if (!r.questions.length) return void panel.append(h('p', {}, 'No open questions.'));
  for (const q of r.questions) {
    const ta = h('textarea', { 'aria-label': `Answer to question ${q.id}`, maxlength: '2000' });
    panel.append(h('div', { class: 'card' }, h('p', {}, h('strong', {}, s(q.text))), h('p', { class: 'muted' }, `${s(q.channel)} - ${s(q.state)} ${s(q.lga)} - contact: ${q.contact ? s(q.contact) : 'none'} - ${fmtLagos(s(q.createdAt))}`), ta,
      h('p', {}, btn('Send answer', async () => { await A(`/questions/${q.id}/answer`, 'POST', { answer: ta.value }); ok('Answered.'); await questions(); }, ''))));
  }
}

async function reporters() {
  clear(panel);
  panel.append(h('h2', {}, 'Price agents'), note);
  const [m, r] = await Promise.all([A<{ items: Row[] }>('/markets'), A<{ items: Row[] }>('/reporters')]);
  const name = h('input', { id: 'rname', maxlength: '80' });
  const mk = h('select', { id: 'rmarket' }, h('option', { value: '' }, '(no market)'), ...m.items.map((x) => h('option', { value: s(x.id) }, s(x.name))));
  const shown = h('p', { class: 'msg ok hidden', role: 'status' });
  panel.append(h('form', { class: 'card' }, h('h3', {}, 'Create an agent code'), h('label', { for: 'rname' }, 'Agent name'), name, h('label', { for: 'rmarket' }, 'Market'), mk, h('p', {}, h('button', { type: 'submit' }, 'Create code'))), shown);
  panel.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    void A<{ code: string; displayName: string }>('/reporters', 'POST', { displayName: name.value.trim(), marketId: mk.value ? Number(mk.value) : null })
      .then((c) => { shown.textContent = `Code for ${c.displayName}: ${c.code}. Write it down now; it is shown only once.`; shown.classList.remove('hidden'); name.value = ''; })
      .catch(show);
  });
  panel.append(table([['displayName', 'Name'], ['market', 'Market'], ['active', 'Active'], ['createdAt', 'Created']], r.items,
    (row) => [btn(row.active ? 'Deactivate' : 'Activate', async () => { await A(`/reporters/${row.id}`, 'PUT', { active: !row.active }); await reporters(); })]));
}

async function deletions() {
  clear(panel);
  panel.append(h('h2', {}, 'Deletion requests'), note);
  const r = await A<{ requests: Row[] }>('/deletion-requests');
  panel.append(table([['note', 'Note'], ['contact', 'Contact'], ['status', 'Status'], ['createdAt', 'Created']], r.requests,
    (row) => (row.status === 'open' ? [btn('Mark done', async () => { await A(`/deletion-requests/${row.id}/done`, 'POST'); await deletions(); }, '')] : [])));
}

const TABS: [string, () => Promise<void>][] = [
  ['Dashboard', dashboard], ['Prices', prices], ['Briefs', () => crudPanel(RESOURCES[0]!)], ['Q&A', () => crudPanel(RESOURCES[1]!)],
  ['Alert advice', () => crudPanel(RESOURCES[2]!)], ['Alert rules', () => crudPanel(RESOURCES[3]!)], ['Markets', () => crudPanel(RESOURCES[4]!)],
  ['Crops', () => crudPanel(RESOURCES[5]!)], ['Agents', reporters], ['Questions', questions], ['Deletions', deletions],
];
export const extraTabs: [string, () => Promise<void>][] = [];

function buildTabs() {
  const ul = $('#tabs');
  clear(ul);
  ul.style.cssText = 'list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;padding:0';
  for (const [label, fn] of [...TABS, ...extraTabs]) ul.append(h('li', {}, btn(label, async () => { err.classList.add('hidden'); await fn(); })));
}

async function enter() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  crops = (await api<{ crops: { id: number; name: string }[] }>('/api/crops')).crops;
  buildTabs();
  await dashboard();
}

async function boot() {
  try { await A('/me'); await enter(); } catch (e) {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    if (e instanceof ApiFail && e.status !== 401) show(e);
  }
}

$('#loginform').addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $('#pw') as HTMLInputElement;
  void A('/login', 'POST', { password: pw.value }).then(async () => { pw.value = ''; err.classList.add('hidden'); await enter(); }).catch((er) => {
    pw.value = '';
    msg(err, 'error', er instanceof ApiFail && er.status === 429 ? 'Too many failed attempts. Try again later.' : er instanceof ApiFail && er.status === 401 ? 'Wrong password.' : 'Something went wrong.');
  });
});
$('#logout').addEventListener('click', () => void A('/logout', 'POST').finally(() => location.reload()));
void boot();
