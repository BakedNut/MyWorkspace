import type { ClassOccurrence, Course, DateKey, Timetable } from "@/types/domain";
import { addDays, toMinutes, weekday } from "./time";

export function courseTimes(course: Course) {
  return [
    {
      id: "primary",
      weekday: course.weekday,
      start: course.start,
      end: course.end,
      room: course.room,
      cancelledDates: course.cancelledDates,
    },
    ...(course.additionalTimes ?? []).map((time) => ({
      ...time,
      room: time.room || course.room,
      cancelledDates: time.cancelledDates ?? [],
    })),
  ];
}

export function courseBlocks(courses: Course[]) {
  return courses.flatMap((course) =>
    courseTimes(course).map((time) => ({ ...course, ...time, id: course.id, meetingId: time.id })),
  );
}

/** Expand the weekly timetable into dated classes, skipping dates outside the semester and 휴강일. */
export function expandTimetable(t: Timetable, from: DateKey, to: DateKey): ClassOccurrence[] {
  const out: ClassOccurrence[] = [];
  let d = from < t.semesterStart ? t.semesterStart : from;
  const end = to > t.semesterEnd ? t.semesterEnd : to;
  while (d <= end) {
    const wd = weekday(d);
    for (const c of courseBlocks(t.courses)) {
      if (c.weekday === wd && !c.cancelledDates.includes(d)) {
        out.push({
          courseId: c.id,
          name: c.name,
          room: c.room,
          date: d,
          start: c.start,
          end: c.end,
        });
      }
    }
    d = addDays(d, 1);
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function isValidTimeRange(start?: string, end?: string) {
  if (!start || !end) return false;
  return toMinutes(end) > toMinutes(start);
}
