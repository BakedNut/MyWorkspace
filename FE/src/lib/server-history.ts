import type { ServerRange, UsagePoint } from "@/types/domain";

export const HISTORY_WINDOWS: Record<ServerRange, { duration: number; step: number }> = {
  "1m": { duration: 60_000, step: 5_000 },
  "15m": { duration: 15 * 60_000, step: 60_000 },
  "1D": { duration: 24 * 3600_000, step: 15 * 60_000 },
  "1W": { duration: 7 * 24 * 3600_000, step: 3600_000 },
  "1M": { duration: 30 * 24 * 3600_000, step: 6 * 3600_000 },
};

export function usagePath(points: UsagePoint[], from: number, to: number) {
  if (to <= from) return "";
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
      const y = 88 - Math.max(0, Math.min(100, value)) * 0.88;
      const command = `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      connected = true;
      return command;
    })
    .join(" ");
}
