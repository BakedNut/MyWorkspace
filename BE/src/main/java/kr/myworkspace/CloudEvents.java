package kr.myworkspace;

import java.io.StringReader;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.Temporal;
import java.util.*;
import net.fortuna.ical4j.data.CalendarBuilder;
import net.fortuna.ical4j.model.*;
import net.fortuna.ical4j.model.component.VEvent;
import net.fortuna.ical4j.model.property.*;

class CloudEvents {
  static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

  static net.fortuna.ical4j.model.Calendar parse(String text) {
    try {
      return new CalendarBuilder().build(new StringReader(text));
    } catch (Exception e) {
      throw new ApiException(503, "NETWORK", "iCloud 일정 형식을 읽지 못했습니다.");
    }
  }

  static String value(VEvent event, String name) {
    return event.getProperty(name).map(Property::getValue).orElse("");
  }

  static LocalDateTime local(Temporal value) {
    if (value instanceof ZonedDateTime t) return t.withZoneSameInstant(SEOUL).toLocalDateTime();
    if (value instanceof OffsetDateTime t) return t.atZoneSameInstant(SEOUL).toLocalDateTime();
    if (value instanceof Instant t) return LocalDateTime.ofInstant(t, SEOUL);
    if (value instanceof LocalDate t) return t.atStartOfDay();
    return LocalDateTime.from(value);
  }

  static List<Map<String, Object>> expand(
      CloudResource resource, LocalDate from, LocalDate to, boolean calendarReadOnly) {
    try {
      return expandChecked(resource, from, to, calendarReadOnly);
    } catch (ApiException e) {
      throw e;
    } catch (RuntimeException e) {
      throw new ApiException(503, "NETWORK", "일부 iCloud 일정 형식을 읽지 못했습니다. Apple 캘린더에서 확인하세요.");
    }
  }

  static List<Map<String, Object>> expandChecked(
      CloudResource resource, LocalDate from, LocalDate to, boolean calendarReadOnly) {
    var calendar = parse(resource.content());
    List<Map<String, Object>> result = new ArrayList<>();
    for (var component : calendar.getComponents("VEVENT")) {
      VEvent event = (VEvent) component;
      if ("CANCELLED".equals(value(event, "STATUS"))) continue;
      Temporal start = event.getStartDate().orElseThrow().getDate();
      Temporal end =
          event
              .getEndDate()
              .map(DateProperty::getDate)
              .orElse(start instanceof LocalDate d ? d.plusDays(1) : local(start).plusHours(1));
      LocalDateTime first = local(start), last = local(end);
      boolean allDay = start instanceof LocalDate;
      LocalDate lastDate =
          allDay || last.toLocalTime().equals(LocalTime.MIDNIGHT)
              ? last.toLocalDate().minusDays(1)
              : last.toLocalDate();
      if (lastDate.isBefore(first.toLocalDate())) lastDate = first.toLocalDate();
      boolean recurring =
          event.getProperty("RRULE").isPresent()
              || event.getProperty("RECURRENCE-ID").isPresent()
              || event.getProperty("RDATE").isPresent();
      boolean multipleDays =
          allDay
              ? !lastDate.equals(first.toLocalDate())
              : !last.toLocalDate().equals(first.toLocalDate());
      boolean readOnly =
          calendarReadOnly
              || recurring
              || multipleDays
              || !event.getProperties("ATTENDEE").isEmpty()
              || event.getProperty("ORGANIZER").isPresent();
      LocalDate date = first.toLocalDate().isBefore(from) ? from : first.toLocalDate();
      for (; !date.isAfter(lastDate) && !date.isAfter(to); date = date.plusDays(1)) {
        if (result.size() > 5000)
          throw new ApiException(400, "VALIDATION", "조회 기간의 일정이 너무 많습니다. 기간을 줄여주세요.");
        Map<String, Object> item = new LinkedHashMap<>();
        String source = CalDav.id(resource.href()),
            slot =
                CalDav.id(value(event, "RECURRENCE-ID") + ":" + first + ":" + date)
                    .substring(0, 12);
        item.put("id", "icloud-" + source + "-" + slot);
        item.put("calendarId", "cal-remote");
        item.put("title", value(event, "SUMMARY").isBlank() ? "제목 없음" : value(event, "SUMMARY"));
        item.put("date", date.toString());
        item.put("allDay", allDay);
        if (!allDay) {
          item.put(
              "start",
              date.equals(first.toLocalDate())
                  ? first.format(DateTimeFormatter.ofPattern("HH:mm"))
                  : "00:00");
          item.put(
              "end",
              date.equals(last.toLocalDate())
                  ? last.format(DateTimeFormatter.ofPattern("HH:mm"))
                  : "23:59");
        }
        item.put("location", value(event, "LOCATION"));
        item.put("memo", value(event, "DESCRIPTION"));
        item.put("revision", resource.etag());
        item.put("readOnly", readOnly);
        item.put("recurring", recurring);
        result.add(item);
      }
    }
    return result;
  }

  static void remove(VEvent event, String name) {
    for (Property p : new ArrayList<Property>(event.<Property>getProperties(name))) event.remove(p);
  }

  static String write(EventInput input, String original) {
    var calendar = original == null ? new net.fortuna.ical4j.model.Calendar() : parse(original);
    VEvent event;
    if (original == null) {
      calendar.add(new ProdId("-//MyWorkspace//iCloud calendar//KO"));
      calendar.add(new Version((String) null, "2.0"));
      event = new VEvent();
      event.add(new Uid(UUID.randomUUID() + "@myworkspace"));
      calendar.add(event);
    } else {
      var components = calendar.getComponents("VEVENT");
      ApiException.require(components.size() == 1, "이 일정은 Apple 캘린더에서 수정하세요.");
      event = (VEvent) components.getFirst();
      ApiException.require(
          event.getProperty("RRULE").isEmpty()
              && event.getProperty("RECURRENCE-ID").isEmpty()
              && event.getProperty("RDATE").isEmpty()
              && event.getProperty("ORGANIZER").isEmpty()
              && event.getProperties("ATTENDEE").isEmpty(),
          "반복 일정과 초대 일정은 Apple 캘린더에서 수정하세요.");
    }
    int sequence = 0;
    try {
      sequence = Integer.parseInt(value(event, "SEQUENCE"));
    } catch (NumberFormatException ignored) {
    }
    for (String name :
        List.of(
            "DTSTART",
            "DTEND",
            "DURATION",
            "SUMMARY",
            "LOCATION",
            "DESCRIPTION",
            "DTSTAMP",
            "LAST-MODIFIED",
            "SEQUENCE")) remove(event, name);
    if (input.allDay()) {
      event.add(new DtStart<>(input.date()));
      event.add(new DtEnd<>(input.date().plusDays(1)));
    } else {
      event.add(
          new DtStart<>(
              input.date().atTime(LocalTime.parse(input.start())).atZone(SEOUL).toInstant()));
      event.add(
          new DtEnd<>(input.date().atTime(LocalTime.parse(input.end())).atZone(SEOUL).toInstant()));
    }
    event.add(new Summary(input.title().strip()));
    if (input.location() != null && !input.location().isBlank())
      event.add(new Location(input.location()));
    if (input.memo() != null && !input.memo().isBlank()) event.add(new Description(input.memo()));
    event.add(new DtStamp());
    event.add(new LastModified(Instant.now()));
    event.add(new Sequence(sequence + 1));
    return calendar.toString();
  }
}
