// Tiny client helpers. All user-supplied text is inserted with textContent, never innerHTML.
export const MSG = {
  offline: 'Cannot reach the service. Check your connection and try again.',
  loading: 'Loading...',
  none: 'Nothing to show yet.',
  demo: 'Demo data',
} as const;

export function lang(): string {
  try { return localStorage.getItem('av_lang') || 'en'; } catch { return 'en'; }
}

export function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return null; }
}

export class ApiFail extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.method && init.method !== 'GET') headers['x-requested-with'] = 'agrivoice-web';
    const res = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: ctl.signal, credentials: 'same-origin' });
    if (res.headers.get('x-av-cached')) showCachedBanner();
    let data: unknown = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiFail(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiFail) throw e;
    throw new ApiFail(0, 'offline', MSG.offline);
  } finally {
    clearTimeout(timer);
  }
}

function showCachedBanner(): void {
  if (document.getElementById('cached-banner')) return;
  const b = document.createElement('p');
  b.id = 'cached-banner';
  b.className = 'msg';
  b.style.cssText = 'background:#fff3e0;border:1px solid #8a4b00;color:#5a3000';
  b.setAttribute('role', 'status');
  b.textContent = 'You are offline or the connection is slow. Showing saved data from your last visit.';
  document.querySelector('main .wrap')?.prepend(b);
}

type Child = string | Node | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

export function clear(el: Element): void { el.replaceChildren(); }
export function $(sel: string, root: ParentNode = document): HTMLElement { return root.querySelector(sel) as HTMLElement; }
export function badge(text: string = MSG.demo, cls = ''): HTMLElement { return h('span', { class: `badge ${cls}`.trim() }, text); }

export function msg(el: HTMLElement, kind: 'error' | 'ok', text: string): void {
  el.className = `msg ${kind}`;
  el.textContent = text;
  el.classList.remove('hidden');
}

export function fillSelect(sel: HTMLSelectElement, items: { value: string | number; label: string }[], placeholder?: string): void {
  clear(sel);
  if (placeholder !== undefined) sel.append(h('option', { value: '' }, placeholder));
  for (const i of items) sel.append(h('option', { value: String(i.value) }, i.label));
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function fmtLagos(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function ngn(n: number): string { return 'N' + n.toLocaleString('en-GB'); }
export function ageText(days: number): string { return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`; }
