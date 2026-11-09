package kr.myworkspace;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiIntegrationTest {
  @Test
  @org.springframework.transaction.annotation.Transactional
  void oneCourseSupportsSplitTimesAndIndependentCancellations() throws Exception {
    var table =
        new Timetable(
            java.time.LocalDate.parse("2026-09-01"),
            java.time.LocalDate.parse("2026-12-31"),
            List.of(
                new Course(
                    "split",
                    "TCP/IP",
                    "6406",
                    "교수",
                    1,
                    "09:00",
                    "10:00",
                    List.of(),
                    List.of(
                        new CourseTime("afternoon", 1, "15:00", "16:00", null, List.of()),
                        new CourseTime(
                            "wednesday",
                            3,
                            "11:00",
                            "12:00",
                            null,
                            List.of(java.time.LocalDate.parse("2026-11-11")))))));
    mvc.perform(
            put("/api/timetable")
                .header(Security.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(table)))
        .andExpect(status().isOk());
    var monday =
        mvc.perform(get("/api/today?date=2026-11-09").header(Security.CLIENT_HEADER, LAN))
            .andExpect(status().isOk())
            .andReturn();
    var rows = json.readTree(monday.getResponse().getContentAsString());
    assertThat(rows.size()).isEqualTo(2);
    assertThat(rows.get(0).path("id").asText()).isNotEqualTo(rows.get(1).path("id").asText());
    mvc.perform(get("/api/today?date=2026-11-11").header(Security.CLIENT_HEADER, LAN))
        .andExpect(status().isOk())
        .andExpect(content().json("[]"));
    String invalid = json.writeValueAsString(table).replace("15:00", "09:30");
    mvc.perform(
            put("/api/timetable")
                .header(Security.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(invalid))
        .andExpect(status().isBadRequest());
    assertThat(docs.read("timetable", Timetable.class).courses().getFirst().additionalTimes())
        .hasSize(2);
  }

  @Autowired MockMvc mvc;
  @Autowired JsonMapper json;
  @Autowired Documents docs;
  @Autowired WolService wol;
  @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
  @MockitoBean Monitoring monitor;
  @MockitoBean Holidays holidays;
  @MockitoBean MagicPackets packets;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("app.password-hash", () -> new BCryptPasswordEncoder(4).encode("test-password"));
  }

  static final String LAN = "192.168.1.55", EXT = "198.51.100.55";

  @Test
  @org.springframework.transaction.annotation.Transactional
  void siteNameIsPublicToReadButProtectedAndValidatedToChange() throws Exception {
    mvc.perform(get("/api/site").header(Security.CLIENT_HEADER, EXT))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.siteName").value("MyWorkspace"));
    mvc.perform(put("/api/site").header(Security.CLIENT_HEADER, EXT).with(csrf())
            .contentType("application/json").content("{\"siteName\":\"외부 수정\"}"))
        .andExpect(status().isUnauthorized());
    mvc.perform(put("/api/site").header(Security.CLIENT_HEADER, LAN)
            .contentType("application/json").content("{\"siteName\":\"CSRF 확인\"}"))
        .andExpect(status().isForbidden());
    for (String name : List.of("", "   ", "x".repeat(41), "줄\n바꿈")) {
      mvc.perform(put("/api/site").header(Security.CLIENT_HEADER, LAN).with(csrf())
              .contentType("application/json").content(json.writeValueAsString(Map.of("siteName", name))))
          .andExpect(status().isBadRequest());
    }
    assertThat(docs.read("site-settings", SiteName.class).siteName()).isEqualTo("MyWorkspace");
    mvc.perform(put("/api/site").header(Security.CLIENT_HEADER, LAN).with(csrf())
            .contentType("application/json").content("{\"siteName\":\"  나의 공간  \"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.siteName").value("나의 공간"));
    assertThat(docs.read("site-settings", SiteName.class).siteName()).isEqualTo("나의 공간");
    mvc.perform(get("/api/site").header(Security.CLIENT_HEADER, EXT))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.siteName").value("나의 공간"));
  }

  @Test
  void verifiedNetworkIsCheckedEveryRequestAndNeverSavedAsPasswordSession() throws Exception {
    var session = new MockHttpSession();
    mvc.perform(get("/api/timetable").session(session).header(Security.CLIENT_HEADER, LAN))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").session(session).header(Security.CLIENT_HEADER, EXT))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header("X-Forwarded-For", LAN))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "localhost"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/auth/session").header(Security.CLIENT_HEADER, "198.51.100.10"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authenticated").value(true));
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "198.51.100.10"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "198.51.100.11"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "100.65.70.77"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "100.65.70.78"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "fd7a:115c:a1e0::1234"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").header(Security.CLIENT_HEADER, "fd7a:115c:a1e0::1235"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/api/timetable")
                .header(Security.CLIENT_HEADER, LAN)
                .with(
                    r -> {
                      r.setRemoteAddr("198.51.100.1");
                      return r;
                    }))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void realCsrfLoginRotatesSessionAndLogoutRevokesIt() throws Exception {
    var token = mvc.perform(get("/api/auth/csrf").header(Security.CLIENT_HEADER, EXT)).andReturn();
    var session = (MockHttpSession) token.getRequest().getSession();
    String old = session.getId();
    var csrf = json.readTree(token.getResponse().getContentAsString());
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header(Security.CLIENT_HEADER, EXT)
                .contentType("application/json")
                .content("{\"password\":\"test-password\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header(Security.CLIENT_HEADER, EXT)
                .header(csrf.path("headerName").asText(), csrf.path("token").asText())
                .contentType("application/json")
                .content("{\"password\":\"test-password\"}"))
        .andExpect(status().isOk());
    assertThat(session.getId()).isNotEqualTo(old);
    mvc.perform(get("/api/timetable").session(session).header(Security.CLIENT_HEADER, EXT))
        .andExpect(status().isOk());
    mvc.perform(post("/api/auth/logout").session(session).with(csrf())).andExpect(status().isOk());
    assertThat(session.isInvalid()).isTrue();
  }

  @Test
  void csrfAlsoProtectsTrustedNetworkAndPasswordAttemptsAreLimited() throws Exception {
    mvc.perform(
            put("/api/wol/devices")
                .header(Security.CLIENT_HEADER, LAN)
                .contentType("application/json")
                .content("[]"))
        .andExpect(status().isForbidden());
    for (int i = 0; i < 5; i++)
      mvc.perform(
              post("/api/auth/login")
                  .header(Security.CLIENT_HEADER, "198.51.100.99")
                  .with(csrf())
                  .contentType("application/json")
                  .content("{\"password\":\"wrong\"}"))
          .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/auth/login")
                .header(Security.CLIENT_HEADER, "198.51.100.99")
                .with(csrf())
                .contentType("application/json")
                .content("{\"password\":\"test-password\"}"))
        .andExpect(status().isTooManyRequests());
  }

  @Test
  void eventsAreStoredAndInvalidTimesAreRejected() throws Exception {
    String event =
        "{\"calendarId\":\"cal-icloud\",\"title\":\"저장"
            + " 검증\",\"date\":\"2026-11-06\",\"allDay\":false,\"start\":\"09:00\",\"end\":\"10:00\"}";
    var created =
        mvc.perform(
                post("/api/calendar/events")
                    .header(Security.CLIENT_HEADER, LAN)
                    .with(csrf())
                    .contentType("application/json")
                    .content(event))
            .andExpect(status().isOk())
            .andReturn();
    String id = json.readTree(created.getResponse().getContentAsString()).path("id").asText();
    mvc.perform(
            get("/api/calendar/events?from=2026-11-06&to=2026-11-06")
                .header(Security.CLIENT_HEADER, LAN))
        .andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("저장 검증")));
    mvc.perform(
            put("/api/calendar/events/" + id)
                .header(Security.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(event.replace("10:00", "08:00")))
        .andExpect(status().isBadRequest());
    mvc.perform(
            delete("/api/calendar/events/" + id).header(Security.CLIENT_HEADER, LAN).with(csrf()))
        .andExpect(status().isOk());
    mvc.perform(
            get("/api/calendar/events?from=2026-11-06&to=2028-01-01")
                .header(Security.CLIENT_HEADER, LAN))
        .andExpect(status().isBadRequest());
  }

  @Test
  void wolUsesSavedMacAndCooldownSurvivesASecondRequest() throws Exception {
    wol.save(List.of(new WolDevice("test-pc", "테스트 PC", "02-12-34-56-78-9a")));
    mvc.perform(
            post("/api/wol/devices/test-pc/wake").header(Security.CLIENT_HEADER, LAN).with(csrf()))
        .andExpect(status().isOk());
    verify(packets).send("02:12:34:56:78:9A");
    mvc.perform(get("/api/wol/devices/test-pc/boot").header(Security.CLIENT_HEADER, LAN))
        .andExpect(status().isNotFound());
    mvc.perform(
            post("/api/wol/devices/test-pc/wake").header(Security.CLIENT_HEADER, LAN).with(csrf()))
        .andExpect(status().isTooManyRequests());
    mvc.perform(
            put("/api/wol/devices")
                .header(Security.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(
                    "[{\"id\":\"1\",\"name\":\"a\",\"mac\":\"02123456789a\"},{\"id\":\"2\",\"name\":\"b\",\"mac\":\"02:12:34:56:78:9A\"}]"))
        .andExpect(status().isBadRequest());
    assertThat(wol.list()).hasSize(1);
    assertThat(wol.list().getFirst().id()).isEqualTo("test-pc");
    byte[] packet = MagicPackets.packet("02:12:34:56:78:9A");
    assertThat(packet).hasSize(102);
    assertThat(Arrays.copyOfRange(packet, 0, 6)).containsOnly((byte) 0xff);
    assertThat(Arrays.copyOfRange(packet, 96, 102))
        .containsExactly((byte) 2, (byte) 0x12, (byte) 0x34, (byte) 0x56, (byte) 0x78, (byte) 0x9a);
  }

  @Test
  void timetableRejectsOverlapsAndKeepsPreviousValue() throws Exception {
    String before = docs.repository.findById("timetable").orElseThrow().payload;
    String course =
        "{\"id\":\"%s\",\"name\":\"수업\",\"room\":\"101\",\"weekday\":1,\"start\":\"09:00\",\"end\":\"10:00\",\"cancelledDates\":[]}";
    String input =
        "{\"semesterStart\":\"2026-09-01\",\"semesterEnd\":\"2026-12-31\",\"courses\":["
            + course.formatted("a")
            + ","
            + course.formatted("b")
            + "]}";
    mvc.perform(
            put("/api/timetable")
                .header(Security.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(input))
        .andExpect(status().isBadRequest());
    assertThat(docs.repository.findById("timetable").orElseThrow().payload).isEqualTo(before);
  }

  @Test
  @org.springframework.transaction.annotation.Transactional
  void hourlyHistoryRangesUseTheirOwnWindowsAndAggregation() {
    var actual = new Monitoring(docs, jdbc, "", "", "proxmox", "", "", "");
    actual.snapshot = Map.of("guests", List.of(Map.of("id", 9876, "type", "lxc")));
    long at = System.currentTimeMillis() / 600_000 * 600_000 - 1200_000;
    actual.sample(
        at, "9876", 10, 20,
        Map.of("inputBytesPerSecond", 100d, "outputBytesPerSecond", 300d), 30d);
    actual.sample(
        at + 60_000, "9876", 30, 40,
        Map.of("inputBytesPerSecond", 300d, "outputBytesPerSecond", 500d), 50d);
    for (var entry :
        Map.of("1H", 3600_000L, "6H", 6L * 3600_000, "12H", 12L * 3600_000).entrySet()) {
      var value = docs.json.valueToTree(actual.history(entry.getKey()));
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
    var actual = new Monitoring(docs, jdbc, "", "", "proxmox", "", "", "");
    actual.snapshot = Map.of("guests", List.of(Map.of("id", 42, "type", "lxc")));
    long at = System.currentTimeMillis() / 60_000 * 60_000 - 7200_000;
    actual.sample(
        at, "42", 10, 20, Map.of("inputBytesPerSecond", 100d, "outputBytesPerSecond", 200d), null);
    actual.sample(
        at + 5000,
        "42",
        30,
        40,
        Map.of("inputBytesPerSecond", 300d, "outputBytesPerSecond", 400d),
        null);
    actual.retain();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from metric_sample where resource_id='42'", Integer.class))
        .isEqualTo(1);
    var value = docs.json.valueToTree(actual.history("1D"));
    assertThat(value.path("guests").path("lxc-42").path("input").get(0).path("value").asDouble())
        .isEqualTo(100);
    assertThat(value.path("guests").path("lxc-42").path("disk").get(0).path("value").isNull())
        .isTrue();
    actual.sample(
        at + 1800_000,
        "42",
        50,
        60,
        Map.of("inputBytesPerSecond", 500d, "outputBytesPerSecond", 600d),
        null);
    var gap = docs.json.valueToTree(actual.history("1D")).path("guests").path("lxc-42").path("cpu");
    assertThat(gap.get(1).path("value").isNull()).isTrue();
  }

  @Test
  void retiredLegacyImportIsUnavailable() throws Exception {
    mvc.perform(
            post("/api/import/legacy")
                .header(Security.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content("{}"))
        .andExpect(status().isNotFound());
  }
}
