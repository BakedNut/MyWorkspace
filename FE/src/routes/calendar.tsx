import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Cloud, GraduationCap, Lock, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { api } from "@/api";
import { EventDialog, selectClass } from "@/components/EventDialog";
import { ICloudDialog } from "@/components/ICloudDialog";
import { TimetableDialog } from "@/components/TimetableDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { colorClasses, sourceLabel } from "@/lib/calendar-colors";
import { expandTimetable } from "@/lib/schedule";
import {
  WEEKDAYS,
  formatKoDate,
  monthGrid,
  parseKey,
  shiftMonth,
  todayKey,
  weekday,
} from "@/lib/time";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/domain";

export const Route = createFileRoute("/calendar")({
  validateSearch: (s: Record<string, unknown>): { date?: string } => {
    const date = s["date"];
    if (typeof date !== "string") return {};
    try {
      parseKey(date);
      return { date };
    } catch {
      return {};
    }
  },
  head: () => ({
    meta: [
      { title: "캘린더 · MyWorkspace" },
      { name: "description", content: "월간 일정과 학교 시간표를 함께 보고 편집합니다." },
      { property: "og:title", content: "캘린더 · MyWorkspace" },
      { property: "og:description", content: "월간 일정과 학교 시간표를 함께 보고 편집합니다." },
    ],
  }),
  component: CalendarPage,
});

const SCHOOL_ID = "__school";

