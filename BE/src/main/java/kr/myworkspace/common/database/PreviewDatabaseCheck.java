package kr.myworkspace.common.database;

import java.sql.DriverManager;
import java.sql.SQLException;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.Environment;

/** Standalone systemd pre-start check. This context has no database initializers. */
public class PreviewDatabaseCheck {
  public static void main(String[] args) throws SQLException {
    try (var context =
        new SpringApplicationBuilder(PreviewDatabaseCheck.class)
            .web(WebApplicationType.NONE)
            .run(args)) {
      verify(context.getEnvironment());
    }
  }

  static void verify(Environment environment) throws SQLException {
    String url = environment.getRequiredProperty("spring.datasource.url");
    String user = environment.getRequiredProperty("spring.datasource.username");
    String password = environment.getRequiredProperty("spring.datasource.password");
    check(url, user, password);
    check(
        environment.getProperty("spring.flyway.url", url),
        environment.getProperty("spring.flyway.user", user),
        environment.getProperty("spring.flyway.password", password));
  }

  private static void check(String url, String user, String password) throws SQLException {
    try (var connection = DriverManager.getConnection(url, user, password);
        var statement = connection.createStatement();
        var result = statement.executeQuery("SELECT DATABASE()")) {
      if (!result.next() || !"myworkspace_preview".equals(result.getString(1)))
        throw new IllegalStateException(
            "Preview requires myworkspace_preview for runtime and migrations");
    }
  }
}
