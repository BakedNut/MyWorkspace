import { ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAYS, formatKoDate, monthGrid, parseKey, shiftMonth, weekday } from "@/lib/time";
import { cn } from "@/lib/utils";

export function MiniCalendar({
  today,
  markedDates,
  holidayDates,
  selected,
  onSelect,
  view,
  onViewChange,
}: {
  today: string;
  markedDates: Set<string>;
  holidayDates: Set<string>;
  selected: string;
  onSelect(date: string): void;
  view: { y: number; m: number };
  onViewChange(view: { y: number; m: number }): void;
}) {
  const cells = monthGrid(view.y, view.m);

  return (
    <section aria-labelledby="mini-cal-title">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onViewChange(shiftMonth(view.y, view.m, -1))}
          className="inline-flex size-11 items-center justify-center rounded-md text-primary hover:bg-accent"
        >
          <ChevronLeft aria-hidden className="size-5" />
          <span className="sr-only">이전 달</span>
        </button>
        <h2 id="mini-cal-title" className="text-xl font-semibold" aria-live="polite">
          {view.y}년 {view.m}월
        </h2>
        <button
          type="button"
          onClick={() => onViewChange(shiftMonth(view.y, view.m, 1))}
          className="inline-flex size-11 items-center justify-center rounded-md text-primary hover:bg-accent"
        >
          <ChevronRight aria-hidden className="size-5" />
          <span className="sr-only">다음 달</span>
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-sm" role="presentation">
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            aria-hidden
            className={cn(
              "py-2 text-muted-foreground",
              i === 0 && "text-cal-holiday",
              i === 6 && "text-primary",
            )}
          >
            {w}
          </span>
        ))}
        {cells.map(({ key, inMonth }) => {
          if (!inMonth) return <span key={key} aria-hidden />;
          const wd = weekday(key);
          const isToday = key === today;
          const isHoliday = holidayDates.has(key);
          const isRedDay = wd === 0 || isHoliday;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-pressed={key === selected}
              aria-label={`${formatKoDate(key)}${isToday ? ", 오늘" : ""}${isHoliday ? ", 공휴일" : ""}${markedDates.has(key) ? ", 일정 있음" : ""} — 일정 보기`}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "relative mx-auto flex size-10 flex-col items-center justify-center rounded-lg tabular hover:bg-accent",
                isRedDay && "text-cal-holiday",
                wd === 6 && !isRedDay && "text-primary",
                key === selected && !isToday && "bg-accent ring-1 ring-primary/40",
                isToday &&
                  (isRedDay
                    ? "bg-cal-holiday-soft font-semibold hover:bg-cal-holiday-soft"
                    : "bg-primary font-semibold text-primary-foreground hover:bg-primary"),
              )}
            >
              {parseKey(key).d}
              {markedDates.has(key) && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1 size-1 rounded-full",
                    isToday && !isRedDay ? "bg-primary-foreground" : "bg-primary",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