function CalendarPage() {
  const search = Route.useSearch();
  const [today, setToday] = useState<string | null>(null);
  const [view, setView] = useState<{ y: number; m: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [eventDlg, setEventDlg] = useState<{ open: boolean; event?: CalendarEvent; date?: string }>(
    { open: false },
  );
  const [quickDate, setQuickDate] = useState<string | null>(null);
  const [ttOpen, setTtOpen] = useState(false);
  const [icloudOpen, setIcloudOpen] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const t = todayKey();
    const target = search.date ?? t;
    const p = parseKey(target);
    setToday(t);
    setView({ y: p.y, m: p.m });
    setSelected(target);
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, [search.date]);

  const grid = view ? monthGrid(view.y, view.m) : [];
  const from = grid[0]?.key;
  const to = grid[grid.length - 1]?.key;

  const { data: calendars = [] } = useQuery({
    queryKey: ["schedule", "calendars"],
    queryFn: () => api.calendar.listCalendars(),
  });
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["schedule", "events", from, to],
    queryFn: () => api.calendar.listEvents({ from: from!, to: to! }),
    enabled: !!from,
  });
  const { data: timetable } = useQuery({
    queryKey: ["schedule", "timetable"],
    queryFn: () => api.timetable.get(),
  });
  const { data: icloud } = useQuery({
    queryKey: ["schedule", "icloud"],
    queryFn: () => api.calendar.getICloudStatus(),
  });

  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const classesByDate = useMemo(() => {
    const m = new Map<string, ReturnType<typeof expandTimetable>>();
    if (timetable && from && !hidden.has(SCHOOL_ID))
      for (const c of expandTimetable(timetable, from, to!))
        m.set(c.date, [...(m.get(c.date) ?? []), c]);
    return m;
  }, [timetable, from, to, hidden]);
  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (hidden.has(e.calendarId)) continue;
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    for (const list of m.values())
      list.sort((a, b) => (a.allDay ? "" : a.start!).localeCompare(b.allDay ? "" : b.start!));
    return m;
  }, [events, hidden]);

  if (!view || !today) return <p className="p-10 text-muted-foreground">불러오는 중…</p>;

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selEvents = selected ? (eventsByDate.get(selected) ?? []) : [];
  const selClasses = selected ? (classesByDate.get(selected) ?? []) : [];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h1
            className="min-w-36 whitespace-nowrap text-2xl font-bold tabular sm:text-3xl"
            aria-live="polite"
          >
            {view.y}년 {view.m}월
          </h1>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-primary"
            aria-label="이전 달"
            onClick={() => setView(shiftMonth(view.y, view.m, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-primary"
            aria-label="다음 달"
            onClick={() => setView(shiftMonth(view.y, view.m, 1))}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const p = parseKey(today);
              setView({ y: p.y, m: p.m });
              setSelected(today);
            }}
          >
            오늘
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setTtOpen(true)}>
            <GraduationCap aria-hidden /> 시간표 설정
          </Button>
          <Button variant="outline" onClick={() => setIcloudOpen(true)}>
            <Cloud aria-hidden /> iCloud {icloud?.state === "connected" ? "연결됨" : ""}{" "}
            <span className="text-xs text-muted-foreground">(시안)</span>
          </Button>
          <Button onClick={() => setEventDlg({ open: true, date: selected ?? today })}>
            <Plus aria-hidden /> 일정 추가
          </Button>
        </div>
      </div>

      {/* Legend / calendar sources */}
      <fieldset className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-y py-3 text-sm">
        <legend className="sr-only">표시할 캘린더</legend>
        {[
          {
            id: SCHOOL_ID,
            name: "학교 시간표",
            color: "school" as const,
            source: "school" as const,
            readOnly: true,
          },
          ...calendars,
        ].map((c) => (
          <label key={c.id} className="inline-flex min-h-9 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={!hidden.has(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span aria-hidden className={cn("size-2.5 rounded-full", colorClasses[c.color].dot)} />
            {c.name}
            <span className="text-muted-foreground">· {sourceLabel[c.source]}</span>
            {c.readOnly && (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                <Lock aria-hidden className="size-3" /> 읽기 전용
              </span>
            )}
          </label>
        ))}
      </fieldset>

      <p className="mt-3 text-sm text-muted-foreground">
        {coarse
          ? "날짜 칸을 탭하면 아래에 그날 일정이 표시됩니다."
          : "날짜를 더블클릭하면 종일 일정을 빠르게 추가합니다. 한 번 클릭하면 아래에 그날 일정이 표시됩니다."}
      </p>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Month grid */}
        <div aria-busy={isLoading}>
          <div
            className="grid grid-cols-7 border-b text-center text-sm text-muted-foreground"
            aria-hidden
          >
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={cn("py-2", i === 0 && "text-cal-holiday", i === 6 && "text-primary")}
              >
                {w}
              </span>
            ))}
          </div>
          <ul className="grid grid-cols-7 border-l" aria-label={`${view.y}년 ${view.m}월 달력`}>
            {grid.map(({ key, inMonth }) => {
              const evs = eventsByDate.get(key) ?? [];
              const cls = classesByDate.get(key) ?? [];
              const wd = weekday(key);
              const isToday = key === today;
              const isSel = key === selected;
              const total = evs.length + cls.length;
              return (
                <li
                  key={key}
                  className={cn(
                    "group relative min-h-20 border-b border-r p-1 sm:min-h-28 sm:p-1.5",
                    !inMonth && "bg-muted/60",
                    isSel && "bg-accent",
                  )}
                  onDoubleClick={() => !coarse && setQuickDate(key)}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(key)}
                    aria-label={`${formatKoDate(key)}${isToday ? ", 오늘" : ""}, 일정 ${total}개`}
                    aria-pressed={isSel}
                    className="absolute inset-0 size-full cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none relative inline-flex size-8 items-center justify-center rounded-md text-sm tabular group-hover:bg-accent",
                      !inMonth && "text-muted-foreground",
                      inMonth && wd === 0 && "text-cal-holiday",
                      inMonth && wd === 6 && "text-primary",
                      isToday &&
                        "bg-primary font-semibold text-primary-foreground group-hover:bg-primary",
                    )}
                  >
                    {parseKey(key).d}
                  </span>
                  <div className="pointer-events-none relative mt-0.5 hidden space-y-0.5 sm:block">
                    {cls.slice(0, 2).map((c) => (
                      <p
                        key={c.courseId}
                        className={cn("truncate rounded px-1 text-xs", colorClasses.school.chip)}
                      >
                        {c.start} {c.name}
                      </p>
                    ))}
                    {evs.slice(0, 3 - Math.min(cls.length, 2)).map((e) => {
                      const cal = calById.get(e.calendarId);
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setEventDlg({ open: true, event: e })}
                          onDoubleClick={(ev) => ev.stopPropagation()}
                          className={cn(
                            "pointer-events-auto block w-full truncate rounded px-1 text-left text-xs",
                            cal && colorClasses[cal.color].chip,
                          )}
                        >
                          {cal?.readOnly && (
                            <Lock aria-label="읽기 전용" className="mr-0.5 inline size-2.5" />
                          )}
                          {!e.allDay && `${e.start} `}
                          {e.title}
                        </button>
                      );
                    })}
                    {total > 3 && (
                      <p className="px-1 text-xs text-muted-foreground">+{total - 3}개</p>
                    )}
                  </div>
                  {/* Mobile: dots only */}
                  <div
                    className="pointer-events-none relative mt-1 flex gap-0.5 sm:hidden"
                    aria-hidden
                  >
                    {cls.length > 0 && <span className="size-1.5 rounded-full bg-cal-school" />}
                    {evs.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className={cn(
                          "size-1.5 rounded-full",
                          colorClasses[calById.get(e.calendarId)?.color ?? "personal"].dot,
                        )}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Selected day agenda */}
        <section aria-labelledby="day-title" className="lg:border-l lg:pl-6">
          <h2 id="day-title" className="text-lg font-bold">
            {selected ? formatKoDate(selected) : "날짜를 선택하세요"}
          </h2>
          {selected && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setQuickDate(selected)}
            >
              <Plus aria-hidden /> 이 날 종일 일정 빠르게 추가
            </Button>
          )}
          <ul className="mt-4 divide-y border-y">
            {selClasses.length + selEvents.length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">일정이 없습니다.</li>
            )}
            {selClasses.map((c) => (
              <li key={c.courseId} className="flex gap-3 py-3 text-sm">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-cal-school" />
                <span>
                  <span className="font-semibold">{c.name}</span>
                  <span className="block text-muted-foreground">
                    {c.start}–{c.end} · {c.room} · 학교 시간표
                  </span>
                </span>
              </li>
            ))}
            {selEvents.map((e) => {
              const cal = calById.get(e.calendarId);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setEventDlg({ open: true, event: e })}
                    className="flex w-full gap-3 py-3 text-left text-sm hover:bg-accent/60"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        cal && colorClasses[cal.color].dot,
                      )}
                    />
                    <span>
                      <span className="font-semibold">{e.title}</span>
                      <span className="block text-muted-foreground">
                        {e.allDay ? "종일" : `${e.start}–${e.end}`} · {cal?.name}
                        {cal?.readOnly && " · 읽기 전용"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <EventDialog
        open={eventDlg.open}
        onOpenChange={(o) => setEventDlg((d) => ({ ...d, open: o }))}
        calendars={calendars}
        event={eventDlg.event}
        defaults={eventDlg.date ? { date: eventDlg.date } : undefined}
      />
      <QuickAllDayDialog
        date={quickDate}
        onClose={() => setQuickDate(null)}
        calendars={calendars.filter((c) => !c.readOnly)}
      />
      <TimetableDialog open={ttOpen} onOpenChange={setTtOpen} timetable={timetable} />
      <ICloudDialog open={icloudOpen} onOpenChange={setIcloudOpen} />
    </div>
  );
}

function QuickAllDayDialog({
  date,
  onClose,
  calendars,
}: {
  date: string | null;
  onClose(): void;
  calendars: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const uid = useId();
  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (date) {
      setTitle("");
      setError(null);
      setCalendarId((c) => c || calendars[0]?.id || "");
    }
  }, [date, calendars]);

  const mut = useMutation({
    mutationFn: () => api.calendar.createEvent({ title, calendarId, date: date!, allDay: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "저장하지 못했습니다."),
  });

  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>종일 일정 빠르게 추가</DialogTitle>
          <DialogDescription>{date && formatKoDate(date)}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("제목을 입력하세요.");
            setError(null);
            mut.mutate();
          }}
          className="space-y-4"
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error} 입력한 내용은 유지됩니다.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-t`}>제목</Label>
            <Input
              id={`${uid}-t`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-c`}>캘린더</Label>
            <select
              id={`${uid}-c`}
              className={selectClass}
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "저장 중…" : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
