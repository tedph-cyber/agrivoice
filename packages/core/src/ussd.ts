import { t } from './i18n';
import { isGsm7, toGsm7 } from './gsm';
import { lagosTime, paginate, shortDay, truncate } from './text';

export const USSD_MAX = 182;
export const SESSION_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 6;

export interface Profile {
  lang: string;
  stateName: string;
  lgaName: string | null;
  locationId: number;
  cropId: number;
  cropName: string;
}

export interface WeatherView {
  alertMessage: string | null;
  unconfirmed: boolean;
  days: { date: string; precipMm: number | null; tminC: number | null; tmaxC: number | null }[];
  fetchedAt: string;
  stale: boolean;
}

export interface PriceView {
  market: string;
  priceNgn: number;
  unit: string;
  ageDays: number;
  isPlaceholder: boolean;
}

export interface QaView {
  id: number;
  question: string;
  answer: string;
  isPlaceholder: boolean;
}

/** Data access used by the engine. The API layer implements it over D1; tests use fakes. */
export interface UssdCtx {
  languages: string[];
  listStates(): Promise<string[]>;
  listLgas(state: string): Promise<{ locationId: number; name: string }[]>;
  stateLocationId(state: string): Promise<number | null>;
  listCrops(lang: string): Promise<{ id: number; name: string }[]>;
  getBrief(
    state: string,
    cropId: number,
    lang: string,
  ): Promise<{ summary: string; isPlaceholder: boolean } | null>;
  getWeather(locationId: number, cropId: number, lang: string): Promise<WeatherView | null>;
  listPrices(cropId: number, state: string): Promise<PriceView[]>;
  listQa(cropId: number, lang: string): Promise<QaView[]>;
  saveProfile(p: Profile): Promise<void>;
  deleteProfile(): Promise<boolean>;
  saveCallback(input: { topic: string; consent: boolean; lang: string; locationId: number | null }): Promise<void>;
  recordEvent(kind: 'session' | 'brief' | 'weather' | 'prices' | 'ask' | 'register', state: string | null): Promise<void>;
}

export type ScreenId =
  | 'lang'
  | 'state'
  | 'lga'
  | 'crop'
  | 'consent'
  | 'menu'
  | 'brief'
  | 'weather'
  | 'prices_crop'
  | 'prices'
  | 'ask_list'
  | 'ask_answer'
  | 'cb_topic'
  | 'cb_consent'
  | 'settings'
  | 'set_lang'
  | 'delete_confirm'
  | 'end';

export interface SessionState {
  v: 1;
  cur: ScreenId;
  stack: ScreenId[];
  lang: string;
  page: number;
  hasProfile: boolean;
  /** true while the flow is (re)collecting place and crop */
  onboarding: boolean;
  stateName?: string;
  lgaName?: string | null;
  locationId?: number;
  cropId?: number;
  cropName?: string;
  pricesCropId?: number;
  qaId?: number;
  cbTopic?: string;
  startedAt?: number;
}

export interface StepResult {
  state: SessionState;
  text: string; // includes CON/END prefix
  end: boolean;
}

interface Rendered {
  body: string;
  end: boolean;
}

export function newState(lang = 'en', profile?: Profile | null): SessionState {
  const base: SessionState = { v: 1, cur: 'menu', stack: [], lang, page: 0, hasProfile: false, onboarding: false };
  if (profile) {
    return {
      ...base,
      lang: profile.lang,
      hasProfile: true,
      stateName: profile.stateName,
      lgaName: profile.lgaName,
      locationId: profile.locationId,
      cropId: profile.cropId,
      cropName: profile.cropName,
    };
  }
  return { ...base, cur: 'lang', onboarding: true };
}

function finalize(body: string, end: boolean): string {
  const prefix = end ? 'END ' : 'CON ';
  let text = toGsm7(body);
  if (prefix.length + text.length > USSD_MAX) text = truncate(text, USSD_MAX - prefix.length);
  return prefix + text;
}

function nav(lang: string, opts: { back?: boolean } = {}): string {
  return opts.back === false ? '' : t(lang, 'ussd.back');
}

function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}

function pageOf<T>(items: T[], page: number): { slice: T[]; more: boolean; total: number } {
  const start = page * PAGE_SIZE;
  return { slice: items.slice(start, start + PAGE_SIZE), more: start + PAGE_SIZE < items.length, total: items.length };
}

