import { t } from './i18n';

export interface DayForecast {
  date: string;
  precipMm: number | null;
  tmaxC: number | null;
  tminC: number | null;
  popPct: number | null;
}

export interface AlertRule {
  key: string;
  metric: string;
  operator: string;
  threshold: number;
  windowDays: number;
  severity: 'watch' | 'warning';
  enabled: boolean;
  needsReview: boolean;
}

export interface ActiveAlert {
  ruleKey: string;
  severity: 'watch' | 'warning';
  date: string;
  value: number;
  needsReview: boolean;
}

function compare(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case '>':
      return value > threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '>=':
    default:
      return value >= threshold;
  }
}

export const DRY_DAY_MM = 1;

export function evaluateRule(days: DayForecast[], rule: AlertRule): ActiveAlert | null {
  if (!rule.enabled) return null;
  const win = days.slice(0, Math.max(0, rule.windowDays));
  const base = { ruleKey: rule.key, severity: rule.severity, needsReview: rule.needsReview };
  if (rule.metric === 'precip_day_mm' || rule.metric === 'tmax_c') {
    let best: { v: number; date: string } | null = null;
    for (const d of win) {
      const v = rule.metric === 'precip_day_mm' ? d.precipMm : d.tmaxC;
      if (v === null || v === undefined) continue;
      if (!best || v > best.v) best = { v, date: d.date };
    }
    if (best && compare(best.v, rule.operator, rule.threshold)) return { ...base, date: best.date, value: best.v };
    return null;
  }
  if (rule.metric === 'dry_days_consecutive') {
    let bestLen = 0;
    let bestStart = '';
    let runLen = 0;
    let runStart = '';
    for (const d of win) {
      if (d.precipMm !== null && d.precipMm < DRY_DAY_MM) {
        if (runLen === 0) runStart = d.date;
        runLen++;
        if (runLen > bestLen) {
          bestLen = runLen;
          bestStart = runStart;
        }
      } else runLen = 0;
    }
    if (bestLen > 0 && compare(bestLen, rule.operator, rule.threshold))
      return { ...base, date: bestStart, value: bestLen };
    return null;
  }
  return null;
}

export function evaluateRules(days: DayForecast[], rules: AlertRule[]): ActiveAlert[] {
  const out: ActiveAlert[] = [];
  for (const r of rules) {
    const a = evaluateRule(days, r);
    if (a) out.push(a);
  }
  // warnings first, then earliest date
  return out.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1) || a.date.localeCompare(b.date),
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function alertMessage(alert: ActiveAlert, place: string, lang: string): string {
  const key = `alert.${alert.ruleKey}`;
  const known = ['alert.heavy_rain', 'alert.dry_spell', 'alert.heat'].includes(key);
  const value = Number.isInteger(alert.value) ? alert.value : Math.round(alert.value * 10) / 10;
  return t(lang, known ? key : 'alert.generic', { place, date: formatDate(alert.date), value });
}
