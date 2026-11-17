package kr.myworkspace.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class HealthControllerTest {
  @Test
  void deploymentIdentityChecksTheSelectedDatabaseAndIsStablePerInstance() {
    var preview = controller("myworkspace_preview");
    var production = controller("myworkspace");
    assertThat(preview.deployment().previewDatabase()).isTrue();
    assertThat(production.deployment().previewDatabase()).isFalse();
    assertThat(preview.deployment().instance()).isEqualTo(preview.deployment().instance());
    assertThat(preview.deployment().instance()).isNotEqualTo(production.deployment().instance());
  }

  private HealthController controller(String database) {
    return new HealthController(
        new JdbcTemplate(
            new DriverManagerDataSource(
                "jdbc:h2:mem:" + database + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE", "sa", "")));
  }
}
