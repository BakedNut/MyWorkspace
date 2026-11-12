package kr.myworkspace.server;

import static kr.myworkspace.server.ServerStatusResponse.*;

import java.time.Instant;
import java.util.*;
import kr.myworkspace.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class MonitoringService {
  final ProxmoxClient proxmox;
  final SensorClient sensors;
  final MetricRepository metrics;
  final String node;
  volatile ServerStatusResponse snapshot;
  volatile boolean failed = true;
  volatile boolean historyFailed;
  final Map<String, double[]> counters = new HashMap<>();

  MonitoringService(
      ProxmoxClient proxmox,
      SensorClient sensors,
      MetricRepository metrics,
      @Value("${app.proxmox-node}") String node) {
    this.proxmox = proxmox;
    this.sensors = sensors;
    this.metrics = metrics;
    this.node = node;
  }

  ServerStatusResponse.Network network(String id, double input, double output, long now) {
    var previous = counters.put(id, new double[] {input, output, now});
    double seconds = previous == null ? 0 : (now - previous[2]) / 1000d;
    return new ServerStatusResponse.Network(
        seconds > 0 ? Math.max(0, input - previous[0]) / seconds : 0,
        seconds > 0 ? Math.max(0, output - previous[1]) / seconds : 0);
  }

  static double n(JsonNode value, String field) {
    return value.path(field).asDouble(0);
  }

  static double mib(double value) {
    return value / 1048576;
  }

  static double gib(double value) {
    return Math.round(value / 1073741824d * 10) / 10d;
  }

  static double percent(double value) {
    return Math.round(value * 1000) / 10d;
  }

  @Scheduled(initialDelay = 2000, fixedDelay = 5000)
  synchronized void collect() {
    if (!proxmox.configured()) return;
    List<MetricRepository.Sample> samples = new ArrayList<>();
    try {
      var host = proxmox.get("/nodes/" + node + "/status");
      var guests = proxmox.get("/cluster/resources?type=vm");
      var storage = proxmox.get("/nodes/" + node + "/storage");
      var sensor = sensors.read();
      long now = System.currentTimeMillis(), at = now / 5000 * 5000;
      var network = network("host", n(sensor, "netin"), n(sensor, "netout"), now);
      List<Storage> disks = new ArrayList<>();
      List<GuestStatus> vms = new ArrayList<>();
      for (var value : storage) {
        if (n(value, "active") == 0 || n(value, "total") == 0) continue;
        disks.add(
            new Storage(
                value.path("storage").asText(),
                gib(n(value, "used")),
                gib(n(value, "total")),
                null));
      }
      samples.add(
          new MetricRepository.Sample(
              at,
              "host",
              n(host, "cpu") * 100,
              n(host.path("memory"), "used") / Math.max(1, n(host.path("memory"), "total")) * 100,
              network,
              null));
      Set<String> active = new HashSet<>(Set.of("host"));
      for (var guest : guests) {
        if (!node.equals(guest.path("node").asText())) continue;
        int id = guest.path("vmid").asInt();
        String key = String.valueOf(id);
        active.add(key);
        var net = network(key, n(guest, "netin"), n(guest, "netout"), now);
        boolean lxc = "lxc".equals(guest.path("type").asText());
        var disk = new GuestDisk(lxc ? gib(n(guest, "disk")) : null, gib(n(guest, "maxdisk")));
        String status = guest.path("status").asText();
        vms.add(
            new GuestStatus(
                id,
                guest.path("name").asText("Guest " + id),
                lxc ? "lxc" : "vm",
                Set.of("running", "paused").contains(status) ? status : "stopped",
                percent(n(guest, "cpu")),
                mib(n(guest, "mem")),
                mib(n(guest, "maxmem")),
                net,
                disk));
        samples.add(
            new MetricRepository.Sample(
                at,
                key,
                n(guest, "cpu") * 100,
                n(guest, "mem") / Math.max(1, n(guest, "maxmem")) * 100,
                net,
                lxc && n(guest, "maxdisk") > 0
                    ? n(guest, "disk") / n(guest, "maxdisk") * 100
                    : null));
      }
      counters.keySet().retainAll(active);
      snapshot =
          new ServerStatusResponse(
              node,
              Instant.ofEpochMilli(now).toString(),
              new Cpu(
                  percent(n(host, "cpu")),
                  host.path("cpuinfo").path("cpus").asInt(),
                  sensor.path("tempC").isNumber() ? sensor.path("tempC").asDouble() : null),
              new Ram(mib(n(host.path("memory"), "used")), mib(n(host.path("memory"), "total"))),
              network,
              disks,
              vms);
      failed = false;
    } catch (Exception error) {
      failed = true;
      if (error instanceof InterruptedException) Thread.currentThread().interrupt();
      org.slf4j.LoggerFactory.getLogger(getClass())
          .warn("서버 상태 수집 실패: {}", error.getClass().getSimpleName());
      return;
    }
    try {
      metrics.record(samples);
      historyFailed = false;
    } catch (RuntimeException error) {
      historyFailed = true;
      org.slf4j.LoggerFactory.getLogger(getClass())
          .warn("서버 상태는 갱신했으나 이력 저장 실패: {}", error.getClass().getSimpleName());
    }
  }

  ServerStatusResponse status() {
    var current = snapshot;
    if (current == null || failed)
      throw new ApiException(503, "NETWORK", "Proxmox 서버 상태를 가져오지 못했습니다.");
    return current;
  }

  MetricHistoryResponse history(String range) {
    Map<String, String> keys = new HashMap<>();
    var current = snapshot;
    if (current != null)
      for (var guest : current.guests())
        keys.put(String.valueOf(guest.id()), guest.type() + "-" + guest.id());
    return metrics.history(range, keys);
  }
}
