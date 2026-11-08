import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, GraduationCap } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { EventDialog } from "@/components/EventDialog";
import { MiniCalendar } from "@/components/MiniCalendar";
import { colorClasses } from "@/lib/calendar-colors";
import { clock12, formatKoDate, monthGrid, parseKey, seoulParts, toMinutes } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import type { CalendarEvent, TodayItem } from "@/types/domain";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "메인 · MyWorkspace" },
      { name: "description", content: "현재 시각과 오늘 일정, 선택한 날짜의 일정을 확인합니다." },
      { property: "og:title", content: "메인 · MyWorkspace" },
      {
        property: "og:description",
        content: "현재 시각과 오늘 일정, 선택한 날짜의 일정을 확인합니다.",
      },
    ],
  }),
  component: Index,
});

type Row = {
  id: string;
  start: string | null;
  end: string | null;
  title: string;
  meta: string;
  badge: string;
  color: keyof typeof colorClasses;
  isClass: boolean;
  event?: CalendarEvent;
};

function toRow(i: TodayItem): Row {
  if (i.kind === "class")
    return {
      id: i.id,
      start: i.start,
      end: i.end,
      title: i.title,
      meta: `학교 · ${i.room}`,
      badge: "학교",
      color: "school",
      isClass: true,
    };
  const e = i.event;
  const src = i.calendar.source === "icloud" ? "iCloud" : i.calendar.name;
  return {
    id: i.id,
    start: e.allDay ? null : e.start!,
    end: e.allDay ? null : (e.end ?? null),
    title: e.title,
    meta: [i.calendar.name, e.location].filter(Boolean).join(" · "),
    badge: src,
    color: i.calendar.color,
    isClass: false,
    event: e,
  };
}

