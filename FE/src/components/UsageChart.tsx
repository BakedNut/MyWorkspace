import { formatRate, usagePath } from "@/lib/server-history";
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
  secondaryPoints,
  unit = "percent",
}: {
  points?: UsagePoint[] | undefined;
  from: number;
  to: number;
  label: string;
  range: ServerRange;
  empty?: string;
  compact?: boolean;
  secondaryPoints?: UsagePoint[] | undefined;
  unit?: "percent" | "bytesPerSecond";
}) {
  const inRange = (p: UsagePoint) =>
    p.value !== null &&
    Number.isFinite(p.value) &&
    Number.isFinite(p.at) &&
    p.at >= from &&
    p.at <= to;
  const valid = points.filter(inRange);
  const second = (secondaryPoints ?? []).filter(inRange);
  const maximum =
    unit === "percent" ? 100 : Math.max(1, ...[...valid, ...second].map((p) => p.value!)) * 1.1;
  const valueLabel = (value: number | null | undefined) =>
    value == null ? "—" : unit === "percent" ? `${value.toFixed(1)}%` : formatRate(value);
  const hasLines = valid.length >= 2 || second.length >= 2;
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
    <figure
      aria-label={`${label} ${range} ${unit === "percent" ? "사용률" : "전송량"} 그래프`}
      className="min-w-0"
    >
      {!hasLines ? (
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
          <div className="flex flex-wrap justify-between gap-x-2 text-[10px] text-muted-foreground">
            <span>{unit === "percent" ? "100%" : formatRate(maximum)}</span>
            {secondaryPoints ? (
              <span className="inline-flex gap-2">
                <span className="text-primary">Input</span>
                <span className="text-cal-icloud">Output</span>
              </span>
            ) : (
              <span>0–100%</span>
            )}
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
              d={usagePath(points, from, to, maximum)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              className={
                unit === "percent" && label.endsWith(" RAM") ? "text-cal-icloud" : "text-primary"
              }
            />
            {secondaryPoints && (
              <path
                d={usagePath(secondaryPoints, from, to, maximum)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                className="text-cal-icloud"
              />
            )}
          </svg>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
            <span>{format(from)}</span>
            <span>{format(to)}</span>
          </div>
          <figcaption className="sr-only">
            {label} 최신 기록{" "}
            {secondaryPoints
              ? `Input ${valueLabel(valid.at(-1)?.value)}, Output ${valueLabel(second.at(-1)?.value)}`
              : valueLabel(valid.at(-1)?.value)}
            . {format(from)}부터 {format(to)}
            까지.
          </figcaption>
        </>
      )}
    </figure>
  );
}
