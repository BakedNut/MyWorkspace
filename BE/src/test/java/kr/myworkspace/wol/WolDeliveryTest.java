package kr.myworkspace.wol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.concurrent.Executors;
import kr.myworkspace.calendar.holiday.HolidayService;
import kr.myworkspace.common.error.ApiException;
import kr.myworkspace.server.MonitoringService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(
    properties = "app.password-hash=$2a$04$abcdefghijklmnopqrstuu8lzNzZ2VApOaWVleSkvR0CY5jq8LxOa")
@ActiveProfiles("test")
class WolDeliveryTest {
  @Autowired WolService wol;
  @MockitoBean MonitoringService monitor;
  @MockitoBean HolidayService holidays;
  @MockitoBean MagicPacketSender packets;
  @MockitoSpyBean JdbcTemplate jdbc;

  @Test
  void reservationFailurePreventsPacketAndSendFailureStillReservesCooldown() {
    wol.save(List.of(new WolDevice("db-failure", "fixture", "02:12:34:56:78:9A")));
    doThrow(new org.springframework.dao.DataAccessResourceFailureException("fixture"))
        .when(jdbc)
        .update(
            eq("insert into wol_request(device_id,sent_at) values(?,?)"),
            eq("db-failure"),
            anyLong());
    assertThatThrownBy(() -> wol.wake("db-failure"))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    verifyNoInteractions(packets);
    wol.save(List.of(new WolDevice("send-failure", "fixture", "02:12:34:56:78:9A")));
    doThrow(new ApiException(503, "NETWORK", "fixture")).when(packets).send(anyString());
    assertThatThrownBy(() -> wol.wake("send-failure")).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> wol.wake("send-failure"))
        .isInstanceOf(ApiException.class)
        .satisfies(e -> assertThat(((ApiException) e).code()).isEqualTo("RATE_LIMITED"));
    verify(packets, times(1)).send(anyString());
  }

  @Test
  void concurrentRequestsSendOnlyOnce() throws Exception {
    wol.save(List.of(new WolDevice("concurrent", "fixture", "02:12:34:56:78:9A")));
    try (var pool = Executors.newFixedThreadPool(2)) {
      var results = pool.invokeAll(List.of(() -> wake("concurrent"), () -> wake("concurrent")));
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
          .containsExactlyInAnyOrder("sent", "RATE_LIMITED");
    }
    verify(packets, times(1)).send("02:12:34:56:78:9A");
  }

  String wake(String id) {
    try {
      wol.wake(id);
      return "sent";
    } catch (ApiException error) {
      return error.code();
    }
  }
}
