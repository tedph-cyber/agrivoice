import { $, api, ApiFail, ageText, badge, clear, fillSelect, fmtDate, fmtLagos, h, lang, msg, ngn, store } from './lib';

const state = $('#state') as HTMLSelectElement;
const lga = $('#lga') as HTMLSelectElement;
const crop = $('#crop') as HTMLSelectElement;
const out = $('#out');
const err = $('#err');

interface Day { date: string; precipMm: number | null; tmaxC: number | null; tminC: number | null; popPct: number | null }
interface Forecast { fetchedAt: string; stale: boolean; isPlaceholder: boolean; days: Day[] }
interface Alert { ruleKey: string; severity: string; date: string; message: string; advice: string | null; needsReview: boolean; unconfirmedLabel: string | null; isPlaceholder: boolean }
interface Brief { title: string; body: string; weekStart: string; audioUrl: string | null; reviewer: string; isPlaceholder: boolean }

async function init() {
  try {
    const [places, crops] = await Promise.all([
      api<{ states: { state: string; locationId: number }[] }>('/api/places'),
      api<{ crops: { id: number; name: string }[] }>(`/api/crops?lang=${lang()}`),
    ]);
    fillSelect(state, places.states.map((s) => ({ value: s.state, label: s.state })), 'Select state');
    fillSelect(crop, crops.crops.map((c) => ({ value: c.id, label: c.name })), 'Select crop');
    const saved = { s: store('av_state'), l: store('av_lga'), c: store('av_crop') };
    if (saved.s && places.states.some((s) => s.state === saved.s)) { state.value = saved.s; await loadLgas(saved.l); }
    if (saved.c) crop.value = saved.c;
    if (state.value && crop.value) await show();
  } catch (e) { msg(err, 'error', e instanceof ApiFail ? e.message : 'Something went wrong.'); }
}

async function loadLgas(select?: string | null) {
  fillSelect(lga, [], 'State-wide');
  if (!state.value) return;
  const r = await api<{ lgas: { lga: string; locationId: number }[] }>(`/api/places?state=${encodeURIComponent(state.value)}`);
  fillSelect(lga, r.lgas.map((l) => ({ value: l.locationId, label: l.lga })), 'State-wide');
  if (select) lga.value = select;
}

async function stateLocation(): Promise<number> {
  const r = await api<{ states: { state: string; locationId: number }[] }>('/api/places');
  return r.states.find((s) => s.state === state.value)!.locationId;
}

function section(title: string, ...kids: (Node | string)[]) { return h('section', {}, h('h2', {}, title), ...kids); }

