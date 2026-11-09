package kr.myworkspace;

import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@Service
class Monitoring {
  final Documents docs;
  final JdbcTemplate jdbc;
  final String base, token, node, sensorKey, sensorTarget, sensorKnownHosts;
  final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
  volatile Map<String, Object> snapshot;
  volatile boolean failed = true;
  private final Map<String, double[]> counters = new HashMap<>();
  private final Map<String, Long> retainedMinutes = new HashMap<>();

  Monitoring(
      Documents docs,
      JdbcTemplate jdbc,
      @Value("${app.proxmox-url}") String base,
      @Value("${app.proxmox-token}") String token,
      @Value("${app.proxmox-node}") String node,
      @Value("${app.sensor-key}") String sensorKey,
      @Value("${SENSOR_TARGET:}") String sensorTarget,
      @Value("${SENSOR_KNOWN_HOSTS:}") String sensorKnownHosts) {
    this.docs = docs;
    this.jdbc = jdbc;
    this.base = base;
    this.token = token;
    this.node = node;
    this.sensorKey = sensorKey;
    this.sensorTarget = sensorTarget;
    this.sensorKnownHosts = sensorKnownHosts;
  }

  JsonNode get(String path) throws Exception {
    var response =
        http.send(
            HttpRequest.newBuilder(URI.create(base + "/api2/json" + path))
                .timeout(Duration.ofSeconds(4))
                .header("Authorization", "PVEAPIToken=" + token)
                .GET()
                .build(),
            HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() != 200 || response.body().length() > 2_000_000)
      throw new java.io.IOException("Monitoring API unavailable");
    return docs.json.readTree(response.body()).path("data");
  }

  Map<String, Double> network(String id, double input, double output, long now) {
    var previous = counters.put(id, new double[] {input, output, now});
    double seconds = previous == null ? 0 : (now - previous[2]) / 1000d;
    return Map.of(
        "inputBytesPerSecond",
        seconds > 0 ? Math.max(0, input - previous[0]) / seconds : 0,
        "outputBytesPerSecond",
        seconds > 0 ? Math.max(0, output - previous[1]) / seconds : 0);
  }

