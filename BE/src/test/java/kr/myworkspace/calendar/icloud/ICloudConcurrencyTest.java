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
      var refresh = pool.submit(() -> service.refresh(date, date));
      try {
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(pool.submit(() -> service.list(date, date)).get(1, TimeUnit.SECONDS)).hasSize(1);
        pool.submit(() -> service.disconnect()).get(1, TimeUnit.SECONDS);
      } finally {
        release.countDown();
      }
      refresh.get(2, TimeUnit.SECONDS);
    }
    assertThat(service.state().calendar()).isNull();
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
        .invalidate();
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
    assertThat(service.cacheDirty).isTrue();
  }
}
