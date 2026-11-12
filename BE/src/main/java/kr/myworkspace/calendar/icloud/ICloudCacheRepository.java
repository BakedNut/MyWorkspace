package kr.myworkspace.calendar.icloud;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import kr.myworkspace.common.error.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
class ICloudCacheRepository {
  final JdbcTemplate jdbc;
  final JsonMapper json;

  ICloudCacheRepository(JdbcTemplate jdbc, JsonMapper json) {
    this.jdbc = jdbc;
    this.json = json;
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
            json.writeValueAsString(events),
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
          json.writeValueAsString(events));
    remember(resources, from, to, state);
    var old = jdbc.queryForList("select cache_key from icloud_range order by accessed_at desc");
    for (var row : old.subList(Math.min(12, old.size()), old.size()))
      jdbc.update("delete from icloud_range where cache_key=?", row.get("cache_key"));
    jdbc.update("delete from icloud_resource where last_seen < ?", now - 31L * 86400_000);
  }

  void remember(List<CloudResource> resources, LocalDate from, LocalDate to, CloudState state) {
    long now = System.currentTimeMillis();
    for (var r : resources) {
      String id = CalDavClient.id(r.href());
      boolean readOnly =
          state.calendar().readOnly()
              || ICalendarMapper.expand(r, from, to, false).stream()
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
  }

  List<Map<String, Object>> read(LocalDate from, LocalDate to) {
    var rows =
        jdbc.queryForList(
            "select cache_key,payload from icloud_range where from_date <= ? and to_date >= ? order"
                + " by fetched_at desc limit 1",
            from,
            to);
    if (rows.isEmpty()) return List.of();
    jdbc.update(
        "update icloud_range set accessed_at=? where cache_key=?",
        System.currentTimeMillis(),
        rows.getFirst().get("cache_key"));
    List<Map<String, Object>> values =
        json.readValue((String) rows.getFirst().get("payload"), List.class);
    return values.stream()
        .filter(
            e ->
                e.get("date").toString().compareTo(from.toString()) >= 0
                    && e.get("date").toString().compareTo(to.toString()) <= 0)
        .toList();
  }

  boolean stale(LocalDate from, LocalDate to) {
    var times =
        jdbc.query(
            "select fetched_at from icloud_range where cache_key=?",
            (r, n) -> r.getLong(1),
            from + ":" + to);
    return times.isEmpty() || times.getFirst() < System.currentTimeMillis() - 60_000;
  }

  List<LocalDate[]> ranges() {
    return jdbc.query(
        "select from_date,to_date from icloud_range order by accessed_at desc",
        (r, n) -> new LocalDate[] {r.getDate(1).toLocalDate(), r.getDate(2).toLocalDate()});
  }

  void invalidate() {
    jdbc.update("delete from icloud_range");
  }

  void clear() {
    invalidate();
    jdbc.update("delete from icloud_resource");
  }

  void removeResource(String id) {
    jdbc.update("delete from icloud_resource where id=?", id);
  }

  Map<String, Object> resource(String id) {
    ApiException.require(id.matches("icloud-[0-9a-f]{40}-[0-9a-f]{12}"), "일정 식별자를 확인하세요.");
    var rows = jdbc.queryForList("select * from icloud_resource where id=?", id.substring(7, 47));
    if (rows.isEmpty()) throw new ApiException(404, "NOT_FOUND", "일정을 새로고침한 뒤 다시 시도하세요.");
    if (Boolean.TRUE.equals(rows.getFirst().get("read_only")))
      throw new ApiException(403, "READ_ONLY", "반복·여러 날·초대 일정은 Apple 캘린더에서 수정하세요.");
    return rows.getFirst();
  }
}
