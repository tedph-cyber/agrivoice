/** Truncate at a word boundary, adding "..." when text is cut. Result length never exceeds max. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  if (max <= 3) return '.'.repeat(Math.max(0, max));
  const room = max - 3;
  let cut = clean.slice(0, room);
  const nextCharIsSpace = clean[room] === ' ';
  if (!nextCharIsSpace) {
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  }
  return cut.replace(/[\s.,;:!?-]+$/, '') + '...';
}

/** Split text into pages of at most `max` characters, breaking at spaces where possible. */
export function paginate(text: string, max: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const pages: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > max) {
      if (cur) {
        pages.push(cur);
        cur = '';
      }
      pages.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ' ' + w;
    else {
      pages.push(cur);
      cur = w;
    }
  }
  if (cur) pages.push(cur);
  return pages.length ? pages : [''];
}

/** Format an ISO date (YYYY-MM-DD) as e.g. "Sat 14" for compact screens. */
export function shortDay(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${names[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Format an ISO timestamp as HH:MM in Africa/Lagos (UTC+1, no DST). */
export function lagosTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3600_000);
  return d.toISOString().slice(11, 16);
}
