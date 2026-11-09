package kr.myworkspace.wol;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class WolService {
  final DocumentStore docs;
  final JsonMapper json;
  final JdbcTemplate jdbc;
  final MagicPacketSender packets;

  WolService(DocumentStore docs, JsonMapper json, JdbcTemplate jdbc, MagicPacketSender packets) {
    this.docs = docs;
    this.json = json;
    this.jdbc = jdbc;
    this.packets = packets;
  }

  static String normalize(String mac) {
    if (mac == null) return null;
    String hex = mac.trim().replaceAll("[:.\\-\\s]", "").toUpperCase(Locale.ROOT);
    ApiException.require(
        hex.matches("[0-9A-F]{12}")
            && !hex.equals("000000000000")
            && (Integer.parseInt(hex.substring(0, 2), 16) & 1) == 0,
        "올바른 PC MAC 주소를 입력하세요.");
    return String.join(":", hex.split("(?<=\\G..)"));
  }

  public List<WolDevice> list() {
    return Arrays.asList(docs.read("wol", WolDevice[].class));
  }

  @Transactional
  public List<WolDevice> save(List<WolDevice> input) {
    Set<String> ids = new HashSet<>(), macs = new HashSet<>();
    List<WolDevice> clean = new ArrayList<>();
    for (WolDevice device : input) {
      ApiException.require(ids.add(device.id()), "PC 식별자가 중복됩니다.");
      String mac = normalize(device.mac());
      ApiException.require(mac == null || macs.add(mac), "이미 등록된 MAC 주소입니다.");
      clean.add(new WolDevice(device.id(), device.name().trim(), mac));
    }
    docs.write(docs.lock("wol"), clean);
    return clean;
  }

  @Transactional
  WolDevice mac(String id, String mac) {
    var doc = docs.lock("wol");
    List<WolDevice> old = Arrays.asList(docs.read(doc, WolDevice[].class));
    ApiException.require(old.stream().anyMatch(d -> d.id().equals(id)), "PC를 찾을 수 없습니다.");
    var saved =
        save(
            old.stream()
                .map(d -> d.id().equals(id) ? new WolDevice(id, d.name(), mac) : d)
                .toList());
    return saved.stream().filter(d -> d.id().equals(id)).findFirst().orElseThrow();
  }

  @Transactional
  Object wake(String id) {
    // Lock the list so editing a MAC cannot race with a wake request.
    var doc = docs.lock("wol");
    var device =
        Arrays.stream(docs.read(doc, WolDevice[].class))
            .filter(d -> d.id().equals(id))
            .findFirst()
            .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "PC를 찾을 수 없습니다."));
    ApiException.require(device.mac() != null, "MAC 주소를 먼저 등록하세요.");
    long now = System.currentTimeMillis();
    List<Long> old =
        jdbc.query("select sent_at from wol_request where device_id=?", (r, n) -> r.getLong(1), id);
    if (!old.isEmpty() && old.getFirst() + 10_000 > now)
      throw new ApiException(429, "RATE_LIMITED", "10초 뒤 다시 시도하세요.", old.getFirst() + 10_000 - now);
    packets.send(device.mac());
    if (old.isEmpty())
      jdbc.update("insert into wol_request(device_id,sent_at) values(?,?)", id, now);
    else jdbc.update("update wol_request set sent_at=? where device_id=?", now, id);
    return Map.of("sentAt", Instant.ofEpochMilli(now).toString());
  }
}
