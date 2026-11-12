package kr.myworkspace.calendar.icloud;

import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import kr.myworkspace.calendar.event.CalendarInfo;
import kr.myworkspace.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class ICloudConnectionService {
  final ICloudCoordinator coordinator;
  final CalDavClient dav;
  final ICloudCacheRepository cache;
  final TransactionTemplate transactions;
  final String publicUrl;

  ICloudConnectionService(
      ICloudCoordinator coordinator,
      CalDavClient dav,
      ICloudCacheRepository cache,
      TransactionTemplate transactions,
      @Value("${app.public-url}") String publicUrl) {
    this.coordinator = coordinator;
    this.dav = dav;
    this.cache = cache;
    this.transactions = transactions;
    this.publicUrl = publicUrl;
  }

  Object status(boolean secure) {
    CloudState state = coordinator.read();
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("mode", "live");
    result.put(
        "state",
        state.calendar() == null ? "disconnected" : state.error() == null ? "connected" : "error");
    result.put("lastSyncedAt", state.lastSyncedAt());
    result.put("message", state.error());
    result.put("calendarName", state.calendar() == null ? null : state.calendar().name());
    result.put("requiresHttps", !secure);
    result.put(
        "secureSetupUrl",
        publicUrl.startsWith("https://") ? publicUrl.replaceAll("/+$", "") + "/calendar" : null);
    if (state.encryptedCredentials() != null)
      try {
        String id = coordinator.account(state).appleId();
        int at = id.indexOf('@');
        result.put(
            "accountLabel",
            at > 0 ? id.substring(0, Math.min(2, at)) + "***" + id.substring(at) : "연결된 Apple 계정");
      } catch (ApiException ignored) {
        result.put("message", "서버 암호화 키를 확인하거나 계정을 다시 연결하세요.");
        result.put("state", "error");
      }
    return result;
  }

  CalendarInfo calendar() {
    var c = coordinator.read().calendar();
    return c == null
        ? null
        : new CalendarInfo("cal-remote", "iCloud · " + c.name(), "icloud", "icloud", c.readOnly());
  }

  Object discover(String appleId, String password) {
    long now = System.currentTimeMillis();
    long before;
    synchronized (coordinator.lock) {
      coordinator.drafts.entrySet().removeIf(e -> e.getValue().expiresAt() < now);
      if (now < coordinator.nextDiscovery)
        throw new ApiException(
            429, "RATE_LIMITED", "잠시 후 다시 연결하세요.", coordinator.nextDiscovery - now);
      coordinator.nextDiscovery = now + 5000;
      before = coordinator.generation;
    }
    String normalized = password.replaceAll("[-\\s]", "");
    ApiException.require(normalized.matches("[a-zA-Z]{16}"), "Apple에서 발급한 16자리 앱 전용 암호를 입력하세요.");
    var account =
        new CloudAccount(appleId.strip(), String.join("-", normalized.split("(?<=\\G....)")));
    var calendars = dav.discover(account);
    ApiException.require(!calendars.isEmpty(), "연결할 수 있는 iCloud 캘린더가 없습니다.");
    String token = UUID.randomUUID().toString();
    synchronized (coordinator.lock) {
      ApiException.require(before == coordinator.generation, "연결 설정이 변경됐습니다. 다시 연결하세요.");
      if (coordinator.drafts.size() >= 8)
        coordinator.drafts.remove(coordinator.drafts.keySet().iterator().next());
      coordinator.drafts.put(
          token,
          new CloudDraft(
              coordinator.secrets.encrypt(coordinator.json.writeValueAsString(account)),
              calendars,
              System.currentTimeMillis() + 300_000));
    }
    return Map.of(
        "draftToken",
        token,
        "calendars",
        calendars.stream()
            .map(c -> Map.of("id", c.id(), "name", c.name(), "readOnly", c.readOnly()))
            .toList());
  }

  Object connect(String token, String calendarId, boolean secure) {
    ICloudCoordinator.Snapshot before;
    CloudState candidate;
    synchronized (coordinator.lock) {
      var draft = coordinator.drafts.get(token);
      ApiException.require(
          draft != null && draft.expiresAt() >= System.currentTimeMillis(),
          "연결 시간이 만료됐습니다. 계정 정보를 다시 입력하세요.");
      var calendar =
          draft.calendars().stream()
              .filter(c -> c.id().equals(calendarId))
              .findFirst()
              .orElseThrow(() -> new ApiException(400, "VALIDATION", "캘린더를 선택하세요."));
      candidate = new CloudState(draft.encryptedCredentials(), calendar, null, null);
      before = coordinator.snapshot();
    }
    LocalDate from = LocalDate.now(ICalendarMapper.SEOUL).withDayOfMonth(1).minusDays(7),
        to = from.plusDays(49);
    var resources =
        dav.query(coordinator.account(candidate), candidate.calendar().href(), from, to);
    var events =
        ICalendarMapper.expandResources(resources, from, to, candidate.calendar().readOnly());
    synchronized (coordinator.lock) {
      ApiException.require(
          coordinator.current(before) && coordinator.drafts.containsKey(token),
          "연결 설정이 변경됐습니다. 다시 연결하세요.");
      transactions.executeWithoutResult(
          tx -> {
            cache.clear();
            cache.cache(from, to, events, resources, candidate);
            coordinator.store(
                new CloudState(
                    candidate.encryptedCredentials(),
                    candidate.calendar(),
                    Instant.now().toString(),
                    null));
          });
      coordinator.changedConnection();
    }
    return status(secure);
  }

  void disconnect() {
    synchronized (coordinator.lock) {
      transactions.executeWithoutResult(
          tx -> {
            coordinator.store(new CloudState(null, null, null, null));
            cache.clear();
          });
      coordinator.changedConnection();
    }
  }
}
