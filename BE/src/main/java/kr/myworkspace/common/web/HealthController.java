package kr.myworkspace.common.web;

import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
  private final JdbcTemplate jdbc;
  private final String instance = UUID.randomUUID().toString();

  HealthController(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  record DeploymentHealth(String instance, boolean previewDatabase) {}

  @GetMapping("/api/health/deployment")
  DeploymentHealth deployment() {
    return new DeploymentHealth(
        instance,
        "myworkspace_preview".equals(jdbc.queryForObject("SELECT DATABASE()", String.class)));
  }

  @GetMapping("/api/health")
  Object health() {
    return Map.of("status", "ok");
  }
}
