import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, mockControls } from "./mockApi";
import { load, save } from "./storage";
import { seedCalendars } from "./seed";
import type { CalendarEvent } from "@/types/domain";
import { todayKey } from "@/lib/time";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T05:32:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("디자인 시안의 데이터 변경", () => {
  it("WOL 목록 추가·수정·삭제는 한 번에 저장하고 실패 시 이전 목록을 유지한다", async () => {
    const old = [{ id: "my-pc", name: "내 PC", mac: "3C:7C:3F:12:AB:CD" }];
    save("wol", old);
    mockControls.set({ simulateSaveFailure: true });
    const failed = expect(mockApi.wol.saveDevices([])).rejects.toMatchObject({ code: "NETWORK" });
    await vi.runAllTimersAsync();
    await failed;
    expect(load("wol", () => [])).toEqual(old);
    mockControls.set({ simulateSaveFailure: false });
    const next = [{ id: "new-pc", name: " 새 PC ", mac: "3c7c3f12abce" }];
    const saved = mockApi.wol.saveDevices(next);
    await vi.runAllTimersAsync();
    expect(await saved).toEqual([{ ...next[0], name: "새 PC", mac: "3C:7C:3F:12:AB:CE" }]);
    const missing = expect(mockApi.wol.wake("my-pc")).rejects.toMatchObject({ code: "VALIDATION" });
    await vi.runAllTimersAsync();
    await missing;
  });
  it("로컬 분류를 없애도 기존 일정의 내용과 편집은 유지한다", async () => {
    save("calendars", [
      ...seedCalendars(),
      { id: "cal-local", name: "내 일정", source: "local", color: "personal", readOnly: false },
    ]);
    const old: CalendarEvent = {
      id: "legacy",
      calendarId: "cal-local",
      title: "보존할 일정",
      date: todayKey(),
      allDay: true,
      location: "집",
      memo: "기존 메모",
    };
    save("events", [old]);
    const calendars = mockApi.calendar.listCalendars();
    const events = mockApi.calendar.listEvents({ from: todayKey(), to: todayKey() });
    await vi.runAllTimersAsync();
    expect((await calendars).some((c) => c.source === "local")).toBe(false);
    expect(await events).toEqual([{ ...old, calendarId: "cal-icloud" }]);
    const { id, ...input } = (await events)[0]!;
    const update = mockApi.calendar.updateEvent(id, { ...input, title: "수정한 일정" });
    await vi.runAllTimersAsync();
    await update;
    expect(load("events", () => [])).toEqual([
      { ...old, calendarId: "cal-icloud", title: "수정한 일정" },
    ]);
  });

  it("항상 표시하는 공휴일도 수정·삭제는 허용하지 않는다", async () => {
    save("events", [
      { id: "holiday", calendarId: "cal-holiday", title: "공휴일", date: todayKey(), allDay: true },
    ]);
    const update = expect(
      mockApi.calendar.updateEvent("holiday", {
        calendarId: "cal-icloud",
        title: "변경",
        date: todayKey(),
        allDay: true,
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    const remove = expect(mockApi.calendar.deleteEvent("holiday")).rejects.toMatchObject({
      code: "READ_ONLY",
    });
    await vi.runAllTimersAsync();
    await Promise.all([update, remove]);
    expect(load<CalendarEvent[]>("events", () => [])[0]?.title).toBe("공휴일");
  });

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
