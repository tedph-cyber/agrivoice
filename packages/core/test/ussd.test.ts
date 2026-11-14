import { describe, expect, it } from 'vitest';
import { isGsm7, lastInput, step, USSD_MAX, type Profile, type SessionState, type UssdCtx } from '../src';
import { makeCtx } from './fakes';

async function run(ctx: UssdCtx, inputs: string[], profile?: Profile | null) {
  let st: SessionState | null = null;
  const screens: string[] = [];
  for (const i of ['', ...inputs]) {
    const r = await step(st, i, ctx, profile);
    st = r.state;
    screens.push(r.text);
    expectValid(r.text);
  }
  return { st: st!, screens, last: screens[screens.length - 1]! };
}

function expectValid(text: string) {
  expect(text.startsWith('CON ') || text.startsWith('END ')).toBe(true);
  expect(text.length).toBeLessThanOrEqual(USSD_MAX);
  expect(isGsm7(text)).toBe(true);
}

const profile: Profile = { lang: 'en', stateName: 'Ogun', lgaName: 'X', locationId: 100, cropId: 1, cropName: 'Maize' };

describe('lastInput', () => {
  it('takes the last segment', () => {
    expect(lastInput('')).toBe('');
    expect(lastInput('1')).toBe('1');
    expect(lastInput('1*2*3')).toBe('3');
  });
});

describe('first contact', () => {
  it('full path with consent yes', async () => {
    const { ctx, calls } = makeCtx();
    const r = await run(ctx, ['7', '4', '1', '1', '1']);
    expect(r.last).toContain('AgriVoice');
    expect(calls.saved).toHaveLength(1);
    expect(calls.saved[0]!.stateName).toBe('Ogun');
    expect(calls.saved[0]!.cropId).toBe(1);
    expect(calls.events).toContain('register');
  });

  it('consent no keeps choices for the session but saves nothing', async () => {
    const { ctx, calls } = makeCtx();
    const r = await run(ctx, ['7', '4', '1', '1', '2']);
    expect(calls.saved).toHaveLength(0);
    expect(r.st.hasProfile).toBe(false);
    expect(r.st.cropId).toBe(1);
    expect(r.last).toContain('AgriVoice');
  });

  it('skips LGA screen when state has none', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['2']); // Adamawa has no LGAs in fake
    expect(r.last).toContain('Select crop');
    expect(r.st.locationId).toBe(7);
  });

  it('shows the language screen when several languages are enabled', async () => {
    const { ctx } = makeCtx({ languages: ['en', 'pcm'] });
    const r = await run(ctx, []);
    expect(r.last).toContain('Choose language');
    expect(r.last).toContain('2 Pidgin');
  });

  it('shows the consent text exactly', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['7', '4', '1', '1']);
    expect(r.last).toContain('Save your place and crop? We keep a scrambled code, not your number. 1 Yes 2 No');
  });

  it('ends politely when no crops exist', async () => {
    const { ctx } = makeCtx({ noCrops: true });
    const r = await run(ctx, ['7', '4', '1']);
    expect(r.last.startsWith('END ')).toBe(true);
  });
});

describe('navigation', () => {
  it('0 goes back, 00 goes home, first screen ignores them', async () => {
    const { ctx } = makeCtx();
    const first = await run(ctx, ['0']);
    expect(first.last).toContain('Invalid choice');
    const back = await run(ctx, ['1', '0']);
    expect(back.last).toContain('Select state');
    const home = await run(ctx, ['1', '1', '00'], profile);
    expect(home.last).toContain('AgriVoice');
  });

  it('invalid input shows the screen again with an error line', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['abc'], profile);
    expect(r.last).toContain('Invalid choice');
    expect(r.last).toContain('1 Farm brief');
  });

  it('menu 0 is invalid, 00 is ignored on the menu', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['0', '00'], profile);
    expect(r.last).toContain('AgriVoice');
  });
});

