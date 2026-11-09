import { HISTORY_WINDOWS } from "@/lib/server-history";
import type { ServerHistory, ServerRange, UsagePoint } from "@/types/domain";
import { sampleServerStatus } from "./seed";

// Preview samples only; the REST adapter must return recorded Proxmox metrics.
export function sampleServerHistory(range: ServerRange, end: number): ServerHistory {
  const { duration, step } = HISTORY_WINDOWS[range];
  const from = end - duration;
  const series = (base: number, phase: number, maximum = 100, amplitude = 6): UsagePoint[] =>
    Array.from({ length: duration / step + 1 }, (_, i) => {
      const at = from + i * step;
      const wave = (t: number) =>
        Math.sin(t / 180_000 + phase) * amplitude +
        (Math.sin(t / 1600_000 + phase) * amplitude) / 2;
      return {
        at,
        value: Math.round(Math.max(0, Math.min(maximum, base + wave(at) - wave(end))) * 10) / 10,
      };
    });
  const status = sampleServerStatus(new Date(end), true);
  return {
    from,
    to: end,
    host: {
      cpu: series(status.cpu.usagePercent, 0),
      ram: series((status.ram.usedMb / status.ram.totalMb) * 100, 2),
      input: series(
        status.network.inputBytesPerSecond,
        3,
        Infinity,
        status.network.inputBytesPerSecond * 0.15,
      ),
      output: series(
        status.network.outputBytesPerSecond,
        5,
        Infinity,
        status.network.outputBytesPerSecond * 0.15,
      ),
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
          input:
            g.status === "stopped"
              ? []
              : series(
                  g.network.inputBytesPerSecond,
                  g.id + 3,
                  Infinity,
                  g.network.inputBytesPerSecond * 0.15,
                ),
          output:
            g.status === "stopped"
              ? []
              : series(
                  g.network.outputBytesPerSecond,
                  g.id + 5,
                  Infinity,
                  g.network.outputBytesPerSecond * 0.15,
                ),
          disk:
            g.disk.usedGb === null || g.disk.totalGb <= 0
              ? []
              : series((g.disk.usedGb / g.disk.totalGb) * 100, g.id + 8, 100, 0.15),
        },
      ]),
    ),
  };
}
