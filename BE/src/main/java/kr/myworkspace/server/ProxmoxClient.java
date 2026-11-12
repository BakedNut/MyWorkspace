package kr.myworkspace.server;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
class ProxmoxClient {
  final JsonMapper json;
  final String base, token;
  final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

  ProxmoxClient(
      JsonMapper json,
      @Value("${app.proxmox-url}") String base,
      @Value("${app.proxmox-token}") String token) {
    this.json = json;
    this.base = base;
    this.token = token;
  }

  boolean configured() {
    return !base.isBlank() && !token.isBlank();
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
      throw new java.io.IOException("MonitoringService API unavailable");
    return json.readTree(response.body()).path("data");
  }
}