function listScreen(lang: string, title: string, labels: string[], more: boolean, back: boolean, flash?: string): string {
  return lines(
    flash,
    title,
    ...labels.map((l, i) => `${i + 1} ${l}`),
    more && t(lang, 'ussd.more'),
    back && nav(lang),
  );
}

/** Pages of long text with Next/Back footers that always fit in one screen. */
function textScreen(lang: string, text: string, page: number, head = ''): { body: string; pages: number; page: number } {
  const footerFull = '\n' + t(lang, 'ussd.next') + '\n' + t(lang, 'ussd.back');
  const budget = USSD_MAX - 4 - footerFull.length - (head ? head.length + 1 : 0);
  const pages = paginate(text, Math.max(20, budget));
  const p = Math.min(Math.max(page, 0), pages.length - 1);
  const isLast = p === pages.length - 1;
  const body = lines(head, pages[p], !isLast && t(lang, 'ussd.next'), t(lang, 'ussd.back'));
  return { body, pages: pages.length, page: p };
}

const TOPICS = ['1', '2', '3', '4', '5'];

async function render(st: SessionState, ctx: UssdCtx, flash?: string): Promise<Rendered> {
  const L = st.lang;
  const f = flash ? t(L, 'ussd.invalid') : undefined;
  switch (st.cur) {
    case 'lang': {
      const langs = ctx.languages;
      return { body: listScreen(L, t(L, 'ussd.select_lang'), langs.map((l) => t(l, `lang.${l}`)), false, false, f), end: false };
    }
    case 'state': {
      const states = await ctx.listStates();
      const { slice, more } = pageOf(states, st.page);
      return {
        body: listScreen(L, t(L, 'ussd.select_state'), slice.map((s) => truncate(s, 14)), more, st.stack.length > 0, f),
        end: false,
      };
    }
    case 'lga': {
      const lgas = await ctx.listLgas(st.stateName ?? '');
      const { slice, more } = pageOf(lgas, st.page);
      return {
        body: listScreen(L, t(L, 'ussd.select_lga'), slice.map((s) => truncate(s.name, 18)), more, true, f),
        end: false,
      };
    }
    case 'crop': {
      const crops = await ctx.listCrops(L);
      if (crops.length === 0) return { body: t(L, 'ussd.no_crops'), end: true };
      const { slice, more } = pageOf(crops, st.page);
      return { body: listScreen(L, t(L, 'ussd.select_crop'), slice.map((c) => truncate(c.name, 18)), more, true, f), end: false };
    }
    case 'consent':
      return { body: lines(f, t(L, 'ussd.consent'), nav(L)), end: false };
    case 'menu':
      return {
        body: lines(
          f ?? (st.hasProfile ? '' : ''),
          t(L, 'ussd.menu_title'),
          `1 ${t(L, 'ussd.menu.brief')}`,
          `2 ${t(L, 'ussd.menu.weather')}`,
          `3 ${t(L, 'ussd.menu.prices')}`,
          `4 ${t(L, 'ussd.menu.ask')}`,
          `5 ${t(L, 'ussd.menu.settings')}`,
        ),
        end: false,
      };
    case 'brief': {
      const brief = await ctx.getBrief(st.stateName ?? '', st.cropId ?? 0, L);
      if (!brief) return { body: lines(t(L, 'ussd.no_brief'), nav(L)), end: false };
      const prefix = brief.isPlaceholder ? t(L, 'ussd.demo_prefix') + ' ' : '';
      const r = textScreen(L, prefix + brief.summary, st.page);
      return { body: r.body, end: false };
    }
    case 'weather': {
      const w = await ctx.getWeather(st.locationId ?? 0, st.cropId ?? 0, L);
      if (!w) return { body: lines(t(L, 'ussd.weather_error'), nav(L)), end: false };
      const dayLines = w.days.slice(1, 4).map((d) =>
        t(L, 'ussd.weather_day', {
          day: shortDay(d.date),
          mm: d.precipMm === null ? '-' : Math.round(d.precipMm),
          min: d.tminC === null ? '-' : Math.round(d.tminC),
          max: d.tmaxC === null ? '-' : Math.round(d.tmaxC),
        }),
      );
      const upd = lines(
        t(L, 'ussd.weather_updated', { time: lagosTime(w.fetchedAt) }) + (w.stale ? ' ' + t(L, 'ussd.weather_stale') : ''),
      );
      const tail = lines(...dayLines, upd, nav(L));
      const room = USSD_MAX - 4 - tail.length - 1;
      const alert = w.alertMessage
        ? truncate(w.alertMessage + (w.unconfirmed ? ' ' + t(L, 'ussd.unconfirmed') : ''), Math.max(20, room))
        : '';
      return { body: lines(alert, tail), end: false };
    }
    case 'prices_crop': {
      const crops = await ctx.listCrops(L);
      const { slice, more } = pageOf(crops, st.page);
      return { body: listScreen(L, t(L, 'ussd.prices_pick'), slice.map((c) => truncate(c.name, 18)), more, true, f), end: false };
    }
    case 'prices': {
      const prices = (await ctx.listPrices(st.pricesCropId ?? 0, st.stateName ?? '')).slice(0, 3);
      if (prices.length === 0) return { body: lines(t(L, 'ussd.prices_none'), nav(L)), end: false };
      const demo = prices.some((p) => p.isPlaceholder) ? t(L, 'ussd.demo_prefix') : '';
      const rows = prices.map((p) =>
        t(L, 'ussd.prices_line', {
          market: truncate(p.market, 14),
          price: p.priceNgn,
          unit: truncate(p.unit, 8),
          age: p.ageDays <= 0 ? t(L, 'ussd.age_today') : t(L, 'ussd.age_days', { n: p.ageDays }),
        }),
      );
      return { body: lines(demo, ...rows, nav(L)), end: false };
    }
    case 'ask_list': {
      const qa = (await ctx.listQa(st.cropId ?? 0, L)).slice(0, 5);
      if (qa.length === 0) return { body: lines(f, t(L, 'ussd.ask_empty'), nav(L)), end: false };
      return {
        body: lines(
          f,
          t(L, 'ussd.ask_title'),
          ...qa.map((q, i) => `${i + 1} ${truncate(q.question, 20)}`),
          t(L, 'ussd.ask_none_of_these'),
          nav(L),
        ),
        end: false,
      };
    }
    case 'ask_answer': {
      const qa = (await ctx.listQa(st.cropId ?? 0, L)).slice(0, 5);
      const item = qa.find((q) => q.id === st.qaId);
      if (!item) return { body: lines(t(L, 'ussd.ask_empty'), nav(L)), end: false };
      const head = item.isPlaceholder ? t(L, 'ussd.demo_prefix') : '';
      return { body: textScreen(L, item.answer, st.page, head).body, end: false };
    }
    case 'cb_topic':
      return {
        body: lines(f, t(L, 'ussd.cb_topic'), ...TOPICS.map((n) => `${n} ${t(L, `ussd.cb_topic.${n}`)}`), nav(L)),
        end: false,
      };
    case 'cb_consent':
      return { body: lines(f, t(L, 'ussd.cb_consent'), nav(L)), end: false };
    case 'settings':
      return {
        body: lines(
          f,
          t(L, 'ussd.settings_title'),
          `1 ${t(L, 'ussd.settings.lang')}`,
          `2 ${t(L, 'ussd.settings.place')}`,
          `3 ${t(L, 'ussd.settings.delete')}`,
          nav(L),
        ),
        end: false,
      };
    case 'set_lang':
      return {
        body: lines(f, t(L, 'ussd.select_lang'), ...ctx.languages.map((l, i) => `${i + 1} ${t(l, `lang.${l}`)}`), nav(L)),
        end: false,
      };
    case 'delete_confirm':
      return { body: lines(f, t(L, 'ussd.delete_confirm'), nav(L)), end: false };
    case 'end':
    default:
      return { body: t(L, 'ussd.goodbye'), end: true };
  }
}

