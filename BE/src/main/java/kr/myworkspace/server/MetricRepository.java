package kr.myworkspace.server;

import java.util.*;
import kr.myworkspace.common.error.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class MetricRepository {
  final JdbcTemplate jdbc;
  final TransactionTemplate transactions;
  final Map<String, Long> retainedMinutes = new HashMap<>();

  MetricRepository(JdbcTemplate jdbc, TransactionTemplate transactions) {
    this.jdbc = jdbc;
    this.transactions = transactions;
  }

  record Sample(
      long at,
      String id,
      double cpu,
      double ram,
      ServerStatusResponse.Network network,
      Double disk) {}

  synchronized void record(List<Sample> samples) {
    var minutes = new HashMap<>(retainedMinutes);
    transactions.executeWithoutResult(
        tx -> {
          for (var s : samples) {
            boolean keep = !Objects.equals(minutes.put(s.id(), s.at() / 60_000), s.at() / 60_000);
            jdbc.update(
                "insert into"
                    + " metric_sample(sampled_at,resource_id,cpu,ram,net_input,net_output,disk,keep_minute)"
                    + " values(?,?,?,?,?,?,?,?)",
                s.at(),
                s.id(),
                s.cpu(),
                s.ram(),
                s.network().inputBytesPerSecond(),
                s.network().outputBytesPerSecond(),
                s.disk(),
                keep);
          }
        });
    retainedMinutes.clear();
    retainedMinutes.putAll(minutes);
  }

  @Scheduled(initialDelay = 60_000, fixedDelay = 60_000)
  void retain() {
    long now = System.currentTimeMillis();
    // Keep five-second samples for an hour and one sample per minute for a month.
    jdbc.update(
        "delete from metric_sample where sampled_at < ? or (sampled_at < ? and keep_minute=false)",
        now - 31L * 86400_000,
        now - 3600_000);
  }

  MetricHistoryResponse history(String range, Map<String, String> guestKeys) {
    long window =
        switch (range) {
          case "1m" -> 60_000;
          case "15m" -> 900_000;
          case "1H" -> 3600_000;
          case "6H" -> 6L * 3600_000;
          case "12H" -> 12L * 3600_000;
          case "1D" -> 86400_000;
          case "1W" -> 7L * 86400_000;
          case "1M" -> 30L * 86400_000;
          default -> throw new ApiException(400, "VALIDATION", "조회 기간을 확인하세요.");
        };
    long step =
        switch (range) {
          case "1m" -> 5000;
          case "15m", "1H" -> 60_000;
          case "6H" -> 300_000;
          case "12H" -> 600_000;
          case "1D" -> 900_000;
          case "1W" -> 3600_000;
          default -> 21600_000;
        };
    long to = System.currentTimeMillis(), from = to - window;
    var host = MetricHistoryResponse.ResourceHistory.empty(false);
    Map<String, MetricHistoryResponse.ResourceHistory> guests = new LinkedHashMap<>();
    var rows =
        jdbc.queryForList(
            "select resource_id, floor(sampled_at / ?) * ? as bucket, avg(cpu) as cpu, avg(ram) as"
                + " ram, avg(net_input) as input_rate, avg(net_output) as output_rate, avg(disk) as"
                + " disk from metric_sample where sampled_at between ? and ? group by resource_id,"
                + " bucket order by bucket",
            step,
            step,
            from,
            to);
    for (var row : rows) {
      String id = (String) row.get("resource_id");
      var target =
          id.equals("host")
              ? host
              : guests.computeIfAbsent(
                  guestKeys.getOrDefault(id, id),
                  k -> MetricHistoryResponse.ResourceHistory.empty(true));
      for (String field : target.series().keySet()) {
        var points = target.series().get(field);
        long bucket = ((Number) row.get("bucket")).longValue();
        if (!points.isEmpty()) {
          long previous = points.getLast().at();
          for (long missing = previous + step; missing < bucket; missing += step) {
            points.add(new MetricHistoryResponse.Point(missing, null));
          }
        }
        Object value =
            row.get(
                field.equals("input")
                    ? "input_rate"
                    : field.equals("output") ? "output_rate" : field);
        points.add(
            new MetricHistoryResponse.Point(
                bucket, value == null ? null : ((Number) value).doubleValue()));
      }
    }
    return new MetricHistoryResponse(from, to, host, guests);
  }
}
