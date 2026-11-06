import { describe, expect, it } from "vitest";
import type { Course, Timetable } from "@/types/domain";
import {
  courseAt,
  timetableDays,
  timetableRange,
  timetableTime,
  validateTimetable,
  groupExistingCourses,
} from "./timetable";

const course: Course = {
  id: "a",
  name: "과정지도",
  room: "6201",
  weekday: 1,
  start: "18:25",
  end: "19:15",
  cancelledDates: [],
};
const form = (courses: Course[]): Timetable => ({
  semesterStart: "2026-09-01",
  semesterEnd: "2026-12-20",
  courses,
});

describe("표 형태 시간표", () => {
  it("같은 과목의 나뉜 시간을 묶고 각 시간의 휴강일을 보존한다", () => {
    const courses = [course, { ...course, id: "wed", weekday: 3, cancelledDates: ["2026-11-11"] }];
    const grouped = groupExistingCourses(courses);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.additionalTimes?.[0]).toMatchObject({
      id: "wed",
      weekday: 3,
      start: "18:25",
      cancelledDates: ["2026-11-11"],
    });
    expect(courses[0]).not.toHaveProperty("additionalTimes");
    expect(validateTimetable(form(grouped))).toBeNull();
    expect(
      validateTimetable(
        form([
          {
            ...course,
            additionalTimes: [{ id: "overlap", weekday: 1, start: "18:30", end: "19:00" }],
          },
        ]),
      ),
    ).toMatchObject({ courseId: "a" });
  });
  it("분 단위 시각과 수업 종료 경계를 유지한다", () => {
    expect(timetableTime(18 * 60 + 25)).toBe("18:25");
    expect(courseAt([course], 1, 18 * 60 + 25)?.id).toBe("a");
    expect(courseAt([course], 1, 19 * 60 + 15)).toBeUndefined();
    expect(validateTimetable(form([course]))).toBeNull();
  });

  it("기본 표 밖의 수업과 주말도 숨기지 않는다", () => {
    const early = { ...course, weekday: 0, start: "07:25", end: "08:15" };
    const late = { ...course, id: "b", weekday: 6, start: "21:00", end: "23:15" };
    expect(timetableDays([])).toEqual([1, 2, 3, 4, 5]);
    expect(timetableDays([early])).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(timetableRange([early, late])).toEqual({ start: 420, end: 1440 });
    expect(timetableRange([{ ...course, start: "", end: "" }])).toEqual({ start: 540, end: 1200 });
  });

  it("이어지는 수업은 허용하고 같은 요일의 중복 시간은 거부한다", () => {
    expect(
      validateTimetable(form([course, { ...course, id: "b", start: "19:15", end: "20:00" }])),
    ).toBeNull();
    expect(
      validateTimetable(form([course, { ...course, id: "b", start: "19:00", end: "20:00" }])),
    ).toMatchObject({ courseId: "b" });
    expect(validateTimetable(form([course, { ...course, id: "b", weekday: 2 }]))).toBeNull();
  });

  it("학기·요일·수업 이름과 시간을 검증한다", () => {
    expect(validateTimetable({ ...form([]), semesterStart: "2026-02-30" })).not.toBeNull();
    expect(validateTimetable({ ...form([]), semesterEnd: "2026-01-01" })).not.toBeNull();
    for (const patch of [{ name: " " }, { weekday: 7 }, { start: "19:30", end: "18:00" }]) {
      expect(validateTimetable(form([{ ...course, ...patch }]))).toMatchObject({ courseId: "a" });
    }
  });
});
