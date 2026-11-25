const WEEKDAYS_ZH = ['一', '二', '三', '四', '五', '六', '日'] as const;
const TW_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Returns a Date shifted so UTC getters represent Asia/Taipei (UTC+8) wall-clock time.
 */
function getTaipeiShiftedDate(now = new Date()): Date {
  return new Date(now.getTime() + TW_OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTwFull(now = new Date()): string {
  const tw = getTaipeiShiftedDate(now);
  return (
    `${tw.getUTCFullYear()}/${pad2(tw.getUTCMonth() + 1)}/${pad2(tw.getUTCDate())} ` +
    `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}:${pad2(tw.getUTCSeconds())}`
  );
}

export function formatTwShort(now = new Date()): string {
  const tw = getTaipeiShiftedDate(now);
  return (
    `${pad2(tw.getUTCMonth() + 1)}/${pad2(tw.getUTCDate())} ` +
    `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}`
  );
}

export function formatTwTimeOnly(now = new Date()): string {
  const tw = getTaipeiShiftedDate(now);
  return `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}:${pad2(tw.getUTCSeconds())}`;
}

export function formatTwIso(now = new Date()): string {
  const tw = getTaipeiShiftedDate(now);
  return (
    `${tw.getUTCFullYear()}-${pad2(tw.getUTCMonth() + 1)}-${pad2(tw.getUTCDate())}T` +
    `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}:${pad2(tw.getUTCSeconds())}+08:00`
  );
}

/**
 * Returns Monday..Sunday labels for offsetWeeks (0 = this week, 1 = next week) in Taiwan time.
 * Format: "YYYY/MM/DD (一)"
 */
export function getWeekDates(offsetWeeks = 0, now = new Date()): string[] {
  const tw = getTaipeiShiftedDate(now);
  // getUTCDay(): 0 = Sun, 1 = Mon, ... 6 = Sat -> convert to 0 = Mon .. 6 = Sun
  const weekdayIndex = (tw.getUTCDay() + 6) % 7;
  const mondayUtcMs =
    Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) -
    weekdayIndex * 86_400_000 +
    offsetWeeks * 7 * 86_400_000;

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayUtcMs + i * 86_400_000);
    return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} (${WEEKDAYS_ZH[i]})`;
  });
}

export function getWeekKey(offsetWeeks = 0, now = new Date()): string {
  return getWeekDates(offsetWeeks, now)[0].slice(0, 10);
}

export function getWeekOffset(weekType?: string | null): number {
  return weekType === 'current' || weekType === '當週人力' ? 0 : 1;
}
