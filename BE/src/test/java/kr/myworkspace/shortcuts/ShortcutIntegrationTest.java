package kr.myworkspace.shortcuts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import kr.myworkspace.calendar.holiday.HolidayService;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.server.MonitoringService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
    properties = "spring.datasource.url=jdbc:h2:mem:shortcuts;MODE=MySQL;DB_CLOSE_DELAY=-1")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ShortcutIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired DocumentStore docs;
  @Autowired JsonMapper json;
  @MockitoBean MonitoringService monitor;
  @MockitoBean HolidayService holidays;
  final RequestPostProcessor trusted =
      request -> {
        request.setRemoteAddr("192.168.1.10");
        return request;
      };

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add(
        "app.password-hash",
        () ->
            new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(4)
                .encode("shortcut-test-only"));
  }

  @BeforeEach
  void reset() {
    docs.save("shortcuts", new ShortcutBoard(0, List.of()));
  }

  ShortcutBoard board(String url) {
    return new ShortcutBoard(
        0,
        List.of(
            new ShortcutBoard.Group(
                "school", " 학교 ", true, List.of(new ShortcutBoard.Link("portal", " 포털 ", url)))));
  }

  @Test
  void savesNamesUrlsOrderAndCollapsedStateAndRejectsStaleEdits() throws Exception {
    mvc.perform(get("/api/shortcuts").with(trusted))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.groups").isEmpty());
    mvc.perform(
            put("/api/shortcuts")
                .with(trusted)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(board("http://192.168.1.200:80/"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.revision").value(1))
        .andExpect(jsonPath("$.groups[0].name").value("학교"));
    mvc.perform(get("/api/shortcuts").with(trusted))
        .andExpect(jsonPath("$.groups[0].collapsed").value(true))
        .andExpect(jsonPath("$.groups[0].links[0].name").value("포털"));
    mvc.perform(
            put("/api/shortcuts")
                .with(trusted)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(board("https://example.com"))))
        .andExpect(status().isConflict());
    assertThat(
            docs.read("shortcuts", ShortcutBoard.class)
                .groups()
                .getFirst()
                .links()
                .getFirst()
                .url())
        .isEqualTo("http://192.168.1.200:80/");
  }

  @Test
  void rejectsUnsafeUrlsInvalidRecordsAndDuplicateIds() throws Exception {
    for (String url :
        List.of(
            "javascript:alert(1)",
            "data:text/html,test",
            "//example.com",
            "https://user:password@example.com",
            "https://",
            "http://example.com:99999"))
      mvc.perform(
              put("/api/shortcuts")
                  .with(trusted)
                  .with(csrf())
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(json.writeValueAsString(board(url))))
          .andExpect(status().isBadRequest());
    var group = board("https://example.com").groups().getFirst();
    var duplicate =
        new ShortcutBoard(
            0, List.of(group, new ShortcutBoard.Group("other", "기타", false, group.links())));
    mvc.perform(
            put("/api/shortcuts")
                .with(trusted)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(duplicate)))
        .andExpect(status().isBadRequest());
    mvc.perform(
            put("/api/shortcuts")
                .with(trusted)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"revision\":0,\"groups\":[null]}"))
        .andExpect(status().isBadRequest());
    assertThat(docs.read("shortcuts", ShortcutBoard.class).revision()).isZero();
  }

  @Test
  void requiresAuthenticationAndCsrf() throws Exception {
    mvc.perform(get("/api/shortcuts")).andExpect(status().isUnauthorized());
    mvc.perform(
            put("/api/shortcuts")
                .with(trusted)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(board("https://example.com"))))
        .andExpect(status().isForbidden());
  }
}
