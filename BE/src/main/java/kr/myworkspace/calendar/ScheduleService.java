package kr.myworkspace.calendar;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
class ScheduleService {
  final DocumentStore docs;
  final JsonMapper json;
  final EventRepository events;
  final HolidayService holidays;
  final ICloudService cloud;

  ScheduleService(
      DocumentStore docs,
      JsonMapper json,
      EventRepository events,
      HolidayService holidays,
      ICloudService cloud) {
    this.docs = docs;
    this.json = json;
    this.events = events;
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

  Map<String, Object> eventValue(StoredEvent event) {
    Map<String, Object> result = new LinkedHashMap<>(json.readValue(event.payload, Map.class));
    result.put("id", event.id);
    return result;
  }

  List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    ApiException.require(
        !to.isBefore(from) && !to.isAfter(from.plusDays(370)), "조회 기간은 371일 이내로 지정하세요.");
    ApiException.require(
        from.getYear() >= 2000 && to.getYear() <= 2100, "2000년부터 2100년까지 조회할 수 있습니다.");
    List<Map<String, Object>> result =
        new ArrayList<>(
            events.findByDateBetweenOrderByDateAsc(from, to).stream()
                .map(this::eventValue)
                .toList());
    result.addAll(holidays.between(from, to));
    result.addAll(cloud.list(from, to));
    return result;
  }

  @Transactional
  Map<String, Object> save(String id, EventInput input) {
    if ("cal-remote".equals(input.calendarId())) {
      if (!input.allDay()) timeRange(input.start(), input.end());
      return cloud.save(id, input);
    }
    ApiException.require(PERSONAL.id().equals(input.calendarId()), "이 캘린더에는 저장할 수 없습니다.");
    if (!input.allDay()) timeRange(input.start(), input.end());
    ApiException.require(
        !input.date().isBefore(LocalDate.of(2000, 1, 1))
            && !input.date().isAfter(LocalDate.of(2100, 12, 31)),
        "날짜를 확인하세요.");
    if (id != null && !events.existsById(id))
      throw new ApiException(404, "NOT_FOUND", "일정을 찾을 수 없습니다.");
    EventInput clean =
        new EventInput(
            input.calendarId(),
            input.title().trim(),
            input.date(),
            input.allDay(),
            input.allDay() ? null : input.start(),
            input.allDay() ? null : input.end(),
            input.location(),
            input.memo());
    return eventValue(
        events.save(
            new StoredEvent(
                id == null ? UUID.randomUUID().toString() : id,
                input.date(),
                json.writeValueAsString(clean))));
  }

  @Transactional
  void delete(String id) {
    delete(id, null);
  }

  void delete(String id, String revision) {
    if (id.startsWith("icloud-")) {
      cloud.delete(id, revision);
      return;
    }
    if (!events.existsById(id)) throw new ApiException(404, "NOT_FOUND", "일정을 찾을 수 없습니다.");
    events.deleteById(id);
  }

  Timetable timetable() {
    return docs.read("timetable", Timetable.class);
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

  @Transactional
  Timetable saveTimetable(Timetable table) {
    ApiException.require(
        !table.semesterEnd().isBefore(table.semesterStart())
            && !table.semesterEnd().isAfter(table.semesterStart().plusYears(1)),
        "학기 기간을 확인하세요.");
    Set<String> ids = new HashSet<>();
    List<CourseTime> previous = new ArrayList<>();
    for (Course c : table.courses()) {
      ApiException.require(ids.add(c.id()), "수업 식별자가 중복됩니다.");
      Set<String> timeIds = new HashSet<>();
      for (var time : c.times()) {
        ApiException.require(timeIds.add(time.id()), "수업 시간 식별자가 중복됩니다.");
        timeRange(time.start(), time.end());
        ApiException.require(
            time.cancelledDates().stream()
                .allMatch(
                    d -> !d.isBefore(table.semesterStart()) && !d.isAfter(table.semesterEnd())),
            "휴강일은 학기 기간 안에 지정하세요.");
        for (CourseTime other : previous)
          ApiException.require(
              other.weekday() != time.weekday()
                  || time.start().compareTo(other.end()) >= 0
                  || other.start().compareTo(time.end()) >= 0,
              "같은 요일의 수업 시간이 겹칩니다.");
        previous.add(time);
      }
    }
    docs.write(docs.lock("timetable"), table);
    return table;
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
