package kr.myworkspace.calendar.event;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import kr.myworkspace.calendar.holiday.HolidayService;
import kr.myworkspace.calendar.icloud.ICloudService;
import kr.myworkspace.calendar.timetable.Course;
import kr.myworkspace.calendar.timetable.CourseTime;
import kr.myworkspace.calendar.timetable.Timetable;
import kr.myworkspace.calendar.timetable.TimetableService;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;

@Service
class ScheduleService {
  final LocalEventStore events;
  final TimetableService timetables;
  final HolidayService holidays;
  final ICloudService cloud;

  ScheduleService(
      LocalEventStore events,
      TimetableService timetables,
      HolidayService holidays,
      ICloudService cloud) {
    this.events = events;
    this.timetables = timetables;
    this.holidays = holidays;
    this.cloud = cloud;
  }

  static final CalendarInfo PERSONAL =
      new CalendarInfo("cal-icloud", "내 일정", "icloud", "icloud", false);
  static final CalendarInfo HOLIDAY =
      new CalendarInfo("cal-holiday", "공휴일", "holiday", "holiday", true);

  static void timeRange(String start, String end) {
    ApiException.require(
        start != null
            && end != null
            && start.matches("\\d{2}:\\d{2}")
            && end.matches("\\d{2}:\\d{2}"),
        "시작·종료 시간을 확인하세요.");
    ApiException.require(
        LocalTime.parse(start).isBefore(LocalTime.parse(end)), "종료 시간은 시작 시간보다 늦어야 합니다.");
  }

  List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    ApiException.require(
        !to.isBefore(from) && !to.isAfter(from.plusDays(370)), "조회 기간은 371일 이내로 지정하세요.");
    ApiException.require(
        from.getYear() >= 2000 && to.getYear() <= 2100, "2000년부터 2100년까지 조회할 수 있습니다.");
    List<Map<String, Object>> result = new ArrayList<>(events.list(from, to));
    result.addAll(holidays.between(from, to));
    result.addAll(cloud.list(from, to));
    return result;
  }

  Map<String, Object> save(String id, EventInput input) {
    if (!input.allDay()) timeRange(input.start(), input.end());
    if ("cal-remote".equals(input.calendarId())) return cloud.save(id, input);
    ApiException.require(PERSONAL.id().equals(input.calendarId()), "이 캘린더에는 저장할 수 없습니다.");
    return events.save(id, input);
  }

  void delete(String id, String revision) {
    if (id.startsWith("icloud-")) cloud.delete(id, revision);
    else events.delete(id, revision);
  }

  Timetable timetable() {
    return timetables.read();
  }

  Timetable saveTimetable(Timetable table) {
    return timetables.save(table);
  }

  boolean hasEvents() {
    return events.count() > 0;
  }

  CalendarInfo cloudCalendar() {
    return cloud.calendar();
  }

  Object holidayStatus(LocalDate from, LocalDate to) {
    return holidays.status(from, to);
  }

  List<Map<String, Object>> today(LocalDate date) {
    List<Map<String, Object>> result = new ArrayList<>();
    for (Map<String, Object> event : list(date, date))
      result.add(
          Map.of(
              "kind",
              "event",
              "id",
              event.get("id"),
              "event",
              event,
              "calendar",
              "cal-holiday".equals(event.get("calendarId"))
                  ? HOLIDAY
                  : "cal-remote".equals(event.get("calendarId"))
                      ? Objects.requireNonNullElse(
                          cloud.calendar(),
                          new CalendarInfo("cal-remote", "iCloud", "icloud", "icloud", true))
                      : PERSONAL));
    Timetable t = timetable();
    if (!date.isBefore(t.semesterStart()) && !date.isAfter(t.semesterEnd()))
      for (Course c : t.courses())
        for (CourseTime time : c.times())
          if (time.weekday() == date.getDayOfWeek().getValue() % 7
              && !time.cancelledDates().contains(date))
            result.add(
                Map.of(
                    "kind",
                    "class",
                    "id",
                    c.id() + "-" + time.id() + "-" + date,
                    "title",
                    c.name(),
                    "start",
                    time.start(),
                    "end",
                    time.end(),
                    "room",
                    time.room() == null ? "" : time.room()));
    result.sort(
        Comparator.comparing(
            i ->
                "class".equals(i.get("kind"))
                    ? (String) i.get("start")
                    : Objects.toString(((Map<?, ?>) i.get("event")).get("start"), "00:00")));
    return result;
  }
}
