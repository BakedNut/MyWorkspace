package kr.myworkspace;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.net.URI;
import java.net.http.HttpHeaders;
import java.nio.file.*;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ICloudIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired Documents docs;
  @Autowired CloudSecrets secrets;
  @MockitoBean CalDav dav;
  @MockitoBean Holidays holidays;
  @MockitoBean Monitoring monitoring;
  static final String ADDRESS = "192.168.1.55",
      EMAIL = "test-user@example.com",
      PASSWORD = "abcd-efgh-ijkl-mnop";
  static final Path KEY;

  static {
    try {
      KEY = Files.createTempDirectory("myworkspace-icloud-test-").resolve("key");
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry properties) {
    properties.add("app.icloud-key-file", () -> KEY.toString());
    properties.add(
        "app.password-hash",
        () ->
            new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(4)
                .encode("test-password"));
    properties.add("app.public-url", () -> "https://example.com");
    properties.add(
        "spring.datasource.url", () -> "jdbc:h2:mem:icloud;MODE=MySQL;DB_CLOSE_DELAY=-1");
  }

  @Test
  void credentialsConnectionSyncAndDisconnectStayPrivateAndPreserveServerEvents() throws Exception {
    String credentials =
        docs.json.writeValueAsString(Map.of("appleId", EMAIL, "appPassword", PASSWORD));
    mvc.perform(
            post("/api/calendar/icloud/discover")
                .header(Security.CLIENT_HEADER, ADDRESS)
                .with(csrf())
                .contentType("application/json")
                .content(credentials))
        .andExpect(status().isBadRequest());
    String href = "https://p01-caldav.icloud.com/calendars/home/";
    var selected = new CloudCalendar("home", "개인", href, false);
    when(dav.discover(any())).thenReturn(List.of(selected));
    var date = LocalDate.now(CloudEvents.SEOUL);
    var local =
        mvc.perform(
                post("/api/calendar/events")
                    .header(Security.CLIENT_HEADER, ADDRESS)
                    .with(csrf())
                    .contentType("application/json")
                    .content(
                        docs.json.writeValueAsString(
                            new EventInput(
                                "cal-icloud", "기존 서버 일정", date, true, null, null, null, null))))
            .andExpect(status().isOk())
            .andReturn();
    String text =
        CloudEvents.write(
            new EventInput("cal-remote", "Apple 일정", date, false, "09:00", "10:00", null, null),
            null);
    var resource = new CloudResource(href + "original.ics", "\"v1\"", text);
    when(dav.query(any(), eq(href), any(), any())).thenReturn(List.of(resource));
    var response =
        mvc.perform(
                post("/api/calendar/icloud/discover")
                    .secure(true)
                    .header(Security.CLIENT_HEADER, ADDRESS)
                    .with(csrf())
                    .contentType("application/json")
                    .content(credentials))
            .andExpect(status().isOk())
            .andReturn();
    String body = response.getResponse().getContentAsString();
    assertThat(body).doesNotContain(EMAIL, PASSWORD, href);
    String token = docs.json.readTree(body).path("draftToken").asText();
    mvc.perform(
            post("/api/calendar/icloud/connect")
                .secure(true)
                .header(Security.CLIENT_HEADER, ADDRESS)
                .with(csrf())
                .contentType("application/json")
                .content(
                    docs.json.writeValueAsString(
                        Map.of("draftToken", token, "calendarId", "not-owned"))))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/calendar/icloud/connect")
                .secure(true)
                .header(Security.CLIENT_HEADER, ADDRESS)
                .with(csrf())
                .contentType("application/json")
                .content(
                    docs.json.writeValueAsString(
                        Map.of("draftToken", token, "calendarId", "home"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("connected"));
    String stored = docs.repository.findById("icloud").orElseThrow().payload;
    assertThat(stored).doesNotContain(EMAIL, PASSWORD);
    assertThat(Files.getPosixFilePermissions(KEY))
        .isEqualTo(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
    var snapshot =
        mvc.perform(
                get("/api/calendar/events?from=" + date + "&to=" + date)
                    .header(Security.CLIENT_HEADER, ADDRESS))
            .andExpect(status().isOk())
            .andReturn();
    var rows = docs.json.readTree(snapshot.getResponse().getContentAsString());
    String id = null;
    for (var row : rows)
      if ("Apple 일정".equals(row.path("title").asText())) id = row.path("id").asText();
    assertThat(id).isNotNull();
    assertThat(snapshot.getResponse().getContentAsString()).contains("기존 서버 일정");
    var headers = HttpHeaders.of(Map.of("ETag", List.of("\"v1\"")), (a, b) -> true);
    when(dav.send(any(), any(), eq("GET"), isNull(), anyMap()))
        .thenReturn(new DavReply(200, URI.create(resource.href()), headers, text));
    when(dav.send(any(), any(), eq("PUT"), anyString(), anyMap()))
        .thenReturn(
            new DavReply(
                204,
                URI.create(resource.href()),
                HttpHeaders.of(Map.of("ETag", List.of("\"v2\"")), (a, b) -> true),
                ""));
    String update =
        docs.json.writeValueAsString(
            Map.of(
                "calendarId",
                "cal-remote",
                "title",
                "수정한 일정",
                "date",
                date.toString(),
                "allDay",
                false,
                "start",
                "11:00",
                "end",
                "12:00",
                "revision",
                "\"stale\""));
    mvc.perform(
            put("/api/calendar/events/" + id)
                .header(Security.CLIENT_HEADER, ADDRESS)
                .with(csrf())
                .contentType("application/json")
                .content(update))
        .andExpect(status().isConflict());
    mvc.perform(
            put("/api/calendar/events/" + id)
                .header(Security.CLIENT_HEADER, ADDRESS)
                .with(csrf())
                .contentType("application/json")
                .content(update.replace("stale", "v1")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("수정한 일정"));
    verify(dav)
        .send(
            any(),
            any(),
            eq("PUT"),
            contains("SUMMARY:수정한 일정"),
            argThat(h -> "\"v1\"".equals(h.get("If-Match"))));
    mvc.perform(
            post("/api/calendar/icloud/sync").header(Security.CLIENT_HEADER, ADDRESS).with(csrf()))
        .andExpect(status().isOk());
    when(dav.query(any(), eq(href), any(), any()))
        .thenThrow(new ApiException(503, "NETWORK", "연결 실패"));
    mvc.perform(
            post("/api/calendar/icloud/sync").header(Security.CLIENT_HEADER, ADDRESS).with(csrf()))
        .andExpect(status().isServiceUnavailable());
    mvc.perform(
            get("/api/calendar/events?from=" + date + "&to=" + date)
                .header(Security.CLIENT_HEADER, ADDRESS))
        .andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("기존 서버 일정")));
    mvc.perform(delete("/api/calendar/icloud").header(Security.CLIENT_HEADER, ADDRESS))
        .andExpect(status().isForbidden());
    mvc.perform(delete("/api/calendar/icloud").header(Security.CLIENT_HEADER, ADDRESS).with(csrf()))
        .andExpect(status().isOk());
    assertThat(docs.repository.findById("icloud").orElseThrow().payload)
        .doesNotContain("\"encryptedCredentials\":\"", EMAIL, PASSWORD);
    mvc.perform(
            get("/api/calendar/events?from=" + date + "&to=" + date)
                .header(Security.CLIENT_HEADER, ADDRESS))
        .andExpect(status().isOk())
        .andExpect(
            content()
                .string(
                    org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Apple 일정"))));
    verify(dav, never()).send(any(), any(), eq("DELETE"), any(), anyMap());
    String encrypted = secrets.encrypt("test-value");
    assertThat(secrets.decrypt(encrypted)).isEqualTo("test-value");
    assertThatThrownBy(
            () -> secrets.decrypt(encrypted.substring(0, encrypted.length() - 4) + "AAAA"))
        .isInstanceOf(ApiException.class);
  }
}
