package kr.myworkspace.calendar.icloud;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import kr.myworkspace.calendar.event.CalendarInfo;
import kr.myworkspace.calendar.event.EventInput;
import kr.myworkspace.common.crypto.SecretCipher;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ICloudService {
  final DocumentStore docs;
  final JsonMapper json;
  final SecretCipher secrets;
  final CalDavClient dav;
  final ICloudCacheRepository cache;
  final Object stateLock = new Object();
  final java.util.concurrent.atomic.AtomicBoolean syncing =
      new java.util.concurrent.atomic.AtomicBoolean();
  final java.util.concurrent.ExecutorService worker =
      java.util.concurrent.Executors.newSingleThreadExecutor();
  final Set<String> pending = new java.util.HashSet<>();
  long generation;
  long connectionGeneration;
  final Set<String> inFlight = new java.util.HashSet<>();
  boolean cacheDirty;
  final TransactionTemplate transactions;
  final String publicUrl;
  final Map<String, CloudDraft> drafts = new HashMap<>();
  long nextDiscovery;

  ICloudService(
      DocumentStore docs,
      JsonMapper json,
      SecretCipher secrets,
      CalDavClient dav,
      ICloudCacheRepository cache,
      TransactionTemplate transactions,
      @Value("${app.public-url}") String publicUrl) {
    this.docs = docs;
    this.json = json;
    this.secrets = secrets;
    this.dav = dav;
    this.cache = cache;
    this.transactions = transactions;
    this.publicUrl = publicUrl;
  }

  CloudState state() {
    return docs.read("icloud", CloudState.class);
  }

  CloudAccount account(CloudState state) {
    return json.readValue(secrets.decrypt(state.encryptedCredentials()), CloudAccount.class);
  }

  void store(CloudState state) {
    docs.save("icloud", state);
  }

  Object status(boolean secure) {
    CloudState state = state();
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
        String id = account(state).appleId();
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

  public CalendarInfo calendar() {
    var c = state().calendar();
    return c == null
        ? null
        : new CalendarInfo("cal-remote", "iCloud · " + c.name(), "icloud", "icloud", c.readOnly());
  }

  record Snapshot(long generation, long connectionGeneration, CloudState state) {}

  Snapshot snapshot() {
    synchronized (stateLock) {
      return new Snapshot(generation, connectionGeneration, state());
    }
  }

  boolean current(Snapshot snapshot) {
    return snapshot.connectionGeneration() == connectionGeneration;
  }

  Object discover(String appleId, String password) {
    long now = System.currentTimeMillis();
    long before;
    synchronized (stateLock) {
      drafts.entrySet().removeIf(e -> e.getValue().expiresAt() < now);
      if (now < nextDiscovery)
        throw new ApiException(429, "RATE_LIMITED", "잠시 후 다시 연결하세요.", nextDiscovery - now);
      nextDiscovery = now + 5000;
      before = generation;
    }
    String normalized = password.replaceAll("[-\\s]", "");
    ApiException.require(normalized.matches("[a-zA-Z]{16}"), "Apple에서 발급한 16자리 앱 전용 암호를 입력하세요.");
    var account =
        new CloudAccount(appleId.strip(), String.join("-", normalized.split("(?<=\\G....)")));
    var calendars = dav.discover(account);
    ApiException.require(!calendars.isEmpty(), "연결할 수 있는 iCloud 캘린더가 없습니다.");
    String token = UUID.randomUUID().toString();
    synchronized (stateLock) {
      ApiException.require(before == generation, "연결 설정이 변경됐습니다. 다시 연결하세요.");
      if (drafts.size() >= 8) drafts.remove(drafts.keySet().iterator().next());
      drafts.put(
          token,
          new CloudDraft(
              secrets.encrypt(json.writeValueAsString(account)),
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
    Snapshot before;
    CloudState candidate;
    synchronized (stateLock) {
      var draft = drafts.get(token);
      ApiException.require(
          draft != null && draft.expiresAt() >= System.currentTimeMillis(),
          "연결 시간이 만료됐습니다. 계정 정보를 다시 입력하세요.");
      var calendar =
          draft.calendars().stream()
              .filter(c -> c.id().equals(calendarId))
              .findFirst()
              .orElseThrow(() -> new ApiException(400, "VALIDATION", "캘린더를 선택하세요."));
      candidate = new CloudState(draft.encryptedCredentials(), calendar, null, null);
      before = snapshot();
    }
    LocalDate from = LocalDate.now(ICalendarMapper.SEOUL).withDayOfMonth(1).minusDays(7),
        to = from.plusDays(49);
    var resources = dav.query(account(candidate), candidate.calendar().href(), from, to);
    var events = parse(resources, from, to, candidate.calendar().readOnly());
    synchronized (stateLock) {
      ApiException.require(
          current(before) && drafts.containsKey(token), "연결 설정이 변경됐습니다. 다시 연결하세요.");
      transactions.executeWithoutResult(
          tx -> {
            cache.clear();
            cache.cache(from, to, events, resources, candidate);
            store(
                new CloudState(
                    candidate.encryptedCredentials(),
                    candidate.calendar(),
                    Instant.now().toString(),
                    null));
          });
      generation++;
      connectionGeneration++;
      cacheDirty = false;
      drafts.clear();
    }
    return status(secure);
  }

  List<Map<String, Object>> parse(
      List<CloudResource> resources, LocalDate from, LocalDate to, boolean readOnly) {
    List<Map<String, Object>> events = new ArrayList<>();
    for (var r : resources) {
      events.addAll(ICalendarMapper.expand(r, from, to, readOnly));
      if (events.size() > 5000)
        throw new ApiException(400, "VALIDATION", "조회한 일정이 너무 많습니다. 기간을 줄여주세요.");
    }
    return events;
  }

  public List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    synchronized (stateLock) {
      if (state().calendar() == null) return List.of();
      if (cacheDirty) {
        cache.invalidate();
        cacheDirty = false;
      }
      var values = cache.read(from, to);
      if (cache.stale(from, to)) queue(from, to);
      return values;
    }
  }

  void queue(LocalDate from, LocalDate to) {
    String key = from + ":" + to;
    if (pending.size() >= 12 || !pending.add(key)) return;
    worker.execute(
        () -> {
          try {
            refresh(from, to);
          } finally {
            synchronized (stateLock) {
              pending.remove(key);
            }
          }
        });
  }

  void refresh(LocalDate from, LocalDate to) {
    String key = from + ":" + to;
    Snapshot before;
    synchronized (stateLock) {
      if (!inFlight.add(key)) return;
      before = snapshot();
    }
    var state = before.state();
    try {
      if (state.calendar() == null) return;
      var resources = dav.query(account(state), state.calendar().href(), from, to);
      var events = parse(resources, from, to, state.calendar().readOnly());
      synchronized (stateLock) {
        if (!current(before) || before.generation() != generation) return;
        transactions.executeWithoutResult(
            tx -> {
              cache.cache(from, to, events, resources, state);
              store(
                  new CloudState(
                      state.encryptedCredentials(),
                      state.calendar(),
                      Instant.now().toString(),
                      null));
            });
      }
    } catch (RuntimeException error) {
      synchronized (stateLock) {
        if (current(before) && before.generation() == generation)
          store(
              new CloudState(
                  state.encryptedCredentials(),
                  state.calendar(),
                  state.lastSyncedAt(),
                  "iCloud 갱신이 지연되어 저장된 일정을 표시합니다."));
      }
    } finally {
      synchronized (stateLock) {
        inFlight.remove(key);
      }
    }
  }

  @Scheduled(initialDelay = 60_000, fixedDelay = 60_000)
  void sync() {
    if (!syncing.compareAndSet(false, true)) return;
    try {
      if (snapshot().state().calendar() == null) return;
      var ranges = cache.ranges();
      if (ranges.isEmpty()) {
        LocalDate from = LocalDate.now(ICalendarMapper.SEOUL).withDayOfMonth(1).minusDays(7);
        refresh(from, from.plusDays(49));
      } else for (var range : ranges) refresh(range[0], range[1]);
    } finally {
      syncing.set(false);
    }
  }

  Object syncNow(boolean secure) {
    ApiException.require(state().calendar() != null, "먼저 iCloud를 연결하세요.");
    sync();
    var state = state();
    if (state.error() != null) throw new ApiException(503, "NETWORK", state.error());
    return status(secure);
  }

  void disconnect() {
    synchronized (stateLock) {
      transactions.executeWithoutResult(
          tx -> {
            store(new CloudState(null, null, null, null));
            cache.clear();
          });
      generation++;
      connectionGeneration++;
      cacheDirty = false;
      drafts.clear();
    }
  }

  Snapshot writableSnapshot() {
    var before = snapshot();
    var state = before.state();
    ApiException.require(state.calendar() != null, "iCloud를 먼저 연결하세요.");
    if (state.calendar().readOnly()) throw new ApiException(403, "READ_ONLY", "읽기 전용 캘린더입니다.");
    return before;
  }

  void afterMutation(Snapshot before, Runnable update) {
    synchronized (stateLock) {
      if (!current(before)) return;
      generation++;
      try {
        transactions.executeWithoutResult(
            tx -> {
              cache.invalidate();
              update.run();
            });
      } catch (RuntimeException error) {
        cacheDirty = true;
        org.slf4j.LoggerFactory.getLogger(getClass())
            .warn("iCloud 원격 변경 완료, 캐시 재동기화 필요: {}", error.getClass().getSimpleName());
      }
    }
  }

  @jakarta.annotation.PreDestroy
  void close() {
    worker.shutdownNow();
  }

  public Map<String, Object> save(String id, EventInput input) {
    ApiException.require(
        input.date().getYear() >= 2000 && input.date().getYear() <= 2100, "날짜를 확인하세요.");
    var snapshot = writableSnapshot();
    var current = snapshot.state();
    String href, original = null, revision = null;
    if (id == null)
      href =
          current.calendar().href()
              + Objects.toString(input.requestId(), UUID.randomUUID().toString())
              + ".ics";
    else {
      var meta = cache.resource(id);
      href = (String) meta.get("href");
      revision = input.revision();
      ApiException.require(revision != null && !revision.isBlank(), "최신 일정을 다시 불러온 뒤 수정하세요.");
      var fresh =
          dav.send(
              account(current),
              CalDavClient.resourceUri(current.calendar().href(), href),
              "GET",
              null,
              Map.of());
      if (fresh.status() != 200 || !fresh.headers().firstValue("ETag").orElse("").equals(revision))
        throw new ApiException(409, "CONFLICT", "다른 기기에서 일정이 바뀌었습니다. 새로고침 후 다시 수정하세요.");
      original = fresh.body();
    }
    String content = ICalendarMapper.write(input, original);
    DavReply reply;
    try {
      reply =
          dav.send(
              account(current),
              CalDavClient.resourceUri(current.calendar().href(), href),
              "PUT",
              content,
              id == null
                  ? Map.of("Content-Type", "text/calendar; charset=utf-8", "If-None-Match", "*")
                  : Map.of("Content-Type", "text/calendar; charset=utf-8", "If-Match", revision));
    } catch (ApiException error) {
      if (id != null || input.requestId() == null || !"CONFLICT".equals(error.code())) throw error;
      var existing =
          dav.send(
              account(current),
              CalDavClient.resourceUri(current.calendar().href(), href),
              "GET",
              null,
              Map.of());
      if (existing.status() != 200
          || !matches(
              input,
              new CloudResource(
                  href, existing.headers().firstValue("ETag").orElse(""), existing.body())))
        throw error;
      reply = existing;
      content = existing.body();
    }
    if (!Set.of(200, 201, 204).contains(reply.status()))
      throw new ApiException(503, "NETWORK", "iCloud에 저장하지 못했습니다. 입력은 유지됩니다.");
    String etag = reply.headers().firstValue("ETag").orElse("");
    var saved = new CloudResource(href, etag, content);
    var events = ICalendarMapper.expand(saved, input.date(), input.date(), false);
    ApiException.require(!events.isEmpty(), "저장 결과를 다시 불러오세요.");
    afterMutation(
        snapshot, () -> cache.remember(List.of(saved), input.date(), input.date(), current));
    return events.getFirst();
  }

  static boolean matches(EventInput input, CloudResource resource) {
    var events = ICalendarMapper.expand(resource, input.date(), input.date(), false);
    if (events.size() != 1) return false;
    var event = events.getFirst();
    return Boolean.FALSE.equals(event.get("readOnly"))
        && input.title().strip().equals(event.get("title"))
        && Objects.equals(input.allDay(), event.get("allDay"))
        && input.date().toString().equals(event.get("date"))
        && (input.allDay()
            || (Objects.equals(input.start(), event.get("start"))
                && Objects.equals(input.end(), event.get("end"))))
        && Objects.toString(input.location(), "").equals(event.get("location"))
        && Objects.toString(input.memo(), "").equals(event.get("memo"));
  }

  public void delete(String id, String revision) {
    var snapshot = writableSnapshot();
    var current = snapshot.state();
    var meta = cache.resource(id);
    ApiException.require(revision != null && !revision.isBlank(), "최신 일정을 다시 불러온 뒤 삭제하세요.");
    var reply =
        dav.send(
            account(current),
            CalDavClient.resourceUri(current.calendar().href(), (String) meta.get("href")),
            "DELETE",
            null,
            Map.of("If-Match", revision));
    if (!Set.of(200, 204, 404).contains(reply.status()))
      throw new ApiException(503, "NETWORK", "iCloud 일정을 삭제하지 못했습니다.");
    afterMutation(snapshot, () -> cache.removeResource((String) meta.get("id")));
  }
}
