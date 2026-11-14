import type { Profile, UssdCtx, WeatherView } from '../src/ussd';

export interface FakeOpts {
  languages?: string[];
  brief?: { summary: string; isPlaceholder: boolean } | null;
  weather?: WeatherView | null;
  noCrops?: boolean;
  qaCount?: number;
  longText?: boolean;
}

export function makeCtx(opts: FakeOpts = {}) {
  const calls = {
    saved: [] as Profile[],
    deleted: 0,
    callbacks: [] as { topic: string; consent: boolean }[],
    events: [] as string[],
  };
  const states = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Ogun'];
  const lgas = Array.from({ length: 14 }, (_, i) => ({ locationId: 100 + i, name: `Local Government Area Number ${i + 1}` }));
  const longAnswer = 'Plant early in the season when rain is steady and spread the work over several days. '.repeat(8);
  const ctx: UssdCtx = {
    languages: opts.languages ?? ['en'],
    listStates: async () => states,
    listLgas: async (s) => (s === 'Ogun' || s === 'Abia' ? lgas : []),
    stateLocationId: async (s) => (s === 'Adamawa' ? 7 : null),
    listCrops: async () => (opts.noCrops ? [] : [
      { id: 1, name: 'Maize' },
      { id: 2, name: 'Cassava' },
      { id: 3, name: 'Tomato' },
    ]),
    getBrief: async () =>
      opts.brief === undefined
        ? { summary: opts.longText ? longAnswer : 'Short demo brief.', isPlaceholder: true }
        : opts.brief,
    getWeather: async () =>
      opts.weather === undefined
        ? {
            alertMessage: 'Heavy rain forecast for Local Government Area Number 1 on 16 Nov: 62 mm',
            unconfirmed: true,
            days: [0, 1, 2, 3].map((i) => ({ date: `2026-11-${14 + i}`, precipMm: i * 10.4, tminC: 21.2, tmaxC: 33.7 })),
            fetchedAt: '2026-11-14T10:30:00Z',
            stale: true,
          }
        : opts.weather,
    listPrices: async () => [
      { market: 'PLACEHOLDER Market With A Very Long Name', priceNgn: 123456, unit: 'basket-extra-long', ageDays: 12, isPlaceholder: true },
      { market: 'Market B', priceNgn: 900, unit: 'kg', ageDays: 0, isPlaceholder: false },
      { market: 'Market C', priceNgn: 1000, unit: 'bag', ageDays: 3, isPlaceholder: false },
      { market: 'Market D', priceNgn: 1000, unit: 'bag', ageDays: 3, isPlaceholder: false },
    ],
    listQa: async () =>
      Array.from({ length: opts.qaCount ?? 7 }, (_, i) => ({
        id: i + 1,
        question: `[PLACEHOLDER] A rather long example question number ${i + 1} about this crop?`,
        answer: opts.longText ? longAnswer : 'Short answer.',
        isPlaceholder: true,
      })),
    saveProfile: async (p) => {
      calls.saved.push(p);
    },
    deleteProfile: async () => {
      calls.deleted++;
      return true;
    },
    saveCallback: async (c) => {
      calls.callbacks.push({ topic: c.topic, consent: c.consent });
    },
    recordEvent: async (k) => {
      calls.events.push(k);
    },
  };
  return { ctx, calls };
}
