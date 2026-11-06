import { usagePath } from "@/lib/server-history";
import { TIME_ZONE } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ServerRange, UsagePoint } from "@/types/domain";

export function UsageChart({
  points = [],
  from,
  to,
  label,
  range,
  empty = "기록 없음",
  compact = false,
}: {
  points?: UsagePoint[] | undefined;
  from: number;
  to: number;
  label: string;
  range: ServerRange;
  empty?: string;
  compact?: boolean;
}) {
  const valid = points.filter(
    (p) => p.value !== null && Number.isFinite(p.value) && p.at >= from && p.at <= to,
  );
  const format = (at: number) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: TIME_ZONE,
      ...(range === "1D" || range === "1W" || range === "1M"
        ? { month: "numeric", day: "numeric" }
        : {}),
      hour: "2-digit",
      minute: "2-digit",
      ...(range === "1m" ? { second: "2-digit" } : {}),
      hourCycle: "h23",
    }).format(new Date(at));
  return (
    <figure aria-label={`${label} ${range} 사용률 그래프`} className="min-w-0">
      {valid.length < 2 ? (
        <div
          className={cn(
            "grid place-items-center text-xs text-muted-foreground",
            compact ? "h-14" : "h-24",
          )}
        >
          {empty}
        </div>
      ) : (
        <>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>100%</span>
            <span>0–100%</span>
          </div>
          <svg
            viewBox="0 0 300 88"
            preserveAspectRatio="none"
            className={cn("mt-1 w-full overflow-visible", compact ? "h-14" : "h-24")}
            aria-hidden
          >
            {[0, 44, 88].map((y) => (
              <line
                key={y}
                x1="0"
                x2="300"
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={usagePath(points, from, to)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              className={label.includes("RAM") ? "text-cal-icloud" : "text-primary"}
            />
          </svg>
          <div className="mt-2 flex justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
            <span>{format(from)}</span>
            <span>{format(to)}</span>
          </div>
          <figcaption className="sr-only">
            {label} 최신 기록 {valid.at(-1)?.value?.toFixed(1)}%. {format(from)}부터 {format(to)}
            까지.
          </figcaption>
        </>
      )}
    </figure>
  );
}
