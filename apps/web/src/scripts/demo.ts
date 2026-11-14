import { $, api, ApiFail, msg } from './lib';

const screen = $('#sim-screen');
const input = $('#sim-input') as HTMLInputElement;
const phone = $('#sim-phone') as HTMLInputElement;
const dial = $('#sim-dial') as HTMLButtonElement;
const send = $('#sim-send') as HTMLButtonElement;
const err = $('#sim-error');
let sessionId = '';
let history: string[] = [];
let ended = false;

function newSession(): string {
  return 'w' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function call(text: string): Promise<void> {
  err.classList.add('hidden');
  try {
    const r = await api<{ text: string; end: boolean }>('/api/ussd/sim', { method: 'POST', body: { sessionId, phone: phone.value.trim(), text } });
    screen.textContent = r.text.replace(/^(CON|END) /, '');
    ended = r.end;
    input.disabled = send.disabled = ended;
    dial.disabled = !ended;
    phone.disabled = !ended && history.length > 0;
    if (ended) screen.textContent += '\n\n[Session ended]';
    else input.focus();
  } catch (e) {
    msg(err, 'error', e instanceof ApiFail ? e.message : 'Something went wrong.');
  }
}

dial.addEventListener('click', async () => {
  if (!/^\+?\d{7,15}$/.test(phone.value.trim())) return msg(err, 'error', 'Enter a fake number with digits only, e.g. +2348000000001.');
  sessionId = newSession();
  history = [];
  ended = false;
  input.value = '';
  await call('');
  input.disabled = send.disabled = ended;
  dial.disabled = true;
  phone.disabled = true;
  history = [''];
});

async function submit(): Promise<void> {
  const v = input.value.trim();
  if (!v || ended) return;
  history.push(v);
  input.value = '';
  await call(history.slice(1).join('*'));
}
send.addEventListener('click', submit);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
$('#sim-keys').addEventListener('click', (e) => {
  const k = (e.target as HTMLElement).dataset.key;
  if (k && !input.disabled) { input.value += k; input.focus(); }
});
$('#sim-restart').addEventListener('click', () => {
  sessionId = '';
  history = [];
  ended = false;
  input.value = '';
  input.disabled = send.disabled = true;
  dial.disabled = false;
  phone.disabled = false;
  screen.textContent = 'Press Dial to start.';
  err.classList.add('hidden');
});
