package kr.myworkspace;

import jakarta.persistence.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@Entity
@Table(name = "calendar_event")
class StoredEvent {
  @Id
  @Column(length = 64)
  String id;

  @Column(name = "event_date", nullable = false)
  LocalDate date;

  @Column(columnDefinition = "longtext", nullable = false)
  String payload;

  protected StoredEvent() {}

  StoredEvent(String id, LocalDate date, String payload) {
    this.id = id;
    this.date = date;
    this.payload = payload;
  }
}

interface EventRepository extends JpaRepository<StoredEvent, String> {
  List<StoredEvent> findByDateBetweenOrderByDateAsc(LocalDate from, LocalDate to);
}

record CalendarInfo(String id, String name, String source, String color, boolean readOnly) {}

record EventInput(
    @NotBlank @Size(max = 64) String calendarId,
    @NotBlank @Size(max = 200) String title,
    @NotNull LocalDate date,
    boolean allDay,
    String start,
    String end,
    @Size(max = 200) String location,
    @Size(max = 10000) String memo) {}

record Course(
    @NotBlank @Size(max = 64) String id,
    @NotBlank @Size(max = 100) String name,
    @Size(max = 100) String room,
    @Size(max = 100) String professor,
    @Min(0) @Max(6) int weekday,
    @NotBlank String start,
    @NotBlank String end,
    @NotNull @Size(max = 400) List<@NotNull LocalDate> cancelledDates) {}

record Timetable(
    @NotNull LocalDate semesterStart,
    @NotNull LocalDate semesterEnd,
    @NotNull @Size(max = 100) List<@Valid Course> courses) {}

@Service
class ScheduleService {
  final Documents docs;
  final EventRepository events;
  final Holidays holidays;

  ScheduleService(Documents docs, EventRepository events, Holidays holidays) {
    this.docs = docs;
    this.events = events;
    this.holidays = holidays;
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
    Map<String, Object> result = new LinkedHashMap<>(docs.json.readValue(event.payload, Map.class));
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
    return result;
  }

  @Transactional
  Map<String, Object> save(String id, EventInput input) {
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
                docs.json.writeValueAsString(clean))));
  }

  @Transactional
  void delete(String id) {
    if (!events.existsById(id)) throw new ApiException(404, "NOT_FOUND", "일정을 찾을 수 없습니다.");
    events.deleteById(id);
  }

  Timetable timetable() {
    return docs.read("timetable", Timetable.class);
  }

  boolean hasEvents() {
    return events.count() > 0;
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
    for (int i = 0; i < table.courses().size(); i++) {
      Course c = table.courses().get(i);
      timeRange(c.start(), c.end());
      ApiException.require(ids.add(c.id()), "수업 식별자가 중복됩니다.");
      ApiException.require(
          c.cancelledDates().stream()
              .allMatch(d -> !d.isBefore(table.semesterStart()) && !d.isAfter(table.semesterEnd())),
          "휴강일은 학기 기간 안에 지정하세요.");
      for (Course other : table.courses().subList(0, i))
        ApiException.require(
            other.weekday() != c.weekday()
                || c.start().compareTo(other.end()) >= 0
                || other.start().compareTo(c.end()) >= 0,
            "같은 요일의 수업 시간이 겹칩니다.");
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
              "cal-holiday".equals(event.get("calendarId")) ? HOLIDAY : PERSONAL));
    Timetable t = timetable();
    if (!date.isBefore(t.semesterStart()) && !date.isAfter(t.semesterEnd()))
      for (Course c : t.courses())
        if (c.weekday() == date.getDayOfWeek().getValue() % 7 && !c.cancelledDates().contains(date))
          result.add(
              Map.of(
                  "kind",
                  "class",
                  "id",
                  c.id() + "-" + date,
                  "title",
                  c.name(),
                  "start",
                  c.start(),
                  "end",
                  c.end(),
                  "room",
                  c.room() == null ? "" : c.room()));
    result.sort(
        Comparator.comparing(
            i ->
                "class".equals(i.get("kind"))
                    ? (String) i.get("start")
                    : Objects.toString(((Map<?, ?>) i.get("event")).get("start"), "00:00")));
    return result;
  }
}

@RestController
class ScheduleController {
  final ScheduleService service;

  ScheduleController(ScheduleService service) {
    this.service = service;
  }

  @GetMapping("/api/health")
  Object health() {
    return Map.of("status", "ok");
  }

  @GetMapping("/api/calendar/calendars")
  Object calendars() {
    return List.of(ScheduleService.PERSONAL, ScheduleService.HOLIDAY);
  }

  @GetMapping("/api/calendar/icloud/status")
  Object cloud() {
    Map<String, Object> result =
        new LinkedHashMap<>(Map.of("mode", "live", "state", "disconnected"));
    result.put("lastSyncedAt", null);
    return result;
  }

  @GetMapping("/api/calendar/events")
  Object events(@RequestParam LocalDate from, @RequestParam LocalDate to) {
    return service.list(from, to);
  }

  @GetMapping("/api/calendar/holidays/status")
  Object holidays(@RequestParam LocalDate from, @RequestParam LocalDate to) {
    return service.holidayStatus(from, to);
  }

  @PostMapping("/api/calendar/events")
  Object create(@Valid @RequestBody EventInput input) {
    return service.save(null, input);
  }

  @PutMapping("/api/calendar/events/{id}")
  Object update(@PathVariable String id, @Valid @RequestBody EventInput input) {
    return service.save(id, input);
  }

  @DeleteMapping("/api/calendar/events/{id}")
  void delete(@PathVariable String id) {
    service.delete(id);
  }

  @GetMapping("/api/timetable")
  Object timetable() {
    return service.timetable();
  }

  @PutMapping("/api/timetable")
  Object timetable(@Valid @RequestBody Timetable input) {
    return service.saveTimetable(input);
  }

  @GetMapping("/api/today")
  Object today(@RequestParam LocalDate date) {
    return service.today(date);
  }
}