function go(st: SessionState, to: ScreenId): SessionState {
  return { ...st, stack: [...st.stack, st.cur], cur: to, page: 0 };
}

function goBack(st: SessionState): SessionState {
  const stack = [...st.stack];
  const prev = stack.pop();
  if (!prev) return st;
  return { ...st, stack, cur: prev, page: 0 };
}

function home(st: SessionState): SessionState {
  return { ...st, stack: [], cur: 'menu', page: 0, onboarding: false };
}

interface Outcome {
  state: SessionState;
  invalid?: boolean;
  endText?: string;
}

async function handle(st: SessionState, input: string, ctx: UssdCtx): Promise<Outcome> {
  const L = st.lang;
  const n = /^\d+$/.test(input) ? parseInt(input, 10) : NaN;
  const firstScreen = st.stack.length === 0 && st.cur !== 'menu';

  if (input === '00' && st.cur !== 'menu' && !(st.onboarding && !st.hasProfile)) return { state: home(st) };
  if (input === '0') {
    if (st.cur === 'menu' || firstScreen) return { state: st, invalid: true };
    return { state: goBack(st) };
  }

  const pagedPick = async <T,>(items: T[]): Promise<{ pick?: T; more?: boolean }> => {
    const { slice, more } = pageOf(items, st.page);
    if (n === 7 && more) return { more: true };
    if (n >= 1 && n <= slice.length) return { pick: slice[n - 1] };
    return {};
  };

  switch (st.cur) {
    case 'lang': {
      const pick = ctx.languages[n - 1];
      if (!pick) return { state: st, invalid: true };
      return { state: go({ ...st, lang: pick }, 'state') };
    }
    case 'state': {
      const r = await pagedPick(await ctx.listStates());
      if (r.more) return { state: { ...st, page: st.page + 1 } };
      if (!r.pick) return { state: st, invalid: true };
      const next = go({ ...st, stateName: r.pick as string, lgaName: null }, 'lga');
      const lgas = await ctx.listLgas(r.pick as string);
      if (lgas.length === 0) {
        const locId = await ctx.stateLocationId(r.pick as string);
        return { state: go({ ...st, stateName: r.pick as string, lgaName: null, locationId: locId ?? undefined }, 'crop') };
      }
      return { state: next };
    }
    case 'lga': {
      const r = await pagedPick(await ctx.listLgas(st.stateName ?? ''));
      if (r.more) return { state: { ...st, page: st.page + 1 } };
      if (!r.pick) return { state: st, invalid: true };
      const p = r.pick as { locationId: number; name: string };
      return { state: go({ ...st, lgaName: p.name, locationId: p.locationId }, 'crop') };
    }
    case 'crop': {
      const r = await pagedPick(await ctx.listCrops(L));
      if (r.more) return { state: { ...st, page: st.page + 1 } };
      if (!r.pick) return { state: st, invalid: true };
      const c = r.pick as { id: number; name: string };
      const next = { ...st, cropId: c.id, cropName: c.name };
      if (st.hasProfile) {
        await saveProfile(next, ctx);
        return { state: { ...home(next), stack: [] } };
      }
      return { state: go(next, 'consent') };
    }
    case 'consent': {
      if (n === 1) {
        const saved = { ...st, hasProfile: true };
        await saveProfile(saved, ctx);
        await ctx.recordEvent('register', st.stateName ?? null);
        return { state: home(saved) };
      }
      if (n === 2) return { state: home({ ...st, hasProfile: false }) };
      return { state: st, invalid: true };
    }
    case 'menu': {
      const map: Record<number, ScreenId> = { 1: 'brief', 2: 'weather', 3: 'prices_crop', 4: 'ask_list', 5: 'settings' };
      const to = map[n];
      if (!to) return { state: st, invalid: true };
      const next = go(st, to);
      const where = st.stateName ?? null;
      if (to === 'brief') await ctx.recordEvent('brief', where);
      if (to === 'weather') await ctx.recordEvent('weather', where);
      if (to === 'ask_list') await ctx.recordEvent('ask', where);
      return { state: next };
    }
    case 'brief':
    case 'ask_answer': {
      if (n === 1) {
        const text = await pagesText(st, ctx);
        if (text && st.page + 1 < text) return { state: { ...st, page: st.page + 1 } };
      }
      return { state: st, invalid: true };
    }
    case 'weather':
    case 'prices':
      return { state: st, invalid: true };
    case 'prices_crop': {
      const r = await pagedPick(await ctx.listCrops(L));
      if (r.more) return { state: { ...st, page: st.page + 1 } };
      if (!r.pick) return { state: st, invalid: true };
      await ctx.recordEvent('prices', st.stateName ?? null);
      return { state: go({ ...st, pricesCropId: (r.pick as { id: number }).id }, 'prices') };
    }
    case 'ask_list': {
      const qa = (await ctx.listQa(st.cropId ?? 0, L)).slice(0, 5);
      if (n === 6) return { state: go(st, 'cb_topic') };
      if (n >= 1 && n <= qa.length && qa.length > 0) return { state: go({ ...st, qaId: qa[n - 1]!.id }, 'ask_answer') };
      return { state: st, invalid: true };
    }
    case 'cb_topic': {
      if (n >= 1 && n <= 5) return { state: go({ ...st, cbTopic: String(n) }, 'cb_consent') };
      return { state: st, invalid: true };
    }
    case 'cb_consent': {
      if (n !== 1 && n !== 2) return { state: st, invalid: true };
      const topic = `Call-back topic: ${t('en', `ussd.cb_topic.${st.cbTopic ?? '5'}`)}`;
      await ctx.saveCallback({ topic, consent: n === 1, lang: L, locationId: st.locationId ?? null });
      return { state: { ...st, cur: 'end' }, endText: t(L, n === 1 ? 'ussd.cb_done_yes' : 'ussd.cb_done_no') };
    }
    case 'settings': {
      if (n === 1) return { state: go(st, 'set_lang') };
      if (n === 2) return { state: go({ ...st, onboarding: true }, 'state') };
      if (n === 3) return { state: go(st, 'delete_confirm') };
      return { state: st, invalid: true };
    }
    case 'set_lang': {
      const pick = ctx.languages[n - 1];
      if (!pick) return { state: st, invalid: true };
      const next = { ...st, lang: pick };
      if (st.hasProfile) await saveProfile(next, ctx);
      return { state: home(next) };
    }
    case 'delete_confirm': {
      if (n === 1) {
        const had = await ctx.deleteProfile();
        return {
          state: { ...st, cur: 'end', hasProfile: false },
          endText: t(L, had ? 'ussd.deleted' : 'ussd.delete_none'),
        };
      }
      if (n === 2) return { state: goBack(st) };
      return { state: st, invalid: true };
    }
    default:
      return { state: st, invalid: true };
  }
}

