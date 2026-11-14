import { $, api, ApiFail, fillSelect, lang, msg } from './lib';

const f = $('#f') as HTMLFormElement;
const out = $('#out');
const val = (id: string) => ($(`#${id}`) as HTMLInputElement).value.trim();

async function init() {
  try {
    const [m, c] = await Promise.all([api<{ markets: { id: number; name: string; state: string; isPlaceholder: boolean }[] }>('/api/markets'), api<{ crops: { id: number; name: string }[] }>(`/api/crops?lang=${lang()}`)]);
    fillSelect($('#market') as HTMLSelectElement, m.markets.map((x) => ({ value: x.id, label: `${x.name} (${x.state})${x.isPlaceholder ? ' - Demo data' : ''}` })), 'Select market');
    fillSelect($('#crop') as HTMLSelectElement, c.crops.map((x) => ({ value: x.id, label: x.name })), 'Select crop');
  } catch (e) { msg(out, 'error', e instanceof ApiFail ? e.message : 'Something went wrong.'); }
}

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const price = Number(val('price').replace(/[,\s]/g, ''));
  if (!val('code') || !val('market') || !val('crop') || !val('unit') || !Number.isInteger(price) || price <= 0) return msg(out, 'error', 'Please fill every field. Price must be a whole number of naira.');
  const btn = f.querySelector('button') as HTMLButtonElement;
  btn.disabled = true;
  try {
    await api('/api/prices/report', { method: 'POST', body: { reporterCode: val('code'), marketId: Number(val('market')), cropId: Number(val('crop')), unit: val('unit'), priceNgn: price } });
    msg(out, 'ok', 'Thank you. Your price was sent for approval.');
    ($('#price') as HTMLInputElement).value = '';
  } catch (er) {
    msg(out, 'error', er instanceof ApiFail ? (er.code === 'invalid_code' ? 'Agent code not recognised. Check it and try again.' : er.code === 'rate_limited' ? 'Too many reports. Please wait a while.' : er.message) : 'Something went wrong.');
  } finally { btn.disabled = false; }
});
void init();
