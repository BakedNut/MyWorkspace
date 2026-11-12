package kr.myworkspace.server;

import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
class SensorClient {
  final JsonMapper json;
  final String sensorKey, sensorTarget, sensorKnownHosts;

  SensorClient(
      JsonMapper json,
      @Value("${app.sensor-key}") String key,
      @Value("${SENSOR_TARGET:}") String target,
      @Value("${SENSOR_KNOWN_HOSTS:}") String knownHosts) {
    this.json = json;
    this.sensorKey = key;
    this.sensorTarget = target;
    this.sensorKnownHosts = knownHosts;
  }

  JsonNode read() {
    if (sensorKey.isBlank() || sensorTarget.isBlank() || sensorKnownHosts.isBlank())
      return json.createObjectNode();
    try {
      Process process =
          new ProcessBuilder(
                  "/usr/bin/ssh",
                  "-F",
                  "/dev/null",
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
        return json.createObjectNode();
      }
      byte[] output = process.getInputStream().readNBytes(8192);
      if (process.exitValue() == 0) return json.readTree(output);
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
    }
    return json.createObjectNode();
  }
}
