package kr.myworkspace.calendar.event;

import static org.assertj.core.api.Assertions.*;

import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.Executors;
import kr.myworkspace.calendar.holiday.HolidayService;
import kr.myworkspace.common.error.ApiException;
import kr.myworkspace.server.MonitoringService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@ActiveProfiles("test")
class LocalEventConcurrencyTest {
  @Autowired LocalEventStore events;
  @MockitoBean MonitoringService monitoring;
  @MockitoBean HolidayService holidays;

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry p) {
    p.add(
        "spring.datasource.url",
        () -> "jdbc:h2:mem:local-concurrency;MODE=MySQL;DB_CLOSE_DELAY=-1");
    p.add(
        "app.password-hash",
        () ->
            new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(4).encode("test"));
  }

  @Test
  void onlyOneWriterCanConsumeTheSameRevisionAndStaleDeleteIsRejected() throws Exception {
    var date = LocalDate.of(2026, 11, 12);
    var created =
        events.save(
            null, new EventInput("cal-icloud", "original", date, true, null, null, null, null));
    String id = (String) created.get("id"), revision = (String) created.get("revision");
    try (var pool = Executors.newFixedThreadPool(2)) {
      var results =
          pool.invokeAll(
              List.of(
                  () -> update(id, revision, "first", date),
                  () -> update(id, revision, "second", date)));
      assertThat(
              results.stream()
                  .map(
                      f -> {
                        try {
                          return f.get();
                        } catch (Exception e) {
                          throw new RuntimeException(e);
                        }
                      })
                  .toList())
          .containsExactlyInAnyOrder("saved", "CONFLICT");
    }
    assertThatThrownBy(() -> events.delete(id, revision)).isInstanceOf(ApiException.class);
    var current =
        events.list(date, date).stream()
            .filter(e -> id.equals(e.get("id")))
            .findFirst()
            .orElseThrow();
    events.delete(id, (String) current.get("revision"));
  }

  String update(String id, String revision, String title, LocalDate date) {
    try {
      events.save(
          id,
          new EventInput("cal-icloud", title, date, true, null, null, null, null, revision, null));
      return "saved";
    } catch (ApiException e) {
      return e.code();
    }
  }
}
