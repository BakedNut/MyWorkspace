import type { ServerRange, UsagePoint } from "@/types/domain";

export const HISTORY_WINDOWS: Record<ServerRange, { duration: number; step: number }> = {
  "1m": { duration: 60_000, step: 5_000 },
  "15m": { duration: 15 * 60_000, step: 60_000 },
  "1H": { duration: 3600_000, step: 60_000 },
  "6H": { duration: 6 * 3600_000, step: 5 * 60_000 },
  "12H": { duration: 12 * 3600_000, step: 10 * 60_000 },
  "1D": { duration: 24 * 3600_000, step: 15 * 60_000 },
  "1W": { duration: 7 * 24 * 3600_000, step: 3600_000 },
  "1M": { duration: 30 * 24 * 3600_000, step: 6 * 3600_000 },
};

export function usagePath(points: UsagePoint[], from: number, to: number, maximum = 100) {
  if (to <= from || !Number.isFinite(maximum) || maximum <= 0) return "";
  let connected = false;
  return points
    .map(({ at, value }) => {
      if (
        value === null ||
        !Number.isFinite(value) ||
        at < from ||
        at > to ||
        !Number.isFinite(at)
      ) {
        connected = false;
        return "";
      }
      const x = ((at - from) / (to - from)) * 300;
      const y = 88 - (Math.max(0, Math.min(maximum, value)) / maximum) * 88;
      const command = `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      connected = true;
      return command;
    })
    .join(" ");
}

export function formatRate(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return "—";
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  const index =
    bytesPerSecond === 0
      ? 0
      : Math.min(4, Math.max(0, Math.floor(Math.log(bytesPerSecond) / Math.log(1024))));
  return `${(bytesPerSecond / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
