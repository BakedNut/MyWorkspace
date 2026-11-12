package kr.myworkspace.calendar.icloud;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import kr.myworkspace.calendar.event.EventInput;
import kr.myworkspace.calendar.holiday.HolidayService;
import kr.myworkspace.common.crypto.SecretCipher;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.server.MonitoringService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
@ActiveProfiles("test")
class ICloudConcurrencyTest {
  @Autowired org.springframework.test.web.servlet.MockMvc mvc;
  @Autowired ICloudService service;
  @Autowired ICloudSyncService sync;
  @Autowired ICloudCoordinator coordinator;
  @Autowired DocumentStore docs;
  @Autowired SecretCipher secrets;
  @Autowired JsonMapper json;
  @MockitoSpyBean ICloudCacheRepository cache;
  @MockitoBean CalDavClient dav;
  @MockitoBean MonitoringService monitoring;
  @MockitoBean HolidayService holidays;

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry properties) {
    properties.add(
        "spring.datasource.url",
        () -> "jdbc:h2:mem:cloud-concurrency;MODE=MySQL;DB_CLOSE_DELAY=-1");
    properties.add(
        "app.password-hash",
        () ->
            new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(4).encode("test"));
    properties.add(
        "app.icloud-key-file",
        () -> System.getProperty("java.io.tmpdir") + "/pr3-cloud-concurrency.key");
  }

  CloudState connected() {
    var value =
        new CloudState(
            secrets.encrypt(
                json.writeValueAsString(
                    new CloudAccount("fixture@example.com", "abcd-efgh-ijkl-mnop"))),
            new CloudCalendar("fixture", "fixture", "https://p01-caldav.icloud.com/home/", false),
            null,
            null);
    docs.save("icloud", value);
    return value;
  }

  @Test
  void delayedIoAllowsCachedReadsAndDisconnectAndCannotRestoreOldState() throws Exception {
    service.disconnect();
    var state = connected();
    var date = LocalDate.of(2026, 11, 12);
    cache.cache(
        date, date, List.of(Map.of("date", date.toString(), "title", "cached")), List.of(), state);
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    when(dav.query(any(), any(), any(), any()))
        .thenAnswer(
            call -> {
              assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
              entered.countDown();
              assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
              return List.of();
            });
    try (var pool = Executors.newFixedThreadPool(3)) {
      var refresh = pool.submit(() -> sync.refresh(date, date));
      try {
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(pool.submit(() -> service.list(date, date)).get(1, TimeUnit.SECONDS)).hasSize(1);
        pool.submit(() -> service.disconnect()).get(1, TimeUnit.SECONDS);
      } finally {
        release.countDown();
      }
      refresh.get(2, TimeUnit.SECONDS);
    }
    assertThat(coordinator.read().calendar()).isNull();
    assertThat(cache.read(date, date)).isEmpty();
  }

  @Test
  void remoteSuccessSurvivesCacheFailureAndSchedulesFreshData() throws Exception {
    service.disconnect();
    connected();
    var input =
        new EventInput(
            "cal-remote", "saved", LocalDate.of(2026, 11, 12), true, null, null, null, null);
    when(dav.send(any(), any(), eq("PUT"), any(), any()))
        .thenAnswer(
            call -> {
              assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
              return new DavReply(
                  201,
                  java.net.URI.create("https://p01-caldav.icloud.com/home/new.ics"),
                  java.net.http.HttpHeaders.of(Map.of("ETag", List.of("v1")), (a, b) -> true),
                  "");
            });
    doThrow(new org.springframework.dao.DataAccessResourceFailureException("fixture"))
        .when(cache)
        .markStale();
    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                    "/api/calendar/events")
                .header(kr.myworkspace.auth.SecurityConfig.CLIENT_HEADER, "192.168.1.55")
                .with(
                    org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(input)))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.title")
                .value("saved"));
    assertThat(coordinator.cacheDirty).isTrue();
  }

  @Test
  void freshCoveringRangeDoesNotQueueAnotherCalDavRequest() throws Exception {
    service.disconnect();
    var state = connected();
    var date = LocalDate.of(2026, 11, 12);
    cache.cache(
        date.minusDays(7),
        date.plusDays(40),
        List.of(Map.of("date", date.toString(), "title", "cached")),
        List.of(),
        state);
    assertThat(service.list(date, date)).hasSize(1);
    sync.worker.submit(() -> {}).get(5, TimeUnit.SECONDS);
    verifyNoInteractions(dav);
  }

  @Test
  void savingThenImmediatelyReadingPreservesOtherEventsUntilDelayedRefreshCompletes()
      throws Exception {
    service.disconnect();
    var state = connected();
    var date = LocalDate.of(2026, 11, 12);
    String href = state.calendar().href() + "first.ics";
    var first =
        new CloudResource(
            href,
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "old", date, true, null, null, null, null), null));
    var other =
        new CloudResource(
            state.calendar().href() + "other.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "other", date, true, null, null, null, null), null));
    var old = ICalendarMapper.expandResources(List.of(first, other), date, date, false);
    cache.cache(date, date, old, List.of(first, other), state);
    var input =
        new EventInput("cal-remote", "changed", date, true, null, null, null, null, "v1", null);
    var changed = new CloudResource(href, "v2", ICalendarMapper.write(input, first.content()));
    var added =
        new CloudResource(
            state.calendar().href() + "added.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "remote added", date, true, null, null, null, null),
                null));
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    doReturn(
            new DavReply(
                200,
                java.net.URI.create(href),
                java.net.http.HttpHeaders.of(Map.of("ETag", List.of("v1")), (a, b) -> true),
                first.content()))
        .when(dav)
        .send(any(), any(), eq("GET"), any(), any());
    doReturn(
            new DavReply(
                204,
                java.net.URI.create(href),
                java.net.http.HttpHeaders.of(Map.of("ETag", List.of("v2")), (a, b) -> true),
                ""))
        .when(dav)
        .send(any(), any(), eq("PUT"), any(), any());
    when(dav.query(any(), any(), any(), any()))
        .thenAnswer(
            call -> {
              entered.countDown();
              assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
              return List.of(changed, other, added);
            });
    String id =
        old.stream()
            .filter(e -> "old".equals(e.get("title")))
            .map(e -> (String) e.get("id"))
            .findFirst()
            .orElseThrow();
    assertThat(service.save(id, input)).containsEntry("title", "changed");
    try {
      assertThat(service.list(date, date))
          .extracting(e -> e.get("title"))
          .containsExactlyInAnyOrder("changed", "other");
      assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
      assertThat(service.list(date, date)).hasSize(2);
    } finally {
      release.countDown();
    }
    sync.worker.submit(() -> {}).get(5, TimeUnit.SECONDS);
    assertThat(service.list(date, date))
        .extracting(e -> e.get("title"))
        .containsExactlyInAnyOrder("changed", "other", "remote added");
  }

  @Test
  void deletingKeepsUnrelatedCachedEvents() throws Exception {
    service.disconnect();
    var state = connected();
    var date = LocalDate.of(2026, 11, 12);
    var removed =
        new CloudResource(
            state.calendar().href() + "removed.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "removed", date, true, null, null, null, null), null));
    var other =
        new CloudResource(
            state.calendar().href() + "kept.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "kept", date, true, null, null, null, null), null));
    var events = ICalendarMapper.expandResources(List.of(removed, other), date, date, false);
    cache.cache(date, date, events, List.of(removed, other), state);
    String id = (String) events.getFirst().get("id");
    doReturn(
            new DavReply(
                204,
                java.net.URI.create(removed.href()),
                java.net.http.HttpHeaders.of(Map.of(), (a, b) -> true),
                ""))
        .when(dav)
        .send(any(), any(), eq("DELETE"), any(), any());
    service.delete(id, "v1");
    assertThat(cache.read(date, date)).extracting(e -> e.get("title")).containsExactly("kept");
  }

  @Test
  void manualSyncFailsIfEarlierRangeFailsAndLaterRangeSucceedsAndRecoversOnRetry()
      throws Exception {
    service.disconnect();
    var state = connected();
    var first = LocalDate.of(2026, 11, 12);
    var second = first.plusMonths(1);
    cache.cache(
        first,
        first,
        List.of(Map.of("date", first.toString(), "title", "old first")),
        List.of(),
        state);
    cache.cache(
        second,
        second,
        List.of(Map.of("date", second.toString(), "title", "old second")),
        List.of(),
        state);
    doReturn(List.<LocalDate[]>of(new LocalDate[] {first, first}, new LocalDate[] {second, second}))
        .when(cache)
        .ranges();
    var firstResource =
        new CloudResource(
            state.calendar().href() + "first.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput("cal-remote", "updated first", first, true, null, null, null, null),
                null));
    var secondResource =
        new CloudResource(
            state.calendar().href() + "second.ics",
            "v1",
            ICalendarMapper.write(
                new EventInput(
                    "cal-remote", "updated second", second, true, null, null, null, null),
                null));
    doThrow(new kr.myworkspace.common.error.ApiException(503, "NETWORK", "fixture failure"))
        .when(dav)
        .query(any(), any(), eq(first), eq(first));
    doReturn(List.of(secondResource)).when(dav).query(any(), any(), eq(second), eq(second));

    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                    "/api/calendar/icloud/sync")
                .header(kr.myworkspace.auth.SecurityConfig.CLIENT_HEADER, "192.168.1.55")
                .with(
                    org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.csrf()))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                .isServiceUnavailable())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.code")
                .value("NETWORK"));
    assertThat(coordinator.read().error()).contains("일부");
    var ordered = inOrder(dav);
    ordered.verify(dav).query(any(), any(), eq(first), eq(first));
    ordered.verify(dav).query(any(), any(), eq(second), eq(second));
    assertThat(cache.read(first, first))
        .extracting(e -> e.get("title"))
        .containsExactly("old first");
    assertThat(cache.read(second, second))
        .extracting(e -> e.get("title"))
        .containsExactly("updated second");

    doReturn(List.of(firstResource)).when(dav).query(any(), any(), eq(first), eq(first));
    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                    "/api/calendar/icloud/sync")
                .header(kr.myworkspace.auth.SecurityConfig.CLIENT_HEADER, "192.168.1.55")
                .with(
                    org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.csrf()))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    assertThat(cache.read(first, first))
        .extracting(e -> e.get("title"))
        .containsExactly("updated first");
    assertThat(coordinator.read().error()).isNull();
  }

  @Test
  void manualSyncWaitsForAnExistingFullSync() throws Exception {
    waitsForExistingRefresh(true);
  }

  @Test
  void manualSyncWaitsForAnExistingRangeRefresh() throws Exception {
    waitsForExistingRefresh(false);
  }

  void waitsForExistingRefresh(boolean fullSync) throws Exception {
    service.disconnect();
    var state = connected();
    var date = LocalDate.of(2026, 11, 12);
    cache.cache(date, date, List.of(), List.of(), state);
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var requested = new CountDownLatch(1);
    when(dav.query(any(), any(), any(), any()))
        .thenAnswer(
            call -> {
              entered.countDown();
              assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
              return List.of();
            });
    try (var pool = Executors.newFixedThreadPool(2)) {
      java.util.concurrent.Future<?> refresh =
          fullSync ? pool.submit(() -> sync.sync()) : pool.submit(() -> sync.refresh(date, date));
      assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
      var manual =
          pool.submit(
              () -> {
                requested.countDown();
                return service.syncNow(false);
              });
      try {
        assertThat(requested.await(2, TimeUnit.SECONDS)).isTrue();
        assertThatThrownBy(() -> manual.get(150, TimeUnit.MILLISECONDS))
            .isInstanceOf(java.util.concurrent.TimeoutException.class);
      } finally {
        release.countDown();
      }
      manual.get(3, TimeUnit.SECONDS);
      refresh.get(3, TimeUnit.SECONDS);
    }
    assertThat(coordinator.read().lastSyncedAt()).isNotNull();
    verify(dav, times(1)).query(any(), any(), any(), any());
  }
}
