package kr.myworkspace;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

record CloudState(
    String encryptedCredentials, CloudCalendar calendar, String lastSyncedAt, String error) {}

record CloudDraft(String encryptedCredentials, List<CloudCalendar> calendars, long expiresAt) {}

@Service
class ICloud {
  final Documents docs;
  final CloudSecrets secrets;
  final CalDav dav;
  final JdbcTemplate jdbc;
  final TransactionTemplate transactions;
  final String publicUrl;
  final Map<String, CloudDraft> drafts = new HashMap<>();
  long nextDiscovery;

  ICloud(
      Documents docs,
      CloudSecrets secrets,
      CalDav dav,
      JdbcTemplate jdbc,
      TransactionTemplate transactions,
      @Value("${app.public-url}") String publicUrl) {
    this.docs = docs;
    this.secrets = secrets;
    this.dav = dav;
    this.jdbc = jdbc;
    this.transactions = transactions;
    this.publicUrl = publicUrl;
  }

  CloudState state() {
    return docs.read("icloud", CloudState.class);
  }

  CloudAccount account(CloudState state) {
    return docs.json.readValue(secrets.decrypt(state.encryptedCredentials()), CloudAccount.class);
  }

  void store(CloudState state) {
    docs.repository.save(new AppDocument("icloud", docs.json.writeValueAsString(state)));
  }

  synchronized Object status(boolean secure) {
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

  synchronized CalendarInfo calendar() {
    var c = state().calendar();
    return c == null
        ? null
        : new CalendarInfo("cal-remote", "iCloud · " + c.name(), "icloud", "icloud", c.readOnly());
  }

  synchronized Object discover(String appleId, String password) {
    long now = System.currentTimeMillis();
    drafts.entrySet().removeIf(e -> e.getValue().expiresAt() < now);
    if (now < nextDiscovery)
      throw new ApiException(429, "RATE_LIMITED", "잠시 후 다시 연결하세요.", nextDiscovery - now);
    nextDiscovery = now + 5000;
    String normalized = password.replaceAll("[-\\s]", "");
    ApiException.require(normalized.matches("[a-zA-Z]{16}"), "Apple에서 발급한 16자리 앱 전용 암호를 입력하세요.");
    var account =
        new CloudAccount(appleId.strip(), String.join("-", normalized.split("(?<=\\G....)")));
    var calendars = dav.discover(account);
    ApiException.require(!calendars.isEmpty(), "연결할 수 있는 iCloud 캘린더가 없습니다.");
    if (drafts.size() >= 8) drafts.remove(drafts.keySet().iterator().next());
    String token = UUID.randomUUID().toString();
    drafts.put(
        token,
        new CloudDraft(
            secrets.encrypt(docs.json.writeValueAsString(account)), calendars, now + 300_000));
    return Map.of(
        "draftToken",
        token,
        "calendars",
        calendars.stream()
            .map(c -> Map.of("id", c.id(), "name", c.name(), "readOnly", c.readOnly()))
            .toList());
  }

  synchronized Object connect(String token, String calendarId, boolean secure) {
    var draft = drafts.get(token);
    if (draft == null || draft.expiresAt() < System.currentTimeMillis())
      throw new ApiException(400, "VALIDATION", "연결 시간이 만료됐습니다. 계정 정보를 다시 입력하세요.");
    var calendar =
        draft.calendars().stream()
            .filter(c -> c.id().equals(calendarId))
            .findFirst()
            .orElseThrow(() -> new ApiException(400, "VALIDATION", "캘린더를 선택하세요."));
    var candidate = new CloudState(draft.encryptedCredentials(), calendar, null, null);
    LocalDate from = LocalDate.now(CloudEvents.SEOUL).withDayOfMonth(1).minusDays(7),
        to = from.plusDays(49);
    var resources = dav.query(account(candidate), calendar.href(), from, to);
    var events = parse(resources, from, to, calendar.readOnly());
    transactions.executeWithoutResult(
        tx -> {
          jdbc.update("delete from icloud_range");
          jdbc.update("delete from icloud_resource");
          store(candidate);
          cache(from, to, events, resources, candidate);
        });
    drafts.clear();
    return status(secure);
  }

  List<Map<String, Object>> parse(
      List<CloudResource> resources, LocalDate from, LocalDate to, boolean readOnly) {
    List<Map<String, Object>> events = new ArrayList<>();
    for (var r : resources) {
      events.addAll(CloudEvents.expand(r, from, to, readOnly));
      if (events.size() > 5000)
        throw new ApiException(400, "VALIDATION", "조회한 일정이 너무 많습니다. 기간을 줄여주세요.");
    }
    return events;
  }

  void cache(
      LocalDate from,
      LocalDate to,
      List<Map<String, Object>> events,
      List<CloudResource> resources,
      CloudState state) {
    long now = System.currentTimeMillis();
    String key = from + ":" + to;
    if (jdbc.update(
            "update icloud_range set payload=?,fetched_at=?,accessed_at=? where cache_key=?",
            docs.json.writeValueAsString(events),
            now,
            now,
            key)
        == 0)
      jdbc.update(
          "insert into icloud_range(cache_key,from_date,to_date,fetched_at,accessed_at,payload)"
              + " values(?,?,?,?,?,?)",
          key,
          from,
          to,
          now,
          now,
          docs.json.writeValueAsString(events));
    for (var r : resources) {
      String id = CalDav.id(r.href());
      boolean readOnly =
          state.calendar().readOnly()
              || CloudEvents.expand(r, from, to, false).stream()
                  .anyMatch(e -> Boolean.TRUE.equals(e.get("readOnly")));
      if (jdbc.update(
              "update icloud_resource set href=?,etag=?,read_only=?,last_seen=? where id=?",
              r.href(),
              r.etag(),
              readOnly,
              now,
              id)
          == 0)
        jdbc.update(
            "insert into icloud_resource(id,href,etag,read_only,last_seen) values(?,?,?,?,?)",
            id,
            r.href(),
            r.etag(),
            readOnly,
            now);
    }
    store(
        new CloudState(
            state.encryptedCredentials(),
            state.calendar(),
            Instant.ofEpochMilli(now).toString(),
            null));
    var old = jdbc.queryForList("select cache_key from icloud_range order by accessed_at desc");
    for (var row : old.subList(Math.min(12, old.size()), old.size()))
      jdbc.update("delete from icloud_range where cache_key=?", row.get("cache_key"));
    jdbc.update("delete from icloud_resource where last_seen < ?", now - 31L * 86400_000);
  }

  synchronized List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    var state = state();
    if (state.calendar() == null) return List.of();
    String key = from + ":" + to;
    var cached =
        jdbc.queryForList("select fetched_at,payload from icloud_range where cache_key=?", key);
    if (!cached.isEmpty())
      jdbc.update(
          "update icloud_range set accessed_at=? where cache_key=?",
          System.currentTimeMillis(),
          key);
    if (cached.isEmpty()
        || ((Number) cached.getFirst().get("fetched_at")).longValue()
            < System.currentTimeMillis() - 60_000) {
      try {
        var resources = dav.query(account(state), state.calendar().href(), from, to);
        var events = parse(resources, from, to, state.calendar().readOnly());
        transactions.executeWithoutResult(tx -> cache(from, to, events, resources, state));
        return events;
      } catch (ApiException error) {
        store(
            new CloudState(
                state.encryptedCredentials(),
                state.calendar(),
                state.lastSyncedAt(),
                error.getMessage()));
        if (cached.isEmpty()) {
          var fallback =
              jdbc.queryForList(
                  "select payload from icloud_range where from_date <= ? and to_date >= ? order by"
                      + " fetched_at desc limit 1",
                  from,
                  to);
          if (fallback.isEmpty()) return List.of();
          List<Map<String, Object>> old =
              docs.json.readValue((String) fallback.getFirst().get("payload"), List.class);
          return old.stream()
              .filter(
                  e ->
                      e.get("date").toString().compareTo(from.toString()) >= 0
                          && e.get("date").toString().compareTo(to.toString()) <= 0)
              .toList();
        }
      }
    }
    return docs.json.readValue((String) cached.getFirst().get("payload"), List.class);
  }

