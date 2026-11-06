import type { Course, Timetable } from "@/types/domain";
import { isValidTimeRange } from "./schedule";
import { parseKey, toMinutes, WEEKDAYS } from "./time";

export function timetableDays(courses: Course[]) {
  return courses.some((c) => c.weekday === 0 || c.weekday === 6)
    ? [1, 2, 3, 4, 5, 6, 0]
    : [1, 2, 3, 4, 5];
}

export function timetableRange(courses: Course[]) {
  const valid = courses.filter((c) => isValidTimeRange(c.start, c.end));
  return {
    start: Math.min(9 * 60, ...valid.map((c) => Math.floor(toMinutes(c.start) / 60) * 60)),
    end: Math.max(20 * 60, ...valid.map((c) => Math.ceil(toMinutes(c.end) / 60) * 60)),
  };
}

export function timetableTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function courseAt(courses: Course[], weekday: number, minutes: number) {
  return courses.find(
    (c) => c.weekday === weekday && toMinutes(c.start) <= minutes && minutes < toMinutes(c.end),
  );
}

export function validateTimetable(t: Timetable): { message: string; courseId?: string } | null {
  try {
    parseKey(t.semesterStart);
    parseKey(t.semesterEnd);
  } catch {
    return { message: "학기 시작일과 종료일을 올바르게 입력하세요." };
  }
  if (t.semesterEnd < t.semesterStart) return { message: "학기 종료일이 시작일보다 빠릅니다." };
  for (const [index, c] of t.courses.entries()) {
    if (!c.name.trim()) return { courseId: c.id, message: "과목명을 입력하세요." };
    if (!Number.isInteger(c.weekday) || c.weekday < 0 || c.weekday > 6)
      return { courseId: c.id, message: `${c.name}: 요일을 확인하세요.` };
    if (!isValidTimeRange(c.start, c.end))
      return { courseId: c.id, message: `${c.name}: 종료 시간은 시작 시간보다 늦어야 합니다.` };
    const conflict = t.courses
      .slice(0, index)
      .find(
        (other) =>
          other.weekday === c.weekday &&
          toMinutes(c.start) < toMinutes(other.end) &&
          toMinutes(other.start) < toMinutes(c.end),
      );
    if (conflict)
      return {
        courseId: c.id,
        message: `${WEEKDAYS[c.weekday]}요일 '${c.name}'과 '${conflict.name}'의 수업 시간이 겹칩니다.`,
      };
  }
  return null;
}
