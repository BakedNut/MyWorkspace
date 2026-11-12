package kr.myworkspace.server;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.json.JsonMapper;

class MonitoringCollectionTest {
  final JsonMapper json = JsonMapper.builder().build();

  @Test
  void historyFailureDoesNotHideLiveSnapshotAndDtoKeepsTheApiFields() throws Exception {
    var proxmox = mock(ProxmoxClient.class);
    var sensor = mock(SensorClient.class);
    var metrics = mock(MetricRepository.class);
    when(proxmox.configured()).thenReturn(true);
    when(proxmox.get(contains("/status")))
        .thenReturn(
            json.readTree(
                "{\"cpu\":0.25,\"cpuinfo\":{\"cpus\":8},\"memory\":{\"used\":1073741824,\"total\":2147483648}}"));
    when(proxmox.get(contains("resources")))
        .thenReturn(
            json.readTree(
                "[{\"node\":\"pve\",\"vmid\":200,\"type\":\"lxc\",\"status\":\"running\",\"maxdisk\":10737418240,\"disk\":1073741824}]"));
    when(proxmox.get(contains("/storage")))
        .thenReturn(
            json.readTree(
                "[{\"active\":1,\"total\":10737418240,\"used\":1073741824,\"storage\":\"local\"}]"));
    when(sensor.read()).thenReturn(json.readTree("{\"tempC\":40,\"netin\":100,\"netout\":200}"));
    doThrow(new DataAccessResourceFailureException("fixture"))
        .doNothing()
        .when(metrics)
        .record(anyList());
    var service = new MonitoringService(proxmox, sensor, metrics, "pve");
    service.collect();
    var value = json.valueToTree(service.status());
    assertThat(value.path("cpu").path("usagePercent").asDouble()).isEqualTo(25);
    assertThat(value.path("cpu").path("cores").asInt()).isEqualTo(8);
    assertThat(value.path("cpu").path("tempC").asDouble()).isEqualTo(40);
    assertThat(value.path("ram").path("usedMb").asDouble()).isEqualTo(1024);
    assertThat(value.path("storages").get(0).path("name").asText()).isEqualTo("local");
    assertThat(value.path("guests").get(0).path("disk").path("usedGb").asDouble()).isEqualTo(1);
    assertThat(value.path("network").has("inputBytesPerSecond")).isTrue();
    assertThat(service.historyFailed).isTrue();
    service.collect();
    assertThat(service.historyFailed).isFalse();
    when(proxmox.get(anyString())).thenThrow(new IOException("fixture"));
    service.collect();
    assertThatThrownBy(service::status)
        .isInstanceOf(kr.myworkspace.common.error.ApiException.class);
  }

  @Test
  void missingSensorConfigurationIsAnIndependentEmptyMeasurement() {
    assertThat(new SensorClient(json, "", "", "").read().isEmpty()).isTrue();
  }
}
