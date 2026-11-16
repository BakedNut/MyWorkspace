package kr.myworkspace.common.database;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Set;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.flyway.autoconfigure.FlywayProperties;
import org.springframework.boot.jdbc.autoconfigure.DataSourceProperties;
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
    var binder = Binder.get(environment);
    var datasource =
        binder
            .bind("spring.datasource", DataSourceProperties.class)
            .orElseGet(DataSourceProperties::new);
    if (datasource.getJndiName() != null
        || datasource.getType() != null
        || datasource.getDriverClassName() != null)
      throw new IllegalStateException(
          "Preview requires the default JDBC datasource implementation");
    var tuning =
        Set.of(
            "maximumpoolsize",
            "minimumidle",
            "idletimeout",
            "maxlifetime",
            "keepalivetime",
            "connectiontimeout",
            "validationtimeout",
            "leakdetectionthreshold",
            "poolname",
            "registermbeans",
            "allowpoolsuspension",
            "initializationfailtimeout",
            "transactionisolation",
            "readonly",
            "isolateinternalqueries",
            "autocommit");
    var pool = binder.bind("spring.datasource.hikari", Bindable.mapOf(String.class, Object.class));
    pool.ifBound(
        properties -> {
          if (properties.keySet().stream()
              .anyMatch(
                  key ->
                      !tuning.contains(
                          key.replaceAll("[^a-zA-Z0-9]", "").toLowerCase(Locale.ROOT))))
            throw new IllegalStateException("Preview rejects Hikari connection overrides");
        });
    String url = environment.getRequiredProperty("spring.datasource.url");
    String user = environment.getRequiredProperty("spring.datasource.username");
    String password = environment.getRequiredProperty("spring.datasource.password");
    var flyway =
        Binder.get(environment)
            .bind("spring.flyway", FlywayProperties.class)
            .orElseGet(FlywayProperties::new);
    if (flyway.getDriverClassName() != null
        || !flyway.getJdbcProperties().isEmpty()
        || !flyway.getInitSqls().isEmpty())
      throw new IllegalStateException(
          "Preview rejects Flyway connection overrides and initialization SQL");
    if ((flyway.getDefaultSchema() != null
            && !"myworkspace_preview".equals(flyway.getDefaultSchema()))
        || flyway.getSchemas().stream().anyMatch(schema -> !"myworkspace_preview".equals(schema)))
      throw new IllegalStateException("Preview requires myworkspace_preview for Flyway schemas");
    check(url, user, password);
    check(
        flyway.getUrl() == null ? url : flyway.getUrl(),
        flyway.getUser() == null ? user : flyway.getUser(),
        flyway.getPassword() == null ? password : flyway.getPassword());
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
