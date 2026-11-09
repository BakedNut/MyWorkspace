package kr.myworkspace;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.Map;
import kr.myworkspace.auth.SecurityConfig;
import kr.myworkspace.calendar.CalendarVisibility;
import kr.myworkspace.calendar.Course;
import kr.myworkspace.calendar.CourseTime;
import kr.myworkspace.calendar.HolidayService;
import kr.myworkspace.calendar.Timetable;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.server.MonitoringService;
import kr.myworkspace.settings.SiteName;
import kr.myworkspace.wol.MagicPacketSender;
import kr.myworkspace.wol.WolDevice;
import kr.myworkspace.wol.WolService;
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
  void healthEndpointRemainsPublicAfterMovingToCommonWeb() throws Exception {
    mvc.perform(get("/api/health").header(SecurityConfig.CLIENT_HEADER, EXT))
        .andExpect(status().isOk())
        .andExpect(content().json("{\"status\":\"ok\"}"));
  }

  @Test
  @org.springframework.transaction.annotation.Transactional
  void calendarVisibilityPersistsAcrossRequestsAndRequiresAuthenticationAndCsrf() throws Exception {
    mvc.perform(get("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, EXT))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(content().json("{\"hiddenCalendarIds\":[]}"));
    String input = "{\"hiddenCalendarIds\":[\"__school\",\"cal-remote\"]}";
    mvc.perform(put("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, EXT).with(csrf())
            .contentType("application/json").content(input))
        .andExpect(status().isUnauthorized());
    mvc.perform(put("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN)
            .contentType("application/json").content(input))
        .andExpect(status().isForbidden());
    for (String invalid : List.of("{}", "{\"hiddenCalendarIds\":null}",
        "{\"hiddenCalendarIds\":[\"\"]}",
        json.writeValueAsString(Map.of("hiddenCalendarIds", List.of("x".repeat(65)))),
        json.writeValueAsString(Map.of("hiddenCalendarIds",
            java.util.stream.IntStream.range(0, 101).mapToObj(i -> "cal-" + i).toList())))) {
      mvc.perform(put("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf())
              .contentType("application/json").content(invalid))
          .andExpect(status().isBadRequest());
    }
    assertThat(docs.read("calendar-visibility", CalendarVisibility.class).hiddenCalendarIds()).isEmpty();
    mvc.perform(put("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf())
            .contentType("application/json").content(input))
        .andExpect(status().isOk()).andExpect(content().json(input));
    assertThat(docs.read("calendar-visibility", CalendarVisibility.class).hiddenCalendarIds())
        .containsExactlyInAnyOrder("__school", "cal-remote");
    mvc.perform(get("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isOk()).andExpect(content().json(input));
    mvc.perform(put("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf())
            .contentType("application/json").content("{\"hiddenCalendarIds\":[]}"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/calendar/visibility").header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(content().json("{\"hiddenCalendarIds\":[]}"));
  }

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
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(table)))
        .andExpect(status().isOk());
    var monday =
        mvc.perform(get("/api/today?date=2026-11-09").header(SecurityConfig.CLIENT_HEADER, LAN))
            .andExpect(status().isOk())
            .andReturn();
    var rows = json.readTree(monday.getResponse().getContentAsString());
    assertThat(rows.size()).isEqualTo(2);
    assertThat(rows.get(0).path("id").asText()).isNotEqualTo(rows.get(1).path("id").asText());
    mvc.perform(get("/api/today?date=2026-11-11").header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isOk())
        .andExpect(content().json("[]"));
    String invalid = json.writeValueAsString(table).replace("15:00", "09:30");
    mvc.perform(
            put("/api/timetable")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(invalid))
        .andExpect(status().isBadRequest());
    assertThat(docs.read("timetable", Timetable.class).courses().getFirst().additionalTimes())
        .hasSize(2);
  }

  @Autowired MockMvc mvc;
  @Autowired JsonMapper json;
  @Autowired DocumentStore docs;
  @Autowired WolService wol;
  @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
  @MockitoBean MonitoringService monitor;
  @MockitoBean HolidayService holidays;
  @MockitoBean MagicPacketSender packets;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("app.password-hash", () -> new BCryptPasswordEncoder(4).encode("test-password"));
  }

  static final String LAN = "192.168.1.55", EXT = "198.51.100.55";

  @Test
  @org.springframework.transaction.annotation.Transactional
  void siteNameIsPublicToReadButProtectedAndValidatedToChange() throws Exception {
    mvc.perform(get("/api/site").header(SecurityConfig.CLIENT_HEADER, EXT))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.siteName").value("MyWorkspace"));
    mvc.perform(put("/api/site").header(SecurityConfig.CLIENT_HEADER, EXT).with(csrf())
            .contentType("application/json").content("{\"siteName\":\"외부 수정\"}"))
        .andExpect(status().isUnauthorized());
    mvc.perform(put("/api/site").header(SecurityConfig.CLIENT_HEADER, LAN)
            .contentType("application/json").content("{\"siteName\":\"CSRF 확인\"}"))
        .andExpect(status().isForbidden());
    for (String name : List.of("", "   ", "x".repeat(41), "줄\n바꿈")) {
      mvc.perform(put("/api/site").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf())
              .contentType("application/json").content(json.writeValueAsString(Map.of("siteName", name))))
          .andExpect(status().isBadRequest());
    }
    assertThat(docs.read("site-settings", SiteName.class).siteName()).isEqualTo("MyWorkspace");
    mvc.perform(put("/api/site").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf())
            .contentType("application/json").content("{\"siteName\":\"  나의 공간  \"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.siteName").value("나의 공간"));
    assertThat(docs.read("site-settings", SiteName.class).siteName()).isEqualTo("나의 공간");
    mvc.perform(get("/api/site").header(SecurityConfig.CLIENT_HEADER, EXT))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.siteName").value("나의 공간"));
  }

  @Test
  void verifiedNetworkIsCheckedEveryRequestAndNeverSavedAsPasswordSession() throws Exception {
    var session = new MockHttpSession();
    mvc.perform(get("/api/timetable").session(session).header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").session(session).header(SecurityConfig.CLIENT_HEADER, EXT))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header("X-Forwarded-For", LAN))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "localhost"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/auth/session").header(SecurityConfig.CLIENT_HEADER, "198.51.100.10"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authenticated").value(true));
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "198.51.100.10"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "198.51.100.11"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "100.65.70.77"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "100.65.70.78"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "fd7a:115c:a1e0::1234"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/timetable").header(SecurityConfig.CLIENT_HEADER, "fd7a:115c:a1e0::1235"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/api/timetable")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(
                    r -> {
                      r.setRemoteAddr("198.51.100.1");
                      return r;
                    }))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void realCsrfLoginRotatesSessionAndLogoutRevokesIt() throws Exception {
    var token = mvc.perform(get("/api/auth/csrf").header(SecurityConfig.CLIENT_HEADER, EXT)).andReturn();
    var session = (MockHttpSession) token.getRequest().getSession();
    String old = session.getId();
    var csrf = json.readTree(token.getResponse().getContentAsString());
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header(SecurityConfig.CLIENT_HEADER, EXT)
                .contentType("application/json")
                .content("{\"password\":\"test-password\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header(SecurityConfig.CLIENT_HEADER, EXT)
                .header(csrf.path("headerName").asText(), csrf.path("token").asText())
                .contentType("application/json")
                .content("{\"password\":\"test-password\"}"))
        .andExpect(status().isOk());
    assertThat(session.getId()).isNotEqualTo(old);
    mvc.perform(get("/api/timetable").session(session).header(SecurityConfig.CLIENT_HEADER, EXT))
        .andExpect(status().isOk());
    mvc.perform(post("/api/auth/logout").session(session).with(csrf())).andExpect(status().isOk());
    assertThat(session.isInvalid()).isTrue();
  }

  @Test
  void csrfAlsoProtectsTrustedNetworkAndPasswordAttemptsAreLimited() throws Exception {
    mvc.perform(
            put("/api/wol/devices")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .contentType("application/json")
                .content("[]"))
        .andExpect(status().isForbidden());
    for (int i = 0; i < 5; i++)
      mvc.perform(
              post("/api/auth/login")
                  .header(SecurityConfig.CLIENT_HEADER, "198.51.100.99")
                  .with(csrf())
                  .contentType("application/json")
                  .content("{\"password\":\"wrong\"}"))
          .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/auth/login")
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.99")
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
                    .header(SecurityConfig.CLIENT_HEADER, LAN)
                    .with(csrf())
                    .contentType("application/json")
                    .content(event))
            .andExpect(status().isOk())
            .andReturn();
    String id = json.readTree(created.getResponse().getContentAsString()).path("id").asText();
    mvc.perform(
            get("/api/calendar/events?from=2026-11-06&to=2026-11-06")
                .header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("저장 검증")));
    mvc.perform(
            put("/api/calendar/events/" + id)
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(event.replace("10:00", "08:00")))
        .andExpect(status().isBadRequest());
    mvc.perform(
            delete("/api/calendar/events/" + id).header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf()))
        .andExpect(status().isOk());
    mvc.perform(
            get("/api/calendar/events?from=2026-11-06&to=2028-01-01")
                .header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isBadRequest());
  }

  @Test
  void wolUsesSavedMacAndCooldownSurvivesASecondRequest() throws Exception {
    wol.save(List.of(new WolDevice("test-pc", "테스트 PC", "02-12-34-56-78-9a")));
    mvc.perform(
            post("/api/wol/devices/test-pc/wake").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf()))
        .andExpect(status().isOk());
    verify(packets).send("02:12:34:56:78:9A");
    mvc.perform(get("/api/wol/devices/test-pc/boot").header(SecurityConfig.CLIENT_HEADER, LAN))
        .andExpect(status().isNotFound());
    mvc.perform(
            post("/api/wol/devices/test-pc/wake").header(SecurityConfig.CLIENT_HEADER, LAN).with(csrf()))
        .andExpect(status().isTooManyRequests());
    mvc.perform(
            put("/api/wol/devices")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(
                    "[{\"id\":\"1\",\"name\":\"a\",\"mac\":\"02123456789a\"},{\"id\":\"2\",\"name\":\"b\",\"mac\":\"02:12:34:56:78:9A\"}]"))
        .andExpect(status().isBadRequest());
    assertThat(wol.list()).hasSize(1);
    assertThat(wol.list().getFirst().id()).isEqualTo("test-pc");

  }

  @Test
  void timetableRejectsOverlapsAndKeepsPreviousValue() throws Exception {
    String before = docs.findRaw("timetable").orElseThrow();
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
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content(input))
        .andExpect(status().isBadRequest());
    assertThat(docs.findRaw("timetable").orElseThrow()).isEqualTo(before);
  }

  @Test
  void retiredLegacyImportIsUnavailable() throws Exception {
    mvc.perform(
            post("/api/import/legacy")
                .header(SecurityConfig.CLIENT_HEADER, LAN)
                .with(csrf())
                .contentType("application/json")
                .content("{}"))
        .andExpect(status().isNotFound());
  }
}
