import { $, api, ApiFail, badge, clear, fillSelect, h, lang, msg } from './lib';

const results = $('#results');
const err = $('#err');
const THRESHOLD = 0.35;
const val = (id: string) => ($(`#${id}`) as HTMLInputElement).value.trim();

api<{ crops: { id: number; name: string }[] }>(`/api/crops?lang=${lang()}`).then((c) => fillSelect($('#crop') as HTMLSelectElement, c.crops.map((x) => ({ value: x.id, label: x.name })), 'Any crop')).catch(() => undefined);

$('#search').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.add('hidden');
  clear(results);
  $('#send').classList.add('hidden');
  const q = val('q');
  if (q.length < 2) return;
  try {
    const crop = val('crop');
    const r = await api<{ matches: { id: number; question: string; answer: string; score: number; isPlaceholder: boolean }[] }>(`/api/qa/search?q=${encodeURIComponent(q)}&lang=${lang()}${crop ? `&cropId=${crop}` : ''}`);
    const good = r.matches.filter((m) => m.score >= THRESHOLD);
    for (const m of good) {
      const t = h('h3', {}, m.question);
      if (m.isPlaceholder) t.append(badge());
      results.append(h('article', { class: 'card' }, t, h('p', {}, m.answer)));
    }
    if (!good.length) {
      results.append(h('p', {}, 'No matching answer found.'));
      ($('#qtext') as HTMLTextAreaElement).value = q;
      $('#send').classList.remove('hidden');
    }
  } catch (er) { msg(err, 'error', er instanceof ApiFail ? er.message : 'Something went wrong.'); }
});

$('#qform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sent = $('#sent');
  const consent = ($('#consent') as HTMLInputElement).checked;
  const contact = val('contact');
  if (contact && !consent) return msg(sent, 'error', 'Tick the box if you want us to keep your number. Otherwise remove the number.');
  try {
    await api('/api/questions', { method: 'POST', body: { text: val('qtext'), language: lang(), contact: contact || undefined, consentContact: consent } });
    msg(sent, 'ok', 'Thank you. Your question was sent to an agent.');
    ($('#qform') as HTMLFormElement).reset();
  } catch (er) { msg(sent, 'error', er instanceof ApiFail ? er.message : 'Something went wrong.'); }
});
