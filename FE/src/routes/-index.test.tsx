import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { MiniCalendar } from "@/components/MiniCalendar";
import { Route } from "./index";

const Page = Route.options.component as ComponentType;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("학교 수업은 목록에 유지하면서 미니 달력 점에서 제외하고 공휴일은 빨갛게 표시한다", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  vi.spyOn(api.today, "get").mockResolvedValue([
    { kind: "class", id: "class", title: "테스트 수업", start: "09:00", end: "10:00", room: "101" },
  ]);
  vi.spyOn(api.timetable, "get").mockResolvedValue({
    semesterStart: "2026-09-01",
    semesterEnd: "2026-12-31",
    courses: [
      {
        id: "class",
        name: "테스트 수업",
        room: "101",
        weekday: 1,
        start: "09:00",
        end: "10:00",
        cancelledDates: [],
      },
    ],
  });
  vi.spyOn(api.calendar, "listCalendars").mockResolvedValue([
    { id: "personal", name: "iCloud", source: "icloud", color: "icloud", readOnly: false },
    { id: "holiday", name: "공휴일", source: "holiday", color: "holiday", readOnly: true },
  ]);
  vi.spyOn(api.calendar, "listEvents").mockResolvedValue([
    { id: "event", calendarId: "personal", title: "개인 일정", date: "2026-10-06", allDay: true },
    { id: "holiday-fri", calendarId: "holiday", title: "공휴일", date: "2026-10-09", allDay: true },
    {
      id: "holiday-sat",
      calendarId: "holiday",
      title: "공휴일 예시",
      date: "2026-10-10",
      allDay: true,
    },
  ]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
  await act(async () => vi.advanceTimersByTimeAsync(1));
  const day = (date: string) => screen.getByRole("button", { name: new RegExp(date) });
  expect(day("10월 5일").querySelector("span")).toBeNull();
  expect(day("10월 12일").querySelector("span")).toBeNull();
  expect(day("10월 6일").querySelector("span")).not.toBeNull();
  expect(screen.getAllByText("테스트 수업")).toHaveLength(2);
  for (const date of ["10월 4일", "10월 9일", "10월 10일"]) {
    expect(day(date)).toHaveClass("text-cal-holiday");
  }
  expect(day("10월 10일")).not.toHaveClass("text-primary");
  fireEvent.click(day("10월 9일"));
  expect(day("10월 9일")).toHaveAttribute("aria-pressed", "true");
  expect(day("10월 9일")).toHaveClass("text-cal-holiday");
});

it("오늘인 공휴일도 빨간 숫자와 읽기 쉬운 배경을 유지한다", () => {
  render(
    <MiniCalendar
      today="2026-10-09"
      selected="2026-10-09"
      view={{ y: 2026, m: 10 }}
      markedDates={new Set(["2026-10-09"])}
      holidayDates={new Set(["2026-10-09"])}
      onSelect={vi.fn()}
      onViewChange={vi.fn()}
    />,
  );
  const holiday = screen.getByRole("button", { name: /10월 9일.*공휴일/ });
  expect(holiday).toHaveClass("text-cal-holiday", "bg-cal-holiday-soft");
  expect(holiday).not.toHaveClass("text-primary-foreground");
  expect(holiday).toHaveAttribute("aria-current", "date");
});
