package kr.myworkspace.calendar.event;

import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import kr.myworkspace.calendar.timetable.Timetable;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ScheduleController {
  final ScheduleService service;

  ScheduleController(ScheduleService service) {
    this.service = service;
  }

  @GetMapping("/api/calendar/calendars")
  Object calendars() {
    List<CalendarInfo> result = new ArrayList<>();
    var calendar = service.cloudCalendar();
    if (calendar != null) result.add(calendar);
    if (calendar == null || service.hasEvents()) result.add(ScheduleService.PERSONAL);
    result.add(ScheduleService.HOLIDAY);
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
  void delete(
      @PathVariable String id,
      @RequestHeader(value = "If-Match", required = false) String revision) {
    service.delete(id, revision);
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
