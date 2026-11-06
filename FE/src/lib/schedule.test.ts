import { describe, expect, it } from "vitest";
import type { Timetable } from "@/types/domain";
import { expandTimetable, isValidTimeRange } from "./schedule";
import { addDays, monthGrid, parseKey, seoulParts } from "./time";

const timetable: Timetable = {
  semesterStart: "2026-11-02",
  semesterEnd: "2026-11-13",
  courses: [
    {
      id: "os",
      name: "운영체제",
      room: "302",
      weekday: 5,
      start: "09:00",
      end: "10:30",
      cancelledDates: ["2026-11-13"],
    },
  ],
};

describe("서울 날짜와 학기별 수업", () => {
  it("다른 시간대에서도 서울의 자정 경계를 사용한다", () => {
    expect(seoulParts(new Date("2026-11-05T14:59:59Z"))).toMatchObject({
      dateKey: "2026-11-05",
      time: "23:59",
    });
    expect(seoulParts(new Date("2026-11-05T15:00:00Z"))).toMatchObject({
      dateKey: "2026-11-06",
      time: "00:00",
    });
  });

  it("학기 밖과 휴강일을 제외한다", () => {
    const classes = expandTimetable(timetable, "2026-10-30", "2026-11-20");
    expect(classes.map((c) => c.date)).toEqual(["2026-11-06"]);
    expect(expandTimetable(timetable, "2026-11-14", "2026-11-20")).toEqual([]);
  });

  it("윤년과 달력의 요일을 올바르게 계산한다", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(monthGrid(2026, 11)[0]?.key).toBe("2026-11-01");
    expect(monthGrid(2026, 11)[5]?.key).toBe("2026-11-06");
    expect(() => parseKey("2026-02-30")).toThrow(RangeError);
  });

  it("같거나 거꾸로 된 시간과 잘못된 시각을 거부한다", () => {
    expect(isValidTimeRange("09:00", "10:30")).toBe(true);
    for (const [start, end] of [
      ["09:00", "09:00"],
      ["10:00", "09:00"],
      ["23:00", "24:00"],
      ["09:00", "10:99"],
    ]) {
      expect(isValidTimeRange(start, end)).toBe(false);
    }
  });
});
