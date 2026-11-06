import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, mockControls } from "./mockApi";
import { load } from "./storage";
import type { CalendarEvent } from "@/types/domain";
import { todayKey } from "@/lib/time";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T05:32:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("디자인 시안의 데이터 변경", () => {
  it("등록하지 않은 PC는 깨울 수 없다", async () => {
    const check = expect(mockApi.wol.wake("my-pc")).rejects.toMatchObject({ code: "VALIDATION" });
    await vi.runAllTimersAsync();
    await check;
  });

  it("MAC 변경은 저장하고 짧은 간격의 중복 요청은 거부한다", async () => {
    const update = mockApi.wol.updateMac("my-pc", "3c7c3f12abcd");
    await vi.runAllTimersAsync();
    expect((await update).mac).toBe("3C:7C:3F:12:AB:CD");
    const wake = mockApi.wol.wake("my-pc");
    await vi.runAllTimersAsync();
    expect(await wake).toHaveProperty("sentAt");
    const repeat = expect(mockApi.wol.wake("my-pc")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await vi.runAllTimersAsync();
    await repeat;
  });

  it("저장 실패 시 기존 일정은 바꾸지 않는다", async () => {
    const list = mockApi.calendar.listEvents({ from: todayKey(), to: todayKey() });
    await vi.runAllTimersAsync();
    await list;
    const before = load<CalendarEvent[]>("events", () => []);
    mockControls.set({ simulateSaveFailure: true });
    const failed = expect(
      mockApi.calendar.createEvent({
        calendarId: "cal-icloud",
        title: "새 일정",
        date: todayKey(),
        allDay: true,
      }),
    ).rejects.toMatchObject({ code: "NETWORK" });
    await vi.runAllTimersAsync();
    await failed;
    expect(load("events", () => [])).toEqual(before);
  });
});