  @Scheduled(initialDelay = 60_000, fixedDelay = 60_000)
  synchronized void sync() {
    if (state().calendar() == null) return;
    var ranges =
        jdbc.queryForList("select from_date,to_date from icloud_range order by accessed_at desc");
    if (ranges.isEmpty()) {
      LocalDate from = LocalDate.now(CloudEvents.SEOUL).withDayOfMonth(1).minusDays(7);
      list(from, from.plusDays(49));
      return;
    }
    for (var row : ranges) {
      try {
        list(
            ((java.sql.Date) row.get("from_date")).toLocalDate(),
            ((java.sql.Date) row.get("to_date")).toLocalDate());
        if (state().error() != null) break;
      } catch (ApiException ignored) {
        break;
      }
    }
  }

  synchronized Object syncNow(boolean secure) {
    ApiException.require(state().calendar() != null, "먼저 iCloud를 연결하세요.");
    jdbc.update("update icloud_range set fetched_at=0");
    sync();
    var current = state();
    if (current.error() != null) throw new ApiException(503, "NETWORK", current.error());
    return status(secure);
  }

  synchronized void disconnect() {
    transactions.executeWithoutResult(
        tx -> {
          store(new CloudState(null, null, null, null));
          jdbc.update("delete from icloud_range");
          jdbc.update("delete from icloud_resource");
        });
    drafts.clear();
  }

  CloudState writable() {
    var current = state();
    ApiException.require(current.calendar() != null, "iCloud를 먼저 연결하세요.");
    if (current.calendar().readOnly()) throw new ApiException(403, "READ_ONLY", "읽기 전용 캘린더입니다.");
    return current;
  }

