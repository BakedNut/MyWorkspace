import type { DateKey, TimeHM } from "@/types/domain";

export const TIME_ZONE = "Asia/Seoul";
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Wall-clock parts of an instant in Asia/Seoul, independent of the browser's time zone. */
export function seoulParts(d: Date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    dateKey: `${p["year"]}-${p["month"]}-${p["day"]}` as DateKey,
    time: `${p["hour"]}:${p["minute"]}` as TimeHM,
    seconds: p["second"] as string,
  };
}

export const todayKey = () => seoulParts().dateKey;

export function clock12(time: TimeHM) {
  const minutes = toMinutes(time);
  if (!Number.isFinite(minutes)) throw new RangeError("올바른 시각이 아닙니다.");
  const hour = Math.floor(minutes / 60);
  return {
    period: hour >= 12 ? "오후" : "오전",
    time: `${String(hour % 12 || 12).padStart(2, "0")}:${time.slice(3)}`,
  };
}

export function parseKey(k: DateKey) {
  const [y = NaN, m = NaN, d = NaN] = k.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(k) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) {
    throw new RangeError("올바른 날짜가 아닙니다.");
  }
  return { y, m, d };
}

function keyToUTC(k: DateKey) {
  const { y, m, d } = parseKey(k);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date;
}

export function makeKey(y: number, m: number, d: number): DateKey {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.toISOString().slice(0, 10);
}

export function addDays(k: DateKey, n: number): DateKey {
  const t = keyToUTC(k);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function weekday(k: DateKey) {
  return keyToUTC(k).getUTCDay();
}

export function formatKoDate(k: DateKey) {
  const { y, m, d } = parseKey(k);
  return `${y}년 ${m}월 ${d}일 ${WEEKDAYS[weekday(k)]}요일`;
}

export function formatShort(k: DateKey) {
  const { m, d } = parseKey(k);
  return `${m}월 ${d}일 (${WEEKDAYS[weekday(k)]})`;
}

export function toMinutes(t: TimeHM) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return NaN;
  const [h = NaN, m = NaN] = t.split(":").map(Number);
  return h * 60 + m;
}

export function shiftMonth(y: number, m: number, delta: number) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Full weeks (Sunday-first) covering the given month. */
export function monthGrid(y: number, m: number): { key: DateKey; inMonth: boolean }[] {
  const first = makeKey(y, m, 1);
  const start = addDays(first, -weekday(first));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((weekday(first) + daysInMonth) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const key = addDays(start, i);
    return { key, inMonth: parseKey(key).m === m };
  });
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
