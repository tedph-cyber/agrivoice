import { $, api, ApiFail, ageText, badge, clear, fillSelect, h, lang, msg, ngn, store } from './lib';

const crop = $('#crop') as HTMLSelectElement;
const state = $('#state') as HTMLSelectElement;
const out = $('#out');
const err = $('#err');

interface P { market: string; state: string; crop: string; unit: string; priceNgn: number; ageDays: number; isPlaceholder: boolean }

async function load() {
  err.classList.add('hidden');
  const q = new URLSearchParams();
  if (crop.value) q.set('cropId', crop.value);
  if (state.value) q.set('state', state.value);
  store('av_prices_crop', crop.value); store('av_prices_state', state.value);
  try {
    const r = await api<{ prices: P[] }>(`/api/prices?${q}`);
    clear(out);
    if (!r.prices.length) return void out.append(h('p', {}, 'No approved prices yet for this choice.'));
    const rows = r.prices.map((p) => { const m = h('td', {}, p.market); if (p.isPlaceholder) m.append(badge()); return h('tr', {}, m, h('td', {}, p.crop), h('td', {}, `${ngn(p.priceNgn)} per ${p.unit}`), h('td', {}, ageText(p.ageDays))); });
    out.append(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Market', 'Crop', 'Price', 'Reported'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, ...rows))));
  } catch (e) { msg(err, 'error', e instanceof ApiFail ? e.message : 'Something went wrong.'); }
}

async function init() {
  try {
    const [places, crops] = await Promise.all([api<{ states: { state: string }[] }>('/api/places'), api<{ crops: { id: number; name: string }[] }>(`/api/crops?lang=${lang()}`)]);
    fillSelect(crop, crops.crops.map((c) => ({ value: c.id, label: c.name })), 'All crops');
    fillSelect(state, places.states.map((s) => ({ value: s.state, label: s.state })), 'All states');
    crop.value = store('av_prices_crop') ?? ''; state.value = store('av_prices_state') ?? '';
    await load();
  } catch (e) { msg(err, 'error', e instanceof ApiFail ? e.message : 'Something went wrong.'); }
}
crop.addEventListener('change', load); state.addEventListener('change', load);
$('#pick').addEventListener('submit', (e) => e.preventDefault());
void init();