  Map<String, Object> resource(String id) {
    ApiException.require(id.matches("icloud-[0-9a-f]{40}-[0-9a-f]{12}"), "일정 식별자를 확인하세요.");
    var rows = jdbc.queryForList("select * from icloud_resource where id=?", id.substring(7, 47));
    if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND", "일정을 새로고침한 뒤 다시 시도하세요.");
    if (Boolean.TRUE.equals(rows.getFirst().get("read_only")))
      throw new ApiException(403, "READ_ONLY", "반복·여러 날·초대 일정은 Apple 캘린더에서 수정하세요.");
    return rows.getFirst();
  }

  synchronized Map<String, Object> save(String id, EventInput input) {
    ApiException.require(
        input.date().getYear() >= 2000 && input.date().getYear() <= 2100, "날짜를 확인하세요.");
    var current = writable();
    String href, original = null, revision = null;
    if (id == null)
      href =
          current.calendar().href()
              + Objects.toString(input.requestId(), UUID.randomUUID().toString())
              + ".ics";
    else {
      var meta = resource(id);
      href = (String) meta.get("href");
      revision = input.revision();
      ApiException.require(revision != null && !revision.isBlank(), "최신 일정을 다시 불러온 뒤 수정하세요.");
      var fresh =
          dav.send(
              account(current),
              CalDav.resourceUri(current.calendar().href(), href),
              "GET",
              null,
              Map.of());
      if (fresh.status() != 200 || !fresh.headers().firstValue("ETag").orElse("").equals(revision))
        throw new ApiException(409, "CONFLICT", "다른 기기에서 일정이 바뀌었습니다. 새로고침 후 다시 수정하세요.");
      original = fresh.body();
    }
    String content = CloudEvents.write(input, original);
    DavReply reply;
    try {
      reply =
          dav.send(
              account(current),
              CalDav.resourceUri(current.calendar().href(), href),
              "PUT",
              content,
              id == null
                  ? Map.of("Content-Type", "text/calendar; charset=utf-8", "If-None-Match", "*")
                  : Map.of("Content-Type", "text/calendar; charset=utf-8", "If-Match", revision));
    } catch (ApiException error) {
      if (id != null || input.requestId() == null || !"CONFLICT".equals(error.code)) throw error;
      var existing =
          dav.send(
              account(current),
              CalDav.resourceUri(current.calendar().href(), href),
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
    jdbc.update("delete from icloud_range");
    String etag = reply.headers().firstValue("ETag").orElse("");
    var saved = new CloudResource(href, etag, content);
    var events = CloudEvents.expand(saved, input.date(), input.date(), false);
    ApiException.require(!events.isEmpty(), "저장 결과를 다시 불러오세요.");
    return events.getFirst();
  }

  static boolean matches(EventInput input, CloudResource resource) {
    var events = CloudEvents.expand(resource, input.date(), input.date(), false);
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

  synchronized void delete(String id, String revision) {
    var current = writable();
    var meta = resource(id);
    ApiException.require(revision != null && !revision.isBlank(), "최신 일정을 다시 불러온 뒤 삭제하세요.");
    var reply =
        dav.send(
            account(current),
            CalDav.resourceUri(current.calendar().href(), (String) meta.get("href")),
            "DELETE",
            null,
            Map.of("If-Match", revision));
    if (!Set.of(200, 204, 404).contains(reply.status()))
      throw new ApiException(503, "NETWORK", "iCloud 일정을 삭제하지 못했습니다.");
    jdbc.update("delete from icloud_range");
    jdbc.update("delete from icloud_resource where id=?", meta.get("id"));
  }
}

@RestController
@RequestMapping("/api/calendar/icloud")
class ICloudController {
  final ICloud cloud;

  ICloudController(ICloud cloud) {
    this.cloud = cloud;
  }

  static void secure(HttpServletRequest request) {
    if (!request.isSecure()) throw new ApiException(400, "VALIDATION", "계정 연결은 HTTPS 주소에서 진행하세요.");
  }

  record Credentials(
      @NotBlank @Email @Size(max = 254) String appleId,
      @NotBlank @Size(max = 128) String appPassword) {}

  record Selection(
      @NotBlank @Size(max = 64) String draftToken, @NotBlank @Size(max = 64) String calendarId) {}

  @GetMapping("/status")
  Object status(HttpServletRequest req) {
    return cloud.status(req.isSecure());
  }

  @PostMapping("/discover")
  Object discover(@Valid @RequestBody Credentials input, HttpServletRequest req) {
    secure(req);
    return cloud.discover(input.appleId(), input.appPassword());
  }

  @PostMapping("/connect")
  Object connect(@Valid @RequestBody Selection input, HttpServletRequest req) {
    secure(req);
    return cloud.connect(input.draftToken(), input.calendarId(), req.isSecure());
  }

  @PostMapping("/sync")
  Object sync(HttpServletRequest req) {
    return cloud.syncNow(req.isSecure());
  }

  @DeleteMapping
  Object disconnect() {
    cloud.disconnect();
    return Map.of("disconnected", true);
  }
}
