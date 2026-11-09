package kr.myworkspace.server;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/server")
class MonitoringController {
  final MonitoringService monitor;

  MonitoringController(MonitoringService monitor) {
    this.monitor = monitor;
  }

  @GetMapping("/status")
  Object status() {
    return monitor.status();
  }

  @GetMapping("/history")
  Object history(@RequestParam String range) {
    return monitor.history(range);
  }
}
