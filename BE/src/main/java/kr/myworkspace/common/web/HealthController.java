package kr.myworkspace.common.web;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
  @GetMapping("/api/health")
  Object health() {
    return Map.of("status", "ok");
  }
}
