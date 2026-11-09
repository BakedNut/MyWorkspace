import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatRate, historySample, HISTORY_WINDOWS, usagePath } from "@/lib/server-history";
import { TIME_ZONE } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ServerRange, UsagePoint } from "@/types/domain";

const tooltipTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

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
  const tooltipId = useId();
  const [cursor, setCursor] = useState<{ at: number; scope: string } | null>(null);
  const scope = `${range}:${from}:${to}`;
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
  const active =
    hasLines && cursor?.scope === scope
      ? historySample(
          points,
          secondaryPoints ?? [],
          cursor.at,
          from,
          to,
          HISTORY_WINDOWS[range].step,
        )
      : null;
  const cursorX = active ? ((active.at - from) / (to - from)) * 300 : 0;
  const lineColor =
    unit === "percent" && label.endsWith(" RAM") ? "text-cal-icloud" : "text-primary";
  const sampleLabel = (value: number | null) => (value === null ? "기록 없음" : valueLabel(value));
  const selectAt = (at: number) => setCursor({ at: Math.max(from, Math.min(to, at)), scope });
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (width > 0) selectAt(from + ((event.clientX - left) / width) * (to - from));
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") return setCursor(null);
    const at = active?.at ?? to;
    const positions: Record<string, number> = {
      ArrowLeft: at - HISTORY_WINDOWS[range].step,
      ArrowRight: at + HISTORY_WINDOWS[range].step,
      Home: from,
      End: to,
    };
    const next = positions[event.key];
    if (next !== undefined) {
      event.preventDefault();
      selectAt(next);
    }
  };
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
          <div
            role="group"
            aria-label={`${label} 기록 탐색`}
            aria-describedby={active ? tooltipId : undefined}
            tabIndex={0}
            onPointerMove={move}
            onPointerDown={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              move(event);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") setCursor(null);
            }}
            onPointerCancel={() => setCursor(null)}
            onFocus={() => selectAt(to)}
            onBlur={() => setCursor(null)}
            onKeyDown={keyboard}
            className={cn(
              "relative mt-1 touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              compact ? "h-14" : "h-24",
            )}
          >
            {active && (
              <div
                id={tooltipId}
                role="tooltip"
                aria-live="polite"
                aria-atomic="true"
                className="pointer-events-none absolute bottom-full z-20 mb-1 w-max max-w-full break-words rounded-md border bg-popover px-2 py-1.5 text-[11px] text-popover-foreground shadow-md"
                style={cursorX > 150 ? { right: 0 } : { left: 0 }}
              >
                <p className="tabular-nums text-muted-foreground">
                  {tooltipTime.format(active.at)}
                </p>
                {secondaryPoints ? (
                  <>
                    <p className="text-primary">Input {sampleLabel(active.value)}</p>
                    <p className="text-cal-icloud">Output {sampleLabel(active.secondaryValue)}</p>
                  </>
                ) : (
                  <p>사용률 {sampleLabel(active.value)}</p>
                )}
              </div>
            )}
            <svg
              viewBox="0 0 300 88"
              preserveAspectRatio="none"
              className="block size-full overflow-visible"
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
                className={lineColor}
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
              {active && (
                <g className="pointer-events-none">
                  <line
                    x1={cursorX}
                    x2={cursorX}
                    y1="0"
                    y2="88"
                    stroke="currentColor"
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                    className="text-muted-foreground"
                  />
                  {active.value !== null && (
                    <circle
                      cx={cursorX}
                      cy={88 - (Math.max(0, Math.min(maximum, active.value)) / maximum) * 88}
                      r="3"
                      fill="currentColor"
                      className={lineColor}
                    />
                  )}
                  {secondaryPoints && active.secondaryValue !== null && (
                    <circle
                      cx={cursorX}
                      cy={
                        88 - (Math.max(0, Math.min(maximum, active.secondaryValue)) / maximum) * 88
                      }
                      r="3"
                      fill="currentColor"
                      className="text-cal-icloud"
                    />
                  )}
                </g>
              )}
            </svg>
          </div>
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