  JsonNode sensors() {
    if (sensorKey.isBlank() || sensorTarget.isBlank() || sensorKnownHosts.isBlank())
      return docs.json.createObjectNode();
    try {
      Process process =
          new ProcessBuilder(
                  "/usr/bin/ssh",
                  "-i",
                  sensorKey,
                  "-o",
                  "BatchMode=yes",
                  "-o",
                  "IdentitiesOnly=yes",
                  "-o",
                  "ConnectTimeout=2",
                  "-o",
                  "StrictHostKeyChecking=yes",
                  "-o",
                  "UserKnownHostsFile=" + sensorKnownHosts,
                  sensorTarget)
              .redirectError(ProcessBuilder.Redirect.DISCARD)
              .start();
      if (!process.waitFor(3, TimeUnit.SECONDS)) {
        process.destroyForcibly();
        return docs.json.createObjectNode();
      }
      byte[] output = process.getInputStream().readNBytes(8192);
      if (process.exitValue() == 0) return docs.json.readTree(output);
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
    }
    return docs.json.createObjectNode();
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
  void collect() {
    if (base.isBlank() || token.isBlank()) return;
    try {
      var host = get("/nodes/" + node + "/status");
      var guests = get("/cluster/resources?type=vm");
      var storage = get("/nodes/" + node + "/storage");
      var sensors = sensors();
      long now = System.currentTimeMillis();
      var network = network("host", n(sensors, "netin"), n(sensors, "netout"), now);
      List<Map<String, Object>> disks = new ArrayList<>(), vms = new ArrayList<>();
      for (var s : storage) {
        if (n(s, "active") == 0 || n(s, "total") == 0) continue;
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("name", s.path("storage").asText());
        d.put("usedGb", gib(n(s, "used")));
        d.put("totalGb", gib(n(s, "total")));
        d.put("tempC", null);
        disks.add(d);
      }
      long at = now / 5000 * 5000;
      sample(
          at,
          "host",
          n(host, "cpu") * 100,
          n(host.path("memory"), "used") / Math.max(1, n(host.path("memory"), "total")) * 100,
          network,
          null);
      Set<String> active = new HashSet<>(Set.of("host"));
      for (var g : guests) {
        if (!node.equals(g.path("node").asText())) continue;
        int id = g.path("vmid").asInt();
        String key = String.valueOf(id);
        active.add(key);
        var net = network(key, n(g, "netin"), n(g, "netout"), now);
        boolean lxc = "lxc".equals(g.path("type").asText());
        Double used = lxc ? gib(n(g, "disk")) : null;
        Map<String, Object> disk = new LinkedHashMap<>();
        disk.put("usedGb", used);
        disk.put("totalGb", gib(n(g, "maxdisk")));
        Map<String, Object> guest = new LinkedHashMap<>();
        guest.put("id", id);
        guest.put("name", g.path("name").asText("Guest " + id));
        guest.put("type", lxc ? "lxc" : "vm");
        String state = g.path("status").asText();
        guest.put("status", Set.of("running", "paused").contains(state) ? state : "stopped");
        guest.put("cpuPercent", percent(n(g, "cpu")));
        guest.put("memUsedMb", mib(n(g, "mem")));
        guest.put("memTotalMb", mib(n(g, "maxmem")));
        guest.put("network", net);
        guest.put("disk", disk);
        vms.add(guest);
        sample(
            at,
            key,
            n(g, "cpu") * 100,
            n(g, "mem") / Math.max(1, n(g, "maxmem")) * 100,
            net,
            lxc && n(g, "maxdisk") > 0 ? n(g, "disk") / n(g, "maxdisk") * 100 : null);
      }
      counters.keySet().retainAll(active);
      Map<String, Object> cpu = new LinkedHashMap<>();
      cpu.put("usagePercent", percent(n(host, "cpu")));
      cpu.put("cores", host.path("cpuinfo").path("cpus").asInt());
      cpu.put("tempC", sensors.path("tempC").isNumber() ? sensors.path("tempC").asDouble() : null);
      snapshot =
          Map.of(
              "hostName",
              node,
              "updatedAt",
              Instant.ofEpochMilli(now).toString(),
              "cpu",
              cpu,
              "ram",
              Map.of(
                  "usedMb",
                  mib(n(host.path("memory"), "used")),
                  "totalMb",
                  mib(n(host.path("memory"), "total"))),
              "network",
              network,
              "storages",
              disks,
              "guests",
              vms);
      failed = false;
    } catch (Exception e) {
      failed = true;
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      org.slf4j.LoggerFactory.getLogger(getClass())
          .warn("서버 상태 수집 실패: {}", e.getClass().getSimpleName());
    }
  }

  void sample(long at, String id, double cpu, double ram, Map<String, Double> net, Double disk) {
    boolean keep = !Objects.equals(retainedMinutes.put(id, at / 60_000), at / 60_000);
    jdbc.update(
        "insert into"
            + " metric_sample(sampled_at,resource_id,cpu,ram,net_input,net_output,disk,keep_minute)"
            + " values(?,?,?,?,?,?,?,?)",
        at,
        id,
        cpu,
        ram,
        net.get("inputBytesPerSecond"),
        net.get("outputBytesPerSecond"),
        disk,
        keep);
  }

  @Scheduled(initialDelay = 60_000, fixedDelay = 60_000)
  void retain() {
    long now = System.currentTimeMillis();
    // Keep five-second samples for an hour and one sample per minute for a month.
    jdbc.update(
        "delete from metric_sample where sampled_at < ? or (sampled_at < ? and keep_minute=false)",
        now - 31L * 86400_000,
        now - 3600_000);
  }

  Object status() {
    if (snapshot == null || failed)
      throw new ApiException(503, "NETWORK", "Proxmox 서버 상태를 가져오지 못했습니다.");
    return snapshot;
  }

  static Map<String, List<Map<String, Object>>> resource(boolean guest) {
    Map<String, List<Map<String, Object>>> result = new LinkedHashMap<>();
    for (String key :
        guest
            ? List.of("cpu", "ram", "input", "output", "disk")
            : List.of("cpu", "ram", "input", "output")) result.put(key, new ArrayList<>());
    return result;
  }

  Object history(String range) {
    long window =
        switch (range) {
          case "1m" -> 60_000;
          case "15m" -> 900_000;
          case "1H" -> 3600_000;
          case "6H" -> 6L * 3600_000;
          case "12H" -> 12L * 3600_000;
          case "1D" -> 86400_000;
          case "1W" -> 7L * 86400_000;
          case "1M" -> 30L * 86400_000;
          default -> throw new ApiException(400, "VALIDATION", "조회 기간을 확인하세요.");
        };
    long step =
        switch (range) {
          case "1m" -> 5000;
          case "15m", "1H" -> 60_000;
          case "6H" -> 300_000;
          case "12H" -> 600_000;
          case "1D" -> 900_000;
          case "1W" -> 3600_000;
          default -> 21600_000;
        };
    long to = System.currentTimeMillis(), from = to - window;
    var host = resource(false);
    Map<String, Object> guests = new LinkedHashMap<>();
    Map<String, String> guestKeys = new HashMap<>();
    if (snapshot != null)
      for (Object item : (List<?>) snapshot.get("guests")) {
        var guest = (Map<?, ?>) item;
        guestKeys.put(String.valueOf(guest.get("id")), guest.get("type") + "-" + guest.get("id"));
      }
    var rows =
        jdbc.queryForList(
            "select resource_id, floor(sampled_at / ?) * ? as bucket, avg(cpu) as cpu, avg(ram) as"
                + " ram, avg(net_input) as input_rate, avg(net_output) as output_rate, avg(disk) as"
                + " disk from metric_sample where sampled_at between ? and ? group by resource_id,"
                + " bucket order by bucket",
            step,
            step,
            from,
            to);
    for (var row : rows) {
      String id = (String) row.get("resource_id");
      @SuppressWarnings("unchecked")
      var target =
          id.equals("host")
              ? host
              : (Map<String, List<Map<String, Object>>>)
                  guests.computeIfAbsent(guestKeys.getOrDefault(id, id), k -> resource(true));
      for (String field : target.keySet()) {
        var points = target.get(field);
        long bucket = ((Number) row.get("bucket")).longValue();
        if (!points.isEmpty()) {
          long previous = ((Number) points.getLast().get("at")).longValue();
          for (long missing = previous + step; missing < bucket; missing += step) {
            Map<String, Object> gap = new LinkedHashMap<>();
            gap.put("at", missing);
            gap.put("value", null);
            points.add(gap);
          }
        }
        Object value =
            row.get(
                field.equals("input")
                    ? "input_rate"
                    : field.equals("output") ? "output_rate" : field);
        Map<String, Object> point = new LinkedHashMap<>();
        point.put("at", bucket);
        point.put("value", value);
        target.get(field).add(point);
      }
    }
    return Map.of("from", from, "to", to, "host", host, "guests", guests);
  }
}

@RestController
@RequestMapping("/api/server")
class MonitoringController {
  final Monitoring monitor;

  MonitoringController(Monitoring monitor) {
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
