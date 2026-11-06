import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, GraduationCap, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { EventDialog } from "@/components/EventDialog";
import { MiniCalendar } from "@/components/MiniCalendar";
import { Button } from "@/components/ui/button";
import { colorClasses } from "@/lib/calendar-colors";
import { expandTimetable } from "@/lib/schedule";
import { addDays, formatKoDate, formatShort, seoulParts, toMinutes } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import type { CalendarEvent, TodayItem } from "@/types/domain";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "메인 · MyWorkspace" },
      { name: "description", content: "현재 시각과 오늘 일정, 다음 수업을 한눈에 확인합니다." },
      { property: "og:title", content: "메인 · MyWorkspace" },
      {
        property: "og:description",
        content: "현재 시각과 오늘 일정, 다음 수업을 한눈에 확인합니다.",
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

  const { data: items, isLoading } = useQuery({
    queryKey: ["schedule", "today", today],
    queryFn: () => api.today.get(today!),
    enabled: !!today,
  });
  const { data: calendars = [] } = useQuery({
    queryKey: ["schedule", "calendars"],
    queryFn: () => api.calendar.listCalendars(),
  });
  const { data: timetable } = useQuery({
    queryKey: ["schedule", "timetable"],
    queryFn: () => api.timetable.get(),
  });
  const { data: monthEvents = [] } = useQuery({
    queryKey: ["schedule", "events", today && addDays(today, -40), today && addDays(today, 40)],
    queryFn: () => api.calendar.listEvents({ from: addDays(today!, -40), to: addDays(today!, 40) }),
    enabled: !!today,
  });

  const [dialog, setDialog] = useState<{ open: boolean; event?: CalendarEvent }>({ open: false });

  const rows = useMemo(() => (items ?? []).map(toRow), [items]);
  const timed = rows.filter((r) => r.start);
  const current = timed.find(
    (r) =>
      toMinutes(r.start!) <= nowMin && nowMin < toMinutes(r.end ?? r.start!) + (r.end ? 0 : 60),
  );
  const next = timed.find((r) => toMinutes(r.start!) > nowMin);

  const upcomingClasses = useMemo(() => {
    if (!timetable || !today || !parts) return [];
    return expandTimetable(timetable, today, addDays(today, 21))
      .filter((c) => c.date > today || toMinutes(c.start) > nowMin)
      .slice(0, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable, today, Math.floor(nowMin)]);

  const marked = useMemo(() => {
    const s = new Set(monthEvents.map((e) => e.date));
    if (timetable && today)
      expandTimetable(timetable, addDays(today, -40), addDays(today, 40)).forEach((c) =>
        s.add(c.date),
      );
    return s;
  }, [monthEvents, timetable, today]);

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-8 md:px-10 md:py-14 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-0">
      <div className="min-w-0 lg:pr-10">
        <h1 className="sr-only">메인</h1>
        {/* Clock */}
        <section aria-label="현재 시각 (서울)">
          <p
            className="text-7xl font-extrabold leading-none tracking-tight tabular sm:text-8xl md:text-[8.5rem]"
            aria-hidden={!parts}
          >
            {parts ? parts.time : "--:--"}
          </p>
          <p className="mt-4 text-xl font-medium sm:text-3xl">
            {today ? formatKoDate(today) : "\u00a0"}
          </p>
          {parts && (
            <p className="mt-5 text-[15px] text-muted-foreground" aria-live="polite">
              {current ? (
                <>
                  <span className="font-semibold text-foreground">지금</span> {current.title}
                  {current.end && ` · ${current.end}까지`}
                </>
              ) : (
                "지금 진행 중인 일정 없음"
              )}
              <span aria-hidden className="mx-2">
                /
              </span>
              {next ? (
                <>
                  <span className="font-semibold text-foreground">다음</span> {next.start}{" "}
                  {next.title}
                </>
              ) : (
                "오늘 남은 일정 없음"
              )}
            </p>
          )}
        </section>

        {/* Today */}
        <section aria-labelledby="today-title" className="mt-12 md:mt-16">
          <div className="flex items-center justify-between gap-4">
            <h2 id="today-title" className="text-2xl font-bold">
              오늘의 일정
            </h2>
            <Button size="lg" onClick={() => setDialog({ open: true })} disabled={!today}>
              <Plus aria-hidden /> 일정 추가
            </Button>
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

      {/* Right column */}
      <aside
        aria-label="달력과 다음 수업"
        className="border-t pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
      >
        {today && <MiniCalendar today={today} markedDates={marked} />}
        <section aria-labelledby="next-class" className="mt-8 border-t pt-8">
          <div className="flex items-baseline justify-between">
            <h2 id="next-class" className="text-xl font-bold">
              다음 수업
            </h2>
            <Link
              to="/calendar"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              시간표 보기
            </Link>
          </div>
          {upcomingClasses.length === 0 ? (
            <p className="mt-4 text-muted-foreground">예정된 수업이 없습니다.</p>
          ) : (
            <ul className="mt-4 space-y-5">
              {upcomingClasses.map((c) => (
                <li key={c.courseId + c.date}>
                  <p className="font-semibold">
                    {formatShort(c.date)}{" "}
                    <span className="ml-1 font-normal tabular">{c.start}</span>
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                    <GraduationCap aria-hidden className="size-4" />
                    {c.name} · {c.room}
                  </p>
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
