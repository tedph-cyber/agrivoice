export const QA_MATCH_THRESHOLD = 0.35;

const STOP = new Set(
  'a an the is are was were be been am do does did how what when where why which who whom can could should would will shall may might my your our i we you it its of to in on at for with and or but if so than then this that these those there from by as about into'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.push(raw.length > 3 && raw.endsWith('s') ? raw.slice(0, -1) : raw);
  }
  return out;
}

export interface QaCandidate {
  question: string;
  keywords: string;
}

/**
 * Weighted token overlap, 0..1. Query tokens found in keywords weigh 2, in the question weigh 1.
 * Normalised by the best possible score (every query token found in keywords).
 */
export function scoreQa(query: string, item: QaCandidate): number {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0) return 0;
  const kw = new Set(tokenize(item.keywords));
  const qs = new Set(tokenize(item.question));
  let sum = 0;
  for (const tok of q) sum += kw.has(tok) ? 2 : qs.has(tok) ? 1 : 0;
  return Math.min(1, sum / (2 * q.length));
}
