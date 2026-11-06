import { HISTORY_WINDOWS } from "@/lib/server-history";
import type { ServerHistory, ServerRange, UsagePoint } from "@/types/domain";
import { sampleServerStatus } from "./seed";

// Preview samples only; the REST adapter must return recorded Proxmox metrics.
export function sampleServerHistory(range: ServerRange, end: number): ServerHistory {
  const { duration, step } = HISTORY_WINDOWS[range];
  const from = end - duration;
  const series = (base: number, phase: number): UsagePoint[] =>
    Array.from({ length: duration / step + 1 }, (_, i) => {
      const at = from + i * step;
      const wave = (t: number) =>
        Math.sin(t / 180_000 + phase) * 6 + Math.sin(t / 1600_000 + phase) * 3;
      return {
        at,
        value: Math.round(Math.max(0, Math.min(100, base + wave(at) - wave(end))) * 10) / 10,
      };
    });
  const status = sampleServerStatus(new Date(end), true);
  return {
    from,
    to: end,
    host: {
      cpu: series(status.cpu.usagePercent, 0),
      ram: series((status.ram.usedMb / status.ram.totalMb) * 100, 2),
    },
    guests: Object.fromEntries(
      status.guests.map((g) => [
        `${g.type}-${g.id}`,
        {
          cpu:
            g.status === "stopped"
              ? []
              : g.status === "paused"
                ? series(0, 0).map((p) => ({ ...p, value: 0 }))
                : series(g.cpuPercent, g.id),
          ram: g.status === "stopped" ? [] : series((g.memUsedMb / g.memTotalMb) * 100, g.id + 1),
        },
      ]),
    ),
  };
}
