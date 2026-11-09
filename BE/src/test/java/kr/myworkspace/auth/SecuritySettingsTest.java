package kr.myworkspace.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import kr.myworkspace.calendar.HolidayService;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.server.MonitoringService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecuritySettingsTest {
  @Autowired MockMvc mvc;
  @Autowired DocumentStore docs;
  @Autowired JsonMapper json;
  @Autowired CredentialService credentials;
  @MockitoBean Clock clock;
  @MockitoBean MonitoringService monitor;
  @MockitoBean HolidayService holidays;
  static final Path KEY;

  static {
    try {
      KEY = Files.createTempDirectory("myworkspace-security-test").resolve("key");
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add(
        "app.password-hash",
        () ->
            new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(4)
                .encode("initial-password"));
    r.add(
        "spring.datasource.url", () -> "jdbc:h2:mem:securitysettings;MODE=MySQL;DB_CLOSE_DELAY=-1");
    r.add("app.icloud-key-file", () -> KEY.toString());
  }

  MockHttpSession login(String password) throws Exception {
    var result =
        mvc.perform(
                post("/api/auth/login")
                    .with(csrf())
                    .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                    .contentType("application/json")
                    .content(json.writeValueAsString(Map.of("password", password))))
            .andExpect(status().isOk())
            .andReturn();
    return (MockHttpSession) result.getRequest().getSession();
  }

  void change(MockHttpSession session, Map<String, String> body, int expected) throws Exception {
    mvc.perform(
            post("/api/security/password")
                .session(session)
                .secure(true)
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(body)))
        .andExpect(status().is(expected));
  }

  @Test
  void passwordAndOtpChangesVerifyProofAndRevokeOtherSessions() throws Exception {
    Instant now = Instant.parse("2026-11-06T00:00:00Z");
    when(clock.instant()).thenReturn(now);
    var first = login("initial-password");
    var other = login("initial-password");
    var body =
        Map.of(
            "method",
            "password",
            "currentPassword",
            "initial-password",
            "newPassword",
            "replacement-password",
            "confirmPassword",
            "replacement-password");
    mvc.perform(
            post("/api/security/password")
                .session(first)
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(body)))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/security/password")
                .session(first)
                .secure(true)
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                .contentType("application/json")
                .content(json.writeValueAsString(body)))
        .andExpect(status().isForbidden());
    change(
        first,
        new HashMap<>(body) {
          {
            put("currentPassword", "wrong");
          }
        },
        400);
    String previous = first.getId();
    change(first, body, 200);
    assertThat(first.getId()).isNotEqualTo(previous);
    assertThat(credentials.authenticate("initial-password")).isNull();
    assertThat(credentials.authenticate("replacement-password")).isEqualTo(1);
    mvc.perform(
            get("/api/timetable").session(other).header(SecurityConfig.CLIENT_HEADER, "198.51.100.25"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/api/timetable").session(first).header(SecurityConfig.CLIENT_HEADER, "198.51.100.25"))
        .andExpect(status().isOk());
    var setup =
        mvc.perform(
                post("/api/security/otp/setup")
                    .session(first)
                    .secure(true)
                    .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                    .with(csrf())
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"replacement-password\"}"))
            .andExpect(status().isOk())
            .andReturn();
    var draft = json.readTree(setup.getResponse().getContentAsString());
    String secret = draft.path("secret").asText(), token = draft.path("setupToken").asText();
    assertThat(draft.path("uri").asText()).startsWith("otpauth://totp/");
    String otp = Totp.code(secret, now.getEpochSecond() / 30, 6);
    var third = login("replacement-password");
    String confirmation = json.writeValueAsString(Map.of("setupToken", token, "code", otp));
    mvc.perform(
            post("/api/security/otp/confirm")
                .session(third)
                .secure(true)
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                .with(csrf())
                .contentType("application/json")
                .content(confirmation))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/security/otp/confirm")
                .session(first)
                .secure(true)
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                .with(csrf())
                .contentType("application/json")
                .content(confirmation))
        .andExpect(status().isOk());
    String stored = docs.findRaw("security-settings").orElseThrow();
    assertThat(stored).doesNotContain(secret, "replacement-password", "initial-password");
    String status =
        mvc.perform(
                get("/api/security").session(first).header(SecurityConfig.CLIENT_HEADER, "198.51.100.25"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(status).doesNotContain("secret", "passwordHash", "setupToken");
    var otpBody =
        new HashMap<>(
            Map.of(
                "method",
                "otp",
                "otp",
                otp,
                "newPassword",
                "second-password-new",
                "confirmPassword",
                "second-password-new"));
    change(first, otpBody, 400);
    now = now.plusSeconds(30);
    when(clock.instant()).thenReturn(now);
    otpBody.put("otp", Totp.code(secret, now.getEpochSecond() / 30, 6));
    change(first, otpBody, 200);
    change(first, otpBody, 400);
    assertThat(credentials.authenticate("second-password-new")).isEqualTo(2);
    mvc.perform(
            get("/api/timetable").session(third).header(SecurityConfig.CLIENT_HEADER, "198.51.100.25"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            delete("/api/security/otp")
                .session(first)
                .secure(true)
                .header(SecurityConfig.CLIENT_HEADER, "198.51.100.25")
                .with(csrf())
                .contentType("application/json")
                .content("{\"method\":\"password\",\"currentPassword\":\"second-password-new\"}"))
        .andExpect(status().isOk());
    assertThat(credentials.state().otpSecret()).isNull();
    for (int i = 0; i < 5; i++)
      change(
          first,
          new HashMap<>(body) {
            {
              put("currentPassword", "wrong");
            }
          },
          400);
    change(
        first,
        new HashMap<>(body) {
          {
            put("currentPassword", "wrong");
          }
        },
        429);
  }

  @Test
  void rfcVectorsAndReplayWindows() {
    String secret = Totp.encode("12345678901234567890".getBytes(StandardCharsets.US_ASCII));
    assertThat(Totp.code(secret, 59 / 30, 8)).isEqualTo("94287082");
    assertThat(Totp.code(secret, 1111111109L / 30, 8)).isEqualTo("07081804");
    assertThat(Totp.verify(secret, "287082", 59, -1)).isEqualTo(1);
    assertThat(Totp.verify(secret, "287082", 59, 1)).isEqualTo(-1);
    assertThat(Totp.verify(secret, "287082", 120, -1)).isEqualTo(-1);
  }
}
