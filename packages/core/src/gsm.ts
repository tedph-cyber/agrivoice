// GSM 03.38 basic character set (no extension table: those characters cost two septets, so we avoid them).
const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

const SET = new Set(BASIC.replace('\u001b', ''));

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!SET.has(ch)) return false;
  return true;
}

/** Make text GSM 7-bit safe: strip diacritics where possible, replace anything else with '?'. */
export function toGsm7(text: string): string {
  let out = '';
  for (const ch of text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/₦/g, 'N')) {
    if (SET.has(ch)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base === '') continue; // lone combining mark
    out += [...base].every((c) => SET.has(c)) ? base : '?';
  }
  return out;
}
