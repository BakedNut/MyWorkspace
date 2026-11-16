package kr.myworkspace.calendar.icloud;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import kr.myworkspace.auth.SecurityConfig;
import kr.myworkspace.calendar.event.EventInput;
import kr.myworkspace.calendar.holiday.HolidayService;
import kr.myworkspace.common.error.ApiException;
import kr.myworkspace.shortcuts.ShortcutBoard;
import kr.myworkspace.wol.MagicPacketSender;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "MYSQL_TEST_URL", matches = ".+")
class MySqlIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired JsonMapper json;
  @Autowired Flyway flyway;
  @Autowired JdbcTemplate jdbc;
  @Autowired ICloudCacheRepository cache;
  @Autowired TransactionTemplate transactions;
  @MockitoBean HolidayService holidays;
  @MockitoBean MagicPacketSender packets;
  static final String LAN = "192.168.1.55";

  @Test
  void migrationsAndConcurrentCalendarAndWolRequestsUseRealMysqlLocks() throws Exception {
    assertThat(flyway.info().applied()).hasSize(9);
    var date = LocalDate.of(2026, 11, 12);
    var input = new EventInput("cal-icloud", "original", date, true, null, null, null, null);
    var created =
        mvc.perform(
                post("/api/calendar/events")
                    .header(SecurityConfig.CLIENT_HEADER, LAN)
                    .with(csrf())
                    .contentType("application/json")
                    .content(json.writeValueAsString(input)))
            .andExpect(status().isOk())
            .andReturn();
    var event = json.readTree(created.getResponse().getContentAsString());
    String id = event.path("id").asText(), revision = event.path("revision").asText();
    Callable<Integer> first = () -> update(id, revision, "first", date);
    Callable<Integer> second = () -> update(id, revision, "second", date);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var result = pool.invokeAll(List.of(first, second));
      assertThat(
              List.of(
                  result.get(0).get(10, TimeUnit.SECONDS), result.get(1).get(10, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(200, 409);
    }
    mvc.perform(
            delete("/api/calendar/events/" + id)
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .header("If-Match", revision)
                .with(csrf()))
        .andExpect(status().isConflict());
    String current =
        jdbc.queryForObject("select version from calendar_event where id=?", Long.class, id)
            .toString();
    mvc.perform(
            delete("/api/calendar/events/" + id)
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .header("If-Match", current)
                .with(csrf()))
        .andExpect(status().isOk());
    mvc.perform(
            put("/api/wol/devices")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(
                    "[{\"id\":\"mysql-pc\",\"name\":\"fixture\",\"mac\":\"02:12:34:56:78:9A\"}]"))
        .andExpect(status().isOk());
    try (var pool = Executors.newFixedThreadPool(2)) {
      var result = pool.invokeAll(List.of((Callable<Integer>) this::wake, this::wake));
      assertThat(
              List.of(
                  result.get(0).get(10, TimeUnit.SECONDS), result.get(1).get(10, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(200, 429);
    }
    verify(packets, times(1)).send("02:12:34:56:78:9A");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from wol_request where device_id='mysql-pc'", Integer.class))
        .isEqualTo(1);
  }

  @Test
  void shortcutEditsUseTheDocumentLockAndRejectStaleRevisions() throws Exception {
    var response =
        mvc.perform(get("/api/shortcuts").header(SecurityConfig.CLIENT_HEADER, LAN))
            .andExpect(status().isOk())
            .andReturn();
    long revision =
        json.readTree(response.getResponse().getContentAsString()).path("revision").asLong();
    try (var pool = Executors.newFixedThreadPool(2)) {
      var results =
          pool.invokeAll(
              List.of(
                  (Callable<Integer>) () -> saveShortcuts(revision, "first"),
                  () -> saveShortcuts(revision, "second")));
      assertThat(
              List.of(
                  results.get(0).get(10, TimeUnit.SECONDS),
                  results.get(1).get(10, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(200, 409);
    }
    mvc.perform(get("/api/shortcuts").header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.revision").value(revision + 1));
  }

  @Test
  void cachedIconBytesAreReadFromRealMysqlWithoutFetchingTheSite() throws Exception {
    var response =
        mvc.perform(get("/api/shortcuts").header(SecurityConfig.CLIENT_HEADER, LAN))
            .andExpect(status().isOk())
            .andReturn();
    long revision =
        json.readTree(response.getResponse().getContentAsString()).path("revision").asLong();
    assertThat(saveShortcuts(revision, "icon fixture")).isEqualTo(200);
    String key =
        java.util.HexFormat.of()
            .formatHex(
                java.security.MessageDigest.getInstance("SHA-256")
                    .digest(
                        "https://example.com/".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    byte[] bytes = {7, 8, 9};
    jdbc.update(
        "insert into shortcut_icon(site_key,media_type,image_bytes,checked_at) values(?,?,?,?)",
        key,
        "image/png",
        bytes,
        System.currentTimeMillis());
    var image =
        mvc.perform(
                get("/api/shortcuts/icons/mysql-link").header(SecurityConfig.CLIENT_HEADER, LAN))
            .andReturn();
    image.getAsyncResult(5000);
    mvc.perform(asyncDispatch(image)).andExpect(status().isOk()).andExpect(content().bytes(bytes));
  }

  int saveShortcuts(long revision, String name) throws Exception {
    var board =
        new ShortcutBoard(
            revision,
            List.of(
                new ShortcutBoard.Group(
                    "mysql-links",
                    name,
                    false,
                    List.of(new ShortcutBoard.Link("mysql-link", name, "https://example.com/")))));
    return mvc.perform(
            put("/api/shortcuts")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(board)))
        .andReturn()
        .getResponse()
        .getStatus();
  }

  int update(String id, String revision, String title, LocalDate date) throws Exception {
    return mvc.perform(
            put("/api/calendar/events/" + id)
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(
                    json.writeValueAsString(
                        new EventInput(
                            "cal-icloud",
                            title,
                            date,
                            true,
                            null,
                            null,
                            null,
                            null,
                            revision,
                            null))))
        .andReturn()
        .getResponse()
        .getStatus();
  }

  int wake() throws Exception {
    return mvc.perform(
            post("/api/wol/devices/mysql-pc/wake")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf()))
        .andReturn()
        .getResponse()
        .getStatus();
  }

  @Test
  void cacheDatesBooleansAndNativeMetricAggregationKeepTheirContracts() throws Exception {
    var date = LocalDate.of(2026, 11, 12);
    var calendar =
        new CloudCalendar("fixture", "fixture", "https://p01-caldav.icloud.com/home/", false);
    var state = new CloudState(null, calendar, null, null);
    var resource =
        new CloudResource(
            calendar.href() + "fixture.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "mysql cache", date, true, null, null, null, null),
                null));
    var events = ICalendarMapper.expand(resource, date, date, false);
    transactions.executeWithoutResult(
        tx -> cache.cache(date, date, events, List.of(resource), state));
    assertThat(cache.read(date, date)).hasSize(1);
    transactions.executeWithoutResult(
        tx -> {
          cache.markStale();
          cache.patch(
              resource.href(),
              List.of(
                  Map.of(
                      "id",
                      "icloud-" + CalDavClient.id(resource.href()) + "-0123456789ab",
                      "date",
                      date.toString(),
                      "title",
                      "patched")));
        });
    assertThat(cache.lookup(date, date).stale()).isTrue();
    assertThat(cache.read(date, date)).extracting(e -> e.get("title")).containsExactly("patched");

    assertThat(cache.ranges().getFirst()).containsExactly(date, date);
    String id = "icloud-" + CalDavClient.id(resource.href()) + "-0123456789ab";
    assertThat(cache.resource(id)).containsEntry("etag", "v1");
    var readOnly =
        new CloudState(
            null,
            new CloudCalendar(calendar.id(), calendar.name(), calendar.href(), true),
            null,
            null);
    transactions.executeWithoutResult(
        tx -> cache.cache(date, date, events, List.of(resource), readOnly));
    assertThatThrownBy(() -> cache.resource(id)).isInstanceOf(ApiException.class);
    long at = System.currentTimeMillis() / 60000 * 60000 - 120000;
    for (int cpu : List.of(10, 20))
      jdbc.update(
          "insert into"
              + " metric_sample(sampled_at,resource_id,cpu,ram,net_input,net_output,disk,keep_minute)"
              + " values(?,?,?,?,?,?,?,?)",
          at + cpu,
          "host",
          cpu,
          50,
          100,
          200,
          null,
          true);
    var history =
        mvc.perform(get("/api/server/history?range=1H").header(SecurityConfig.CLIENT_HEADER, LAN))
            .andExpect(status().isOk())
            .andReturn();
    var value = json.readTree(history.getResponse().getContentAsString());
    assertThat(value.path("host").path("cpu").get(0).path("value").asDouble()).isEqualTo(15);
    assertThat(value.path("host").has("disk")).isFalse();
    assertThat(value.path("host").path("input").get(0).path("value").asDouble()).isEqualTo(100);
  }
}
