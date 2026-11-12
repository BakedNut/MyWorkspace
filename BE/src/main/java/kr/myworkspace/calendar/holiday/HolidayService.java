package kr.myworkspace.calendar.holiday;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

@Service
public class HolidayService {
  final DocumentStore docs;
  final JsonMapper json;
  final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  final Set<Integer> requestedYears = java.util.concurrent.ConcurrentHashMap.newKeySet();
  final Map<Integer, Long> retryAfter = new java.util.concurrent.ConcurrentHashMap<>();

  HolidayService(DocumentStore docs, JsonMapper json) {
    this.docs = docs;
    this.json = json;
  }

  @Scheduled(initialDelay = 1000, fixedDelay = 60_000)
  void refresh() {
    int year = LocalDate.now(ZoneId.of("Asia/Seoul")).getYear();
    requestedYears.addAll(List.of(year - 1, year, year + 1));
    for (int y : requestedYears) fetchYear(y);
  }

  void fetchYear(int y) {
    var updated = docs.findRaw("holidays-updated-" + y);
    if (updated.isPresent()
        && Instant.parse(json.readTree(updated.get()).asText())
            .isAfter(Instant.now().minusSeconds(86400))) return;
    long now = System.currentTimeMillis();
    synchronized (retryAfter) {
      if (retryAfter.getOrDefault(y, 0L) > now) return;
      retryAfter.put(y, now + 60_000);
    }
    try {
      var res =
          http.send(
              HttpRequest.newBuilder(
                      URI.create("https://date.nager.at/api/v3/PublicHolidays/" + y + "/KR"))
                  .timeout(Duration.ofSeconds(10))
                  .GET()
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      if (res.statusCode() != 200 || res.body().length() > 200_000) return;
      var rows = json.readTree(res.body());
      if (!rows.isArray() || rows.isEmpty()) return;
      docs.saveRaw("holidays-" + y, res.body());
      docs.save("holidays-updated-" + y, Instant.now().toString());
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      org.slf4j.LoggerFactory.getLogger(getClass())
          .warn("공휴일 갱신 실패: {}", e.getClass().getSimpleName());
    }
  }

  public Object status(LocalDate from, LocalDate to) {
    ApiException.require(
        !to.isBefore(from)
            && !to.isAfter(from.plusDays(370))
            && from.getYear() >= 2000
            && to.getYear() <= 2100,
        "조회 기간을 확인하세요.");
    boolean available = true, stale = false;
    for (int y = from.getYear(); y <= to.getYear(); y++) {
      available &= docs.exists("holidays-" + y);
      var updated = docs.findRaw("holidays-updated-" + y);
      stale |=
          updated.isEmpty()
              || Instant.parse(json.readTree(updated.get()).asText())
                  .isBefore(Instant.now().minusSeconds(172800));
    }
    return Map.of(
        "available",
        available,
        "message",
        !available
            ? "공휴일 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
            : stale ? "공휴일 정보 갱신이 지연되어 마지막으로 저장된 정보를 표시합니다." : "");
  }

  public List<Map<String, Object>> between(LocalDate from, LocalDate to) {
    List<Map<String, Object>> result = new ArrayList<>();
    for (int y = from.getYear(); y <= to.getYear(); y++) {
      var cache = docs.findRaw("holidays-" + y);
      requestedYears.add(y);
      if (cache.isEmpty()) continue;
      for (var row : json.readTree(cache.get())) {
        LocalDate d = LocalDate.parse(row.path("date").asText());
        boolean publicDay = false;
        for (var type : row.path("types")) if ("Public".equals(type.asText())) publicDay = true;
        if (!publicDay || d.isBefore(from) || d.isAfter(to)) continue;
        result.add(
            Map.of(
                "id",
                "holiday-" + d,
                "calendarId",
                "cal-holiday",
                "title",
                row.path("localName").asText(),
                "date",
                d.toString(),
                "allDay",
                true));
      }
    }
    return result;
  }
}
