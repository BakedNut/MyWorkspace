package kr.myworkspace.calendar.event;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
class LocalEventStore {
  final EventRepository events;
  final JsonMapper json;

  LocalEventStore(EventRepository events, JsonMapper json) {
    this.events = events;
    this.json = json;
  }

  Map<String, Object> value(StoredEvent event) {
    Map<String, Object> result = new LinkedHashMap<>(json.readValue(event.payload, Map.class));
    result.put("id", event.id);
    result.put("revision", event.version.toString());
    return result;
  }

  List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    return events.findByDateBetweenOrderByDateAsc(from, to).stream().map(this::value).toList();
  }

  long count() {
    return events.count();
  }

  void revision(StoredEvent event, String revision) {
    if (!Objects.equals(event.version.toString(), revision))
      throw new ApiException(409, "CONFLICT", "다른 기기에서 일정이 바뀌었습니다. 새로고침 후 다시 시도하세요.");
  }

  @Transactional
  Map<String, Object> save(String id, EventInput input) {
    ApiException.require(
        input.date().getYear() >= 2000 && input.date().getYear() <= 2100, "날짜를 확인하세요.");
    StoredEvent event;
    if (id == null) event = new StoredEvent(UUID.randomUUID().toString(), input.date(), "");
    else {
      event =
          events.locked(id).orElseThrow(() -> new ApiException(404, "NOT_FOUND", "일정을 찾을 수 없습니다."));
      revision(event, input.revision());
    }
    var clean =
        new EventInput(
            input.calendarId(),
            input.title().trim(),
            input.date(),
            input.allDay(),
            input.allDay() ? null : input.start(),
            input.allDay() ? null : input.end(),
            input.location(),
            input.memo());
    event.date = input.date();
    event.payload = json.writeValueAsString(clean);
    return value(events.saveAndFlush(event));
  }

  @Transactional
  void delete(String id, String revision) {
    var event =
        events.locked(id).orElseThrow(() -> new ApiException(404, "NOT_FOUND", "일정을 찾을 수 없습니다."));
    revision(event, revision);
    events.delete(event);
    events.flush();
  }
}