async function saveProfile(st: SessionState, ctx: UssdCtx): Promise<void> {
  if (st.locationId === undefined || st.cropId === undefined || !st.stateName) return;
  await ctx.saveProfile({
    lang: st.lang,
    stateName: st.stateName,
    lgaName: st.lgaName ?? null,
    locationId: st.locationId,
    cropId: st.cropId,
    cropName: st.cropName ?? '',
  });
}

/** Number of text pages for brief/answer screens. */
async function pagesText(st: SessionState, ctx: UssdCtx): Promise<number> {
  const L = st.lang;
  if (st.cur === 'brief') {
    const b = await ctx.getBrief(st.stateName ?? '', st.cropId ?? 0, L);
    if (!b) return 0;
    const prefix = b.isPlaceholder ? t(L, 'ussd.demo_prefix') + ' ' : '';
    return textScreen(L, prefix + b.summary, 99).pages;
  }
  const item = (await ctx.listQa(st.cropId ?? 0, L)).slice(0, 5).find((q) => q.id === st.qaId);
  if (!item) return 0;
  const head = item.isPlaceholder ? t(L, 'ussd.demo_prefix') : '';
  return textScreen(L, item.answer, 99, head).pages;
}

/**
 * One USSD step. `input` is the newest user entry ('' for the first dial).
 * `state` is null for a new session.
 */
