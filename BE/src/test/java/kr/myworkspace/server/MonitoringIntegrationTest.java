package kr.myworkspace.server;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.Map;
import kr.myworkspace.calendar.holiday.HolidayService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
    properties = "app.password-hash=$2a$04$abcdefghijklmnopqrstuu8lzNzZ2VApOaWVleSkvR0CY5jq8LxOa")
@ActiveProfiles("test")
class MonitoringIntegrationTest {
  @Autowired JsonMapper json;
  @Autowired JdbcTemplate jdbc;
  @Autowired MetricRepository metrics;
  @MockitoBean MonitoringService monitor;
  @MockitoBean HolidayService holidays;

  @Test
  @org.springframework.transaction.annotation.Transactional
  void hourlyHistoryRangesUseTheirOwnWindowsAndAggregation() {
    var actual = new MonitoringService(null, null, metrics, "proxmox");
    actual.snapshot = snapshot(9876);
    long at = System.currentTimeMillis() / 600_000 * 600_000 - 1200_000;
    sample(
        at, "9876", 10, 20, Map.of("inputBytesPerSecond", 100d, "outputBytesPerSecond", 300d), 30d);
    sample(
        at + 60_000,
        "9876",
        30,
        40,
        Map.of("inputBytesPerSecond", 300d, "outputBytesPerSecond", 500d),
        50d);
    for (var entry :
        Map.of("1H", 3600_000L, "6H", 6L * 3600_000, "12H", 12L * 3600_000).entrySet()) {
      var value = json.valueToTree(actual.history(entry.getKey()));
      assertThat(value.path("to").asLong() - value.path("from").asLong())
          .isEqualTo(entry.getValue());
      var guest = value.path("guests").path("lxc-9876");
      if (entry.getKey().equals("1H")) {
        assertThat(guest.path("cpu").size()).isEqualTo(2);
        assertThat(guest.path("cpu").get(0).path("value").asDouble()).isEqualTo(10);
      } else {
        assertThat(guest.path("cpu").size()).isEqualTo(1);
        assertThat(guest.path("cpu").get(0).path("value").asDouble()).isEqualTo(20);
        assertThat(guest.path("input").get(0).path("value").asDouble()).isEqualTo(200);
        assertThat(guest.path("disk").get(0).path("value").asDouble()).isEqualTo(40);
      }
    }
  }

  @Test
  void historyUsesGuestKeysAndRetentionKeepsMinuteSamples() {
    var actual = new MonitoringService(null, null, metrics, "proxmox");
    actual.snapshot = snapshot(42);
    long at = System.currentTimeMillis() / 60_000 * 60_000 - 7200_000;
    sample(
        at, "42", 10, 20, Map.of("inputBytesPerSecond", 100d, "outputBytesPerSecond", 200d), null);
    sample(
        at + 5000,
        "42",
        30,
        40,
        Map.of("inputBytesPerSecond", 300d, "outputBytesPerSecond", 400d),
        null);
    metrics.retain();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from metric_sample where resource_id='42'", Integer.class))
        .isEqualTo(1);
    var value = json.valueToTree(actual.history("1D"));
    assertThat(value.path("guests").path("lxc-42").path("input").get(0).path("value").asDouble())
        .isEqualTo(100);
    assertThat(value.path("guests").path("lxc-42").path("disk").get(0).path("value").isNull())
        .isTrue();
    sample(
        at + 1800_000,
        "42",
        50,
        60,
        Map.of("inputBytesPerSecond", 500d, "outputBytesPerSecond", 600d),
        null);
    var gap = json.valueToTree(actual.history("1D")).path("guests").path("lxc-42").path("cpu");
    assertThat(gap.get(1).path("value").isNull()).isTrue();
  }

  ServerStatusResponse snapshot(int id) {
    return new ServerStatusResponse(
        "proxmox",
        "",
        null,
        null,
        null,
        List.of(),
        List.of(
            new ServerStatusResponse.GuestStatus(
                id, "fixture", "lxc", "running", 0, 0, 0, null, null)));
  }

  void sample(long at, String id, double cpu, double ram, Map<String, Double> net, Double disk) {
    metrics.record(
        List.of(
            new MetricRepository.Sample(
                at,
                id,
                cpu,
                ram,
                new ServerStatusResponse.Network(
                    net.get("inputBytesPerSecond"), net.get("outputBytesPerSecond")),
                disk)));
  }
}
