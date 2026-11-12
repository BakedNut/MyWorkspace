package kr.myworkspace.shortcuts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.net.URI;
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
import org.springframework.jdbc.core.JdbcTemplate;
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
  @Autowired JdbcTemplate jdbc;
  @Autowired ShortcutIconService icons;
  @MockitoBean ShortcutIconFetcher fetcher;
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
    jdbc.update("delete from shortcut_icon");
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

  @Test
  void storesIconsForAnOriginAndServesThemFromTheDatabase() throws Exception {
    docs.save("shortcuts", board("https://example.com/page?private=query"));
    byte[] bytes = {1, 2, 3};
    when(fetcher.fetch(URI.create("https://example.com/")))
        .thenReturn(new ShortcutIcon("image/png", bytes));
    var first =
        mvc.perform(get("/api/shortcuts/icons/portal").with(trusted))
            .andExpect(request().asyncStarted())
            .andReturn();
    first.getAsyncResult(5000);
    mvc.perform(asyncDispatch(first))
        .andExpect(status().isOk())
        .andExpect(content().contentType("image/png"))
        .andExpect(content().bytes(bytes))
        .andExpect(
            header()
                .string(
                    "Content-Security-Policy", org.hamcrest.Matchers.containsString("sandbox")));
    assertThat(jdbc.queryForObject("select count(*) from shortcut_icon", Integer.class))
        .isEqualTo(1);
    org.mockito.Mockito.reset(fetcher);
    var second = mvc.perform(get("/api/shortcuts/icons/portal").with(trusted)).andReturn();
    second.getAsyncResult(5000);
    mvc.perform(asyncDispatch(second)).andExpect(status().isOk()).andExpect(content().bytes(bytes));
    verifyNoInteractions(fetcher);
  }

  @Test
  void cachesMissingIconsAndProtectsIconRequests() throws Exception {
    docs.save("shortcuts", board("https://example.com/"));
    for (int i = 0; i < 2; i++) {
      var request = mvc.perform(get("/api/shortcuts/icons/portal").with(trusted)).andReturn();
      request.getAsyncResult(5000);
      mvc.perform(asyncDispatch(request)).andExpect(status().isNoContent());
    }
    verify(fetcher, times(1)).fetch(URI.create("https://example.com/"));
    mvc.perform(get("/api/shortcuts/icons/portal")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/shortcuts/icons/missing").with(trusted)).andExpect(status().isNotFound());
  }

  @Test
  void passwordSessionsCanAlsoLoadIconsThroughAsyncDispatch() throws Exception {
    docs.save("shortcuts", board("https://example.com/"));
    when(fetcher.fetch(URI.create("https://example.com/")))
        .thenReturn(new ShortcutIcon("image/png", new byte[] {1}));
    var login =
        mvc.perform(
                post("/api/auth/login")
                    .with(csrf())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"password\":\"shortcut-test-only\"}"))
            .andExpect(status().isOk())
            .andReturn();
    var session =
        (org.springframework.mock.web.MockHttpSession) login.getRequest().getSession(false);
    var image = mvc.perform(get("/api/shortcuts/icons/portal").session(session)).andReturn();
    image.getAsyncResult(5000);
    mvc.perform(asyncDispatch(image)).andExpect(status().isOk());
  }

  @Test
  void aDraftUrlCannotCacheTheOldSitesIconUnderTheNewSite() throws Exception {
    docs.save("shortcuts", board("https://example.com/"));
    var draft =
        mvc.perform(
                get("/api/shortcuts/icons/portal").param("site", "https://react.dev").with(trusted))
            .andReturn();
    draft.getAsyncResult(5000);
    mvc.perform(asyncDispatch(draft)).andExpect(status().isNoContent());
    verifyNoInteractions(fetcher);
    mvc.perform(
            put("/api/shortcuts")
                .with(trusted)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(board("https://react.dev/"))))
        .andExpect(status().isOk());
    when(fetcher.fetch(URI.create("https://react.dev/")))
        .thenReturn(new ShortcutIcon("image/png", new byte[] {9}));
    var saved =
        mvc.perform(
                get("/api/shortcuts/icons/portal").param("site", "https://react.dev").with(trusted))
            .andReturn();
    saved.getAsyncResult(5000);
    mvc.perform(asyncDispatch(saved))
        .andExpect(status().isOk())
        .andExpect(content().bytes(new byte[] {9}));
  }
  @Test
  void removedIconsReplaceExpiredImagesWithANegativeCache() throws Exception {
    docs.save("shortcuts", board("https://example.com/"));
    when(fetcher.fetch(URI.create("https://example.com/")))
        .thenReturn(new ShortcutIcon("image/png", new byte[] {1}));
    assertThat(icons.get("portal", null).get(5, java.util.concurrent.TimeUnit.SECONDS)).isNotNull();
    jdbc.update("update shortcut_icon set checked_at=0");
    when(fetcher.fetch(URI.create("https://example.com/"))).thenReturn(null);
    icons.get("portal", null).get(5, java.util.concurrent.TimeUnit.SECONDS);
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
    while (jdbc.queryForObject("select checked_at from shortcut_icon", Long.class) == 0
        && System.nanoTime() < deadline) Thread.sleep(10);
    assertThat(jdbc.queryForObject("select checked_at from shortcut_icon", Long.class)).isPositive();
    assertThat(jdbc.queryForObject("select image_bytes from shortcut_icon", byte[].class)).isNull();
    assertThat(icons.get("portal", null).get(5, java.util.concurrent.TimeUnit.SECONDS)).isNull();
    verify(fetcher, times(2)).fetch(URI.create("https://example.com/"));
  }

}