describe('main menu', () => {
  it('shows all five options for a returning farmer', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, [], profile);
    for (const k of ['1 Farm brief', '2 Weather and alerts', '3 Market prices', '4 Ask a question', '5 My settings'])
      expect(r.last).toContain(k);
  });

  it('brief: demo prefix and no-brief screen', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['1'], profile);
    expect(r.last).toContain('DEMO: Short demo brief.');
    const { ctx: c2 } = makeCtx({ brief: null });
    const r2 = await run(c2, ['1'], profile);
    expect(r2.last).toContain('No farm brief');
  });

  it('brief: long text pages with Next and Back', async () => {
    const { ctx } = makeCtx({ longText: true });
    const r = await run(ctx, ['1', '1', '1'], profile);
    expect(r.screens[2]).toContain('1 Next');
    expect(r.screens[2]).toContain('0 Back');
    expect(r.screens[3]).not.toBe(r.screens[2]);
  });

  it('weather: alert first, then three days, updated time and stale note', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['2'], profile);
    const [first] = r.last.replace('CON ', '').split('\n');
    expect(first).toContain('Heavy rain');
    expect(r.last).toContain('Updated 11:30');
    expect(r.last).toContain('(old data)');
    expect(r.last).toMatch(/Sun 15: 10mm 21-34C/);
  });

  it('weather unavailable', async () => {
    const { ctx } = makeCtx({ weather: null });
    const r = await run(ctx, ['2'], profile);
    expect(r.last).toContain('not available');
  });

  it('prices: crop pick then up to 3 markets with DEMO header', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['3', '1'], profile);
    expect(r.last).toContain('DEMO:');
    expect(r.last.split('\n').filter((l) => l.includes('/')).length).toBe(3);
    expect(r.last).toContain('N900/kg (today)');
  });

  it('ask: list up to 5, answer, back', async () => {
    const { ctx } = makeCtx();
    const r = await run(ctx, ['4'], profile);
    expect(r.last).toContain('5 ');
    expect(r.last).not.toContain('\n6 [PLACEHOLDER]');
    expect(r.last).toContain('6 None of these');
    const a = await run(ctx, ['4', '1'], profile);
    expect(a.last).toContain('DEMO:');
    expect(a.last).toContain('Short answer.');
  });

  it('ask: call-back with consent yes and no', async () => {
    const yes = makeCtx();
    const r = await run(yes.ctx, ['4', '6', '2', '1'], profile);
    expect(r.last.startsWith('END ')).toBe(true);
    expect(yes.calls.callbacks).toEqual([{ topic: 'Call-back topic: Pests or disease', consent: true }]);
    const no = makeCtx();
    await run(no.ctx, ['4', '6', '3', '2'], profile);
    expect(no.calls.callbacks).toEqual([{ topic: 'Call-back topic: Weather', consent: false }]);
  });

  it('ask: empty list offers call-back', async () => {
    const { ctx } = makeCtx({ qaCount: 0 });
    const r = await run(ctx, ['4'], profile);
    expect(r.last).toContain('call-back');
  });
});

describe('settings', () => {
  it('delete my data needs confirmation', async () => {
    const { ctx, calls } = makeCtx();
    const cancel = await run(ctx, ['5', '3', '2'], profile);
    expect(calls.deleted).toBe(0);
    expect(cancel.last).toContain('Settings');
    const done = await run(ctx, ['5', '3', '1'], profile);
    expect(calls.deleted).toBe(1);
    expect(done.last.startsWith('END ')).toBe(true);
    expect(done.last).toContain('30 days');
  });

  it('change place and crop re-saves the profile', async () => {
    const { ctx, calls } = makeCtx();
    const r = await run(ctx, ['5', '2', '7', '4', '1', '2'], profile);
    expect(calls.saved).toHaveLength(1);
    expect(calls.saved[0]!.cropId).toBe(2);
    expect(r.last).toContain('AgriVoice');
  });

  it('change language', async () => {
    const { ctx } = makeCtx({ languages: ['en', 'pcm'] });
    const r = await run(ctx, ['5', '1', '2'], profile);
    expect(r.st.lang).toBe('pcm');
  });
});

describe('limits and robustness', () => {
  it('every screen visited in the flows above is valid (asserted in run)', async () => {
    const { ctx } = makeCtx({ longText: true });
    await run(ctx, ['7', '4', '1', '1', '1', '1', '1', '1', '0', '2', '0', '3', '1', '0', '0', '4', '1', '1', '0', '6']);
  });

  it('never throws and always returns a valid screen for random input', async () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const tokens = ['0', '00', '1', '2', '3', '4', '5', '6', '7', '8', '9', '99', 'x', '', '*', '1*1', ' 2 '];
    for (const opts of [{}, { longText: true }, { weather: null }, { noCrops: true }, { languages: ['en', 'pcm'] }]) {
      const { ctx } = makeCtx(opts);
      for (let s = 0; s < 40; s++) {
        let st: SessionState | null = null;
        for (let i = 0; i < 40; i++) {
          const input = i === 0 ? '' : tokens[Math.floor(rand() * tokens.length)]!;
          const r = await step(st, input, ctx, s % 2 ? profile : null);
          expectValid(r.text);
          if (r.end) break;
          st = r.state;
        }
      }
    }
  });

  it('survives a failing data layer', async () => {
    const { ctx } = makeCtx();
    ctx.listStates = async () => {
      throw new Error('db down');
    };
    const r = await step(null, '', ctx);
    expectValid(r.text);
    expect(r.end).toBe(true);
  });

  it('sanitises non GSM characters coming from data', async () => {
    const { ctx } = makeCtx({ brief: { summary: 'Price ₦500 “good” ọ', isPlaceholder: false } });
    const r = await run(ctx, ['1'], profile);
    expect(r.last).toContain('Price N500');
  });
});
