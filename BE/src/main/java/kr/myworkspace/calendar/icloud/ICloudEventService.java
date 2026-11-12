package kr.myworkspace.calendar.icloud;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import kr.myworkspace.calendar.event.EventInput;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class ICloudEventService {
  final ICloudCoordinator coordinator;
  final CalDavClient dav;
  final ICloudCacheRepository cache;
  final TransactionTemplate transactions;

  ICloudEventService(
      ICloudCoordinator coordinator,
      CalDavClient dav,
      ICloudCacheRepository cache,
      TransactionTemplate transactions) {
    this.coordinator = coordinator;
    this.dav = dav;
    this.cache = cache;
    this.transactions = transactions;
  }

  void afterMutation(ICloudCoordinator.Snapshot before, Runnable update) {
    synchronized (coordinator.lock) {
      if (!coordinator.current(before)) return;
      coordinator.generation++;
      try {
        transactions.executeWithoutResult(
            tx -> {
              cache.markStale();
              update.run();
            });
      } catch (RuntimeException error) {
        coordinator.cacheDirty = true;
        org.slf4j.LoggerFactory.getLogger(getClass())
            .warn("iCloud 원격 변경 완료, 캐시 재동기화 필요: {}", error.getClass().getSimpleName());
      }
    }
  }

  Map<String, Object> save(String id, EventInput input) {
    ApiException.require(
        input.date().getYear() >= 2000 && input.date().getYear() <= 2100, "날짜를 확인하세요.");
    var snapshot = coordinator.writableSnapshot();
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
              coordinator.account(current),
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
              coordinator.account(current),
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
              coordinator.account(current),
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
        snapshot,
        () -> {
          cache.remember(List.of(saved), input.date(), input.date(), current);
          cache.patch(href, events);
        });
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

  void delete(String id, String revision) {
    var snapshot = coordinator.writableSnapshot();
    var current = snapshot.state();
    var meta = cache.resource(id);
    ApiException.require(revision != null && !revision.isBlank(), "최신 일정을 다시 불러온 뒤 삭제하세요.");
    var reply =
        dav.send(
            coordinator.account(current),
            CalDavClient.resourceUri(current.calendar().href(), (String) meta.get("href")),
            "DELETE",
            null,
            Map.of("If-Match", revision));
    if (!Set.of(200, 204, 404).contains(reply.status()))
      throw new ApiException(503, "NETWORK", "iCloud 일정을 삭제하지 못했습니다.");
    afterMutation(
        snapshot,
        () -> {
          cache.removeResource((String) meta.get("id"));
          cache.patch((String) meta.get("href"), List.of());
        });
  }
}