function Index() {
  const now = useNow();
  const parts = now ? seoulParts(now) : null;
  const today = parts?.dateKey;
  const nowMin = parts ? toMinutes(parts.time) : 0;
  const clock = parts ? clock12(parts.time) : null;
  const clockTime = clock && parts ? `${clock.time}:${parts.seconds}` : "--:--:--";
  const [selection, setSelection] = useState<string | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const selected = selection ?? today;
  const view = month ?? (today ? parseKey(today) : null);
  const grid = view ? monthGrid(view.y, view.m) : [];
  const from = grid[0]?.key;
  const to = grid.at(-1)?.key;
  const { data: selectedItems, isLoading: selectedLoading } = useQuery({
    queryKey: ["schedule", "today", selected],
    queryFn: () => api.today.get(selected!),
    enabled: !!selected,
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["schedule", "today", today],
    queryFn: () => api.today.get(today!),
    enabled: !!today,
  });
  const { data: calendars = [] } = useQuery({
    queryKey: ["schedule", "calendars"],
    queryFn: () => api.calendar.listCalendars(),
  });
  const { data: monthEvents = [] } = useQuery({
    queryKey: ["schedule", "events", from, to],
    queryFn: () => api.calendar.listEvents({ from: from!, to: to! }),
    enabled: !!from,
  });

  const [dialog, setDialog] = useState<{ open: boolean; event?: CalendarEvent }>({ open: false });

  const rows = useMemo(() => (items ?? []).map(toRow), [items]);
  const timed = rows.filter((r) => r.start);
  const current = timed.find(
    (r) =>
      toMinutes(r.start!) <= nowMin && nowMin < toMinutes(r.end ?? r.start!) + (r.end ? 0 : 60),
  );
  const marked = useMemo(() => new Set(monthEvents.map((e) => e.date)), [monthEvents]);
  const holidayDates = useMemo(() => {
    const holidayIds = new Set(calendars.filter((c) => c.source === "holiday").map((c) => c.id));
    return new Set(monthEvents.filter((e) => holidayIds.has(e.calendarId)).map((e) => e.date));
  }, [monthEvents, calendars]);

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-8 md:px-10 md:py-14 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-0">
      <div className="min-w-0 lg:pr-10">
        <h1 className="sr-only">메인</h1>
        {/* Clock */}
        <section aria-label="현재 시각 (서울)" className="@container">
          <p className="mb-5 text-lg font-medium sm:text-2xl">
            {today ? formatKoDate(today) : "\u00a0"}
          </p>
          <p
            className="flex items-baseline gap-2 whitespace-nowrap text-[clamp(2rem,15cqw,6rem)] font-extrabold leading-none tracking-tight"
            aria-label={clock ? `${clock.period} ${clockTime}` : "시각을 불러오는 중"}
          >
            <span className="text-[0.5em] text-muted-foreground">{clock?.period ?? ""}</span>
            <span className="tabular">{clockTime}</span>
          </p>
        </section>

        {/* Today */}
        <section aria-labelledby="today-title" className="mt-12 md:mt-16">
          <div className="flex items-center justify-between gap-4">
            <h2 id="today-title" className="text-2xl font-bold">
              오늘의 일정
            </h2>
          </div>

          {isLoading || !items ? (
            <p className="py-8 text-muted-foreground" role="status">
              일정을 불러오는 중…
            </p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-muted-foreground">오늘은 일정이 없습니다.</p>
          ) : (
            <ol className="relative mt-6">
              <span
                aria-hidden
                className="absolute bottom-6 left-[6.4rem] top-6 w-px bg-primary/40 max-sm:left-[5.4rem]"
              />
              {rows.map((r) => {
                const isCurrent = current?.id === r.id;
                const past = r.start ? toMinutes(r.end ?? r.start) <= nowMin && !isCurrent : false;
                const body = (
                  <>
                    <span className="w-16 shrink-0 pt-0.5 text-lg font-semibold tabular sm:w-20 sm:text-xl">
                      {r.start ?? "종일"}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "relative z-10 mt-2.5 size-3 shrink-0 rounded-full ring-4 ring-background",
                        isCurrent ? "bg-primary" : "bg-primary/70",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-lg font-bold">{r.title}</span>
                          <span className="mt-1 flex items-center gap-1.5 text-[15px] text-muted-foreground">
                            {r.isClass ? (
                              <GraduationCap aria-hidden className="size-4 shrink-0" />
                            ) : (
                              <CalendarDays aria-hidden className="size-4 shrink-0" />
                            )}
                            <span className="truncate">
                              {r.meta}
                              {r.end && ` · ${r.start}–${r.end}`}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-sm",
                              colorClasses[r.color].chip,
                            )}
                          >
                            {r.badge}
                          </span>
                          {isCurrent && (
                            <span className="text-xs font-semibold text-primary">진행 중</span>
                          )}
                          {past && <span className="text-xs text-muted-foreground">지남</span>}
                        </span>
                      </span>
                    </span>
                  </>
                );
                const cls = cn(
                  "flex w-full items-start gap-4 rounded-xl px-3 py-5 text-left sm:gap-6",
                  isCurrent && "bg-accent",
                  past && "opacity-70",
                );
                return (
                  <li key={r.id}>
                    {r.event ? (
                      <button
                        type="button"
                        className={cn(cls, "hover:bg-accent/60")}
                        onClick={() => {
                          if (r.event) setDialog({ open: true, event: r.event });
                        }}
                        aria-label={`${r.start ?? "종일"} ${r.title}, 일정 열기`}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className={cls}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <aside
        aria-label="달력과 선택 날짜 일정"
        className="min-w-0 border-t pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
      >
        {today && selected && view && (
          <MiniCalendar
            today={today}
            markedDates={marked}
            holidayDates={holidayDates}
            selected={selected}
            onSelect={setSelection}
            view={view}
            onViewChange={setMonth}
          />
        )}
        <section aria-labelledby="selected-day-title" className="mt-8 border-t pt-6">
          <h2 id="selected-day-title" className="text-lg font-bold leading-relaxed">
            {selected ? `${formatKoDate(selected)}의 일정` : "일정을 불러오는 중…"}
          </h2>
          {selectedLoading || !selectedItems ? (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              일정을 불러오는 중…
            </p>
          ) : selectedItems.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">일정이 없습니다.</p>
          ) : (
            <ul className="mt-4 divide-y">
              {selectedItems.map(toRow).map((r) => (
                <li key={r.id} className="min-w-0 py-3">
                  {r.event ? (
                    <button
                      type="button"
                      className="w-full min-w-0 rounded-md text-left hover:bg-accent"
                      onClick={() => setDialog({ open: true, event: r.event! })}
                    >
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {r.start ? `${r.start}–${r.end}` : "종일"}
                      </p>
                      <p className="mt-1 truncate font-semibold">{r.title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{r.meta}</p>
                    </button>
                  ) : (
                    <div>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {r.start}–{r.end}
                      </p>
                      <p className="mt-1 truncate font-semibold">{r.title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{r.meta}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <EventDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        calendars={calendars}
        event={dialog.event}
        defaults={today ? { date: today } : undefined}
      />
    </div>
  );
}