async function show() {
  err.classList.add('hidden');
  if (!state.value || !crop.value) return;
  store('av_state', state.value); store('av_lga', lga.value); store('av_crop', crop.value);
  clear(out);
  out.append(h('p', { class: 'muted' }, 'Loading...'));
  const locId = lga.value ? Number(lga.value) : await stateLocation();
  const L = lang();
  const [fc, al, br, pr] = await Promise.allSettled([
    api<Forecast>(`/api/forecast?locationId=${locId}`),
    api<{ alerts: Alert[] }>(`/api/alerts?locationId=${locId}&cropId=${crop.value}&lang=${L}`),
    api<Brief>(`/api/brief?state=${encodeURIComponent(state.value)}&cropId=${crop.value}&lang=${L}`),
    api<{ prices: { market: string; unit: string; priceNgn: number; ageDays: number; isPlaceholder: boolean }[] }>(`/api/prices?cropId=${crop.value}&state=${encodeURIComponent(state.value)}`),
  ]);
  clear(out);

  // alerts
  if (al.status === 'fulfilled') {
    const box = section('Weather alerts');
    if (al.value.alerts.length === 0) box.append(h('p', {}, 'No alerts for the next days.'));
    for (const a of al.value.alerts) {
      const card = h('div', { class: `alert ${a.severity}` }, h('strong', {}, a.severity === 'warning' ? 'Warning: ' : 'Watch: '), a.message);
      if (a.needsReview) card.append(badge(a.unconfirmedLabel ?? 'Unconfirmed threshold', 'warn'));
      if (a.advice) { card.append(h('p', {}, a.advice)); if (a.isPlaceholder) card.append(badge()); }
      box.append(card);
    }
    out.append(box);
  }

  // forecast
  if (fc.status === 'fulfilled') {
    const f = fc.value;
    const tbl = h('table', {}, h('caption', { class: 'sr' }, '7 day forecast'),
      h('thead', {}, h('tr', {}, ...['Day', 'Rain (mm)', 'Min C', 'Max C', 'Chance of rain'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, ...f.days.map((d) => h('tr', {}, h('td', {}, fmtDate(d.date)), h('td', {}, d.precipMm === null ? '-' : String(Math.round(d.precipMm * 10) / 10)), h('td', {}, d.tminC === null ? '-' : String(Math.round(d.tminC))), h('td', {}, d.tmaxC === null ? '-' : String(Math.round(d.tmaxC))), h('td', {}, d.popPct === null ? '-' : `${d.popPct}%`)))));
    const s = section('Weather', h('div', { class: 'tablewrap' }, tbl), h('p', { class: 'muted' }, `Updated ${fmtLagos(f.fetchedAt)}${f.stale ? ' (old data: the weather service could not be reached)' : ''}. Weather data by Open-Meteo.com.`));
    if (f.isPlaceholder) s.append(badge());
    out.append(s);
  } else out.append(section('Weather', h('p', { class: 'msg error' }, fc.reason instanceof ApiFail ? fc.reason.message : 'Weather is not available.')));

  // brief
  const b = section('This week\'s brief');
  if (br.status === 'fulfilled') {
    const v = br.value;
    const head = h('h3', {}, v.title);
    if (v.isPlaceholder) head.append(badge());
    b.append(head, h('p', { class: 'muted' }, `Week of ${fmtDate(v.weekStart)}. Reviewed by ${v.reviewer}.`));
    for (const para of v.body.split(/\n{2,}/)) b.append(h('p', {}, para));
    if (v.audioUrl) {
      const audio = h('audio', { controls: true, preload: 'none', src: v.audioUrl });
      b.append(h('p', {}, h('strong', {}, 'Voice note')), audio);
    }
  } else if (br.reason instanceof ApiFail && br.reason.status === 404) b.append(h('p', {}, 'No approved brief for this state and crop yet. Check again next week.'));
  else b.append(h('p', { class: 'msg error' }, br.reason instanceof ApiFail ? br.reason.message : 'Brief is not available.'));
  out.append(b);

  // prices
  const p = section('Recent prices');
  if (pr.status === 'fulfilled' && pr.value.prices.length) {
    const tbl = h('table', {}, h('thead', {}, h('tr', {}, ...['Market', 'Price', 'Reported'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, ...pr.value.prices.slice(0, 6).map((x) => { const td = h('td', {}, x.market); if (x.isPlaceholder) td.append(badge()); return h('tr', {}, td, h('td', {}, `${ngn(x.priceNgn)} per ${x.unit}`), h('td', {}, ageText(x.ageDays))); })));
    p.append(h('div', { class: 'tablewrap' }, tbl), h('p', {}, h('a', { href: '/prices/' }, 'All prices')));
  } else p.append(h('p', {}, 'No approved prices yet.'));
  out.append(p);
}

state.addEventListener('change', async () => { await loadLgas(); lga.value = ''; if (crop.value) void show().catch(() => msg(err, 'error', 'Something went wrong.')); });
lga.addEventListener('change', () => void show().catch(() => msg(err, 'error', 'Something went wrong.')));
crop.addEventListener('change', () => void show().catch(() => msg(err, 'error', 'Something went wrong.')));
$('#pick').addEventListener('submit', (e) => e.preventDefault());
void init();
