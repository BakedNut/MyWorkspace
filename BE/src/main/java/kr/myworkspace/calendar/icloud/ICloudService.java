package kr.myworkspace.calendar.icloud;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import kr.myworkspace.calendar.event.CalendarInfo;
import kr.myworkspace.calendar.event.EventInput;
import org.springframework.stereotype.Service;

@Service
public class ICloudService {
  final ICloudConnectionService connection;
  final ICloudSyncService sync;
  final ICloudEventService events;

  ICloudService(
      ICloudConnectionService connection, ICloudSyncService sync, ICloudEventService events) {
    this.connection = connection;
    this.sync = sync;
    this.events = events;
  }

  Object status(boolean secure) {
    return connection.status(secure);
  }

  public CalendarInfo calendar() {
    return connection.calendar();
  }

  Object discover(String id, String password) {
    return connection.discover(id, password);
  }

  Object connect(String token, String calendarId, boolean secure) {
    return connection.connect(token, calendarId, secure);
  }

  void disconnect() {
    connection.disconnect();
  }

  Object syncNow(boolean secure) {
    sync.syncNow();
    return connection.status(secure);
  }

  public List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    return sync.list(from, to);
  }

  public Map<String, Object> save(String id, EventInput input) {
    return events.save(id, input);
  }

  public void delete(String id, String revision) {
    events.delete(id, revision);
  }
}
