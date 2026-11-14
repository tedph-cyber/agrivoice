import { $, api, ApiFail, msg } from './lib';

$('#del').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#out');
  try {
    await api('/api/privacy/delete-request', { method: 'POST', body: { note: ($('#note') as HTMLTextAreaElement).value.trim() || undefined, contact: ($('#contact') as HTMLInputElement).value.trim() || undefined } });
    msg(out, 'ok', 'Request received. An admin will handle it.');
    ($('#del') as HTMLFormElement).reset();
  } catch (er) { msg(out, 'error', er instanceof ApiFail ? er.message : 'Something went wrong.'); }
});
