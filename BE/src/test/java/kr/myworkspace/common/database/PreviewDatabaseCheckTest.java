package kr.myworkspace.common.database;

import static org.assertj.core.api.Assertions.*;

import java.sql.DriverManager;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class PreviewDatabaseCheckTest {
  private String url(String database) {
    return "jdbc:h2:mem:" + database + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
  }

  private MockEnvironment environment(String runtime, String migration) {
    return new MockEnvironment()
        .withProperty("spring.datasource.url", url(runtime))
        .withProperty("spring.datasource.username", "sa")
        .withProperty("spring.datasource.password", "")
        .withProperty("spring.flyway.url", url(migration));
  }

  @Test
  void acceptsOnlyTheActualPreviewDatabaseForBothConnections() throws Exception {
    PreviewDatabaseCheck.verify(environment("myworkspace_preview", "myworkspace_preview"));
    for (var names :
        new String[][] {
          {"myworkspace", "myworkspace_preview"}, {"myworkspace_preview", "myworkspace"}
        }) {
      assertThatThrownBy(() -> PreviewDatabaseCheck.verify(environment(names[0], names[1])))
          .isInstanceOf(IllegalStateException.class);
    }
    try (var connection = DriverManager.getConnection(url("myworkspace"), "sa", "");
        var result =
            connection
                .createStatement()
                .executeQuery(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='public'")) {
      assertThat(result.next()).isTrue();
      assertThat(result.getInt(1)).isZero();
    }
  }

  @Test
  void rejectsNonPreviewDefaultOrManagedSchemasBeforeMigrations() throws Exception {
    for (String property :
        new String[] {
          "spring.flyway.default-schema", "spring.flyway.schemas", "spring.flyway.schemas[0]"
        }) {
      var settings =
          environment("myworkspace_preview", "myworkspace_preview")
              .withProperty(property, "myworkspace");
      assertThatThrownBy(() -> PreviewDatabaseCheck.verify(settings))
          .isInstanceOf(IllegalStateException.class)
          .hasMessageContaining("Flyway schemas");
    }
    var fromEnvironment = environment("myworkspace_preview", "myworkspace_preview");
    fromEnvironment
        .getPropertySources()
        .addFirst(
            new org.springframework.core.env.SystemEnvironmentPropertySource(
                "systemEnvironment",
                java.util.Map.of("SPRING_FLYWAY_DEFAULT_SCHEMA", "myworkspace")));
    assertThatThrownBy(() -> PreviewDatabaseCheck.verify(fromEnvironment))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Flyway schemas");
    var valid =
        environment("myworkspace_preview", "myworkspace_preview")
            .withProperty("spring.flyway.default-schema", "myworkspace_preview")
            .withProperty("spring.flyway.schemas", "myworkspace_preview");
    PreviewDatabaseCheck.verify(valid);
    var mixed =
        environment("myworkspace_preview", "myworkspace_preview")
            .withProperty("spring.flyway.schemas", "myworkspace_preview,myworkspace");
    assertThatThrownBy(() -> PreviewDatabaseCheck.verify(mixed))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void rejectsConnectionOverridesBeforeOpeningTheRuntimePool() throws Exception {
    for (String property :
        new String[] {
          "spring.datasource.hikari.jdbc-url",
          "spring.datasource.hikari.jdbcUrl",
          "spring.datasource.hikari.data-source-properties[url]",
          "spring.datasource.hikari.connection-init-sql",
          "spring.datasource.hikari.catalog",
          "spring.datasource.hikari.schema",
          "spring.datasource.jndi-name",
          "spring.flyway.jdbc-properties[databaseName]",
          "spring.flyway.init-sqls[0]"
        }) {
      var settings =
          environment("myworkspace_preview", "myworkspace_preview")
              .withProperty(property, url("myworkspace"));
      assertThatThrownBy(() -> PreviewDatabaseCheck.verify(settings))
          .as(property)
          .isInstanceOf(IllegalStateException.class);
    }
    var variables = environment("myworkspace_preview", "myworkspace_preview");
    variables
        .getPropertySources()
        .addFirst(
            new org.springframework.core.env.SystemEnvironmentPropertySource(
                "systemEnvironment",
                java.util.Map.of("SPRING_DATASOURCE_HIKARI_JDBCURL", url("myworkspace"))));
    assertThatThrownBy(() -> PreviewDatabaseCheck.verify(variables))
        .isInstanceOf(IllegalStateException.class);
    PreviewDatabaseCheck.verify(
        environment("myworkspace_preview", "myworkspace_preview")
            .withProperty("spring.datasource.hikari.maximum-pool-size", "5")
            .withProperty("spring.datasource.hikari.minimum-idle", "1"));
  }

  @Test
  void standaloneBootstrapRejectsFlywayUrlOverrideBeforeMigrations() {
    assertThatThrownBy(
            () ->
                PreviewDatabaseCheck.main(
                    new String[] {
                      "--spring.datasource.url=" + url("myworkspace_preview"),
                      "--spring.datasource.username=sa",
                      "--spring.datasource.password=",
                      "--spring.flyway.url=" + url("myworkspace"),
                      "--spring.flyway.user=sa",
                      "--spring.flyway.password="
                    }))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void standaloneBootstrapRejectsProductionBeforeCreatingMigrationTables() {
    assertThatThrownBy(
            () ->
                PreviewDatabaseCheck.main(
                    new String[] {
                      "--spring.datasource.url=" + url("myworkspace"),
                      "--spring.datasource.username=sa",
                      "--spring.datasource.password=",
                      "--spring.flyway.user=sa",
                      "--spring.flyway.password="
                    }))
        .isInstanceOf(IllegalStateException.class);
  }
}