export async function step(state: SessionState | null, input: string, ctx: UssdCtx, profile?: Profile | null): Promise<StepResult> {
  try {
    let st = state;
    const trimmed = input.trim();
    if (!st) {
      st = newState(ctx.languages[0] ?? 'en', profile);
      // single enabled language: skip the language screen
      if (!profile && ctx.languages.length <= 1) st = { ...st, cur: 'state', lang: ctx.languages[0] ?? 'en' };
      await ctx.recordEvent('session', st.stateName ?? null);
      const r = await render(st, ctx);
      return { state: st, text: finalize(r.body, r.end), end: r.end };
    }
    const out = await handle(st, trimmed, ctx);
    if (out.endText !== undefined) {
      return { state: out.state, text: finalize(out.endText, true), end: true };
    }
    let r = await render(out.state, ctx, out.invalid ? 'invalid' : undefined);
    if (out.invalid) {
      const withFlash = finalize(r.body, r.end);
      if (isGsm7(withFlash) && withFlash.length <= USSD_MAX && !withFlash.includes('...')) {
        return { state: out.state, text: withFlash, end: r.end };
      }
      r = await render(out.state, ctx);
    }
    return { state: out.state, text: finalize(r.body, r.end), end: r.end };
  } catch {
    const L = state?.lang ?? 'en';
    return { state: state ?? newState(L), text: finalize(t(L, 'ussd.error'), true), end: true };
  }
}

/** Latest segment of Africa's Talking cumulative text ("1*2*3" -> "3"). */
export function lastInput(text: string): string {
  if (!text) return '';
  const parts = text.split('*');
  return parts[parts.length - 1] ?? '';
}
