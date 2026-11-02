const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Milliseconds from a number (ms) or a duration like '90s', '15m', '2h', '3d', '1w', '1h30m'. */
export function toMs(duration: number | string): number {
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration < 0) throw new TypeError(`Invalid duration: ${duration}`);
    return duration;
  }
  const parts = [...duration.trim().matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/g)];
  if (!parts.length || parts.map((p) => p[0]).join('').replace(/\s/g, '') !== duration.replace(/\s/g, '')) {
    throw new TypeError(`Invalid duration: "${duration}" (use e.g. '30s', '15m', '2h', '3d')`);
  }
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit], 0);
}

/** An absolute time from a Date, an ISO date string, a duration string or milliseconds from now. */
export function resolveUntil(when: number | string | Date, now = Date.now()): string {
  if (when instanceof Date) return when.toISOString();
  if (typeof when === 'string' && /^\d{4}-\d{2}-\d{2}/.test(when)) {
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) throw new TypeError(`Invalid date: "${when}"`);
    return d.toISOString();
  }
  return new Date(now + toMs(when)).toISOString();
}
