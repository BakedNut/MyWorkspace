package kr.myworkspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.*;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

record WolDevice(
    @NotBlank @Size(max = 64) String id,
    @NotBlank @Size(max = 64) String name,
    @Size(max = 32) String mac) {}

@Service
class MagicPackets {
  final InetAddress broadcast;

  MagicPackets(@Value("${app.wol-broadcast}") String address) throws UnknownHostException {
    if (!address.matches("\\d{1,3}(\\.\\d{1,3}){3}"))
      throw new IllegalArgumentException("WOL broadcast must be IPv4");
    broadcast = InetAddress.getByName(address);
  }

  static byte[] packet(String mac) {
    byte[] bytes = new byte[102];
    Arrays.fill(bytes, 0, 6, (byte) 0xff);
    byte[] address = HexFormat.of().parseHex(mac.replace(":", ""));
    for (int i = 0; i < 16; i++) System.arraycopy(address, 0, bytes, 6 + i * 6, 6);
    return bytes;
  }

  void send(String mac) {
    try (DatagramSocket socket = new DatagramSocket()) {
      socket.setBroadcast(true);
      byte[] packet = packet(mac);
      socket.send(new DatagramPacket(packet, packet.length, broadcast, 9));
    } catch (java.io.IOException e) {
      throw new ApiException(503, "NETWORK", "깨우기 신호를 보내지 못했습니다.");
    }
  }
}

@Service
class WolService {
  final Documents docs;
  final JdbcTemplate jdbc;
  final MagicPackets packets;

  WolService(Documents docs, JdbcTemplate jdbc, MagicPackets packets) {
    this.docs = docs;
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

  List<WolDevice> list() {
    return Arrays.asList(docs.read("wol", WolDevice[].class));
  }

  @Transactional
  List<WolDevice> save(List<WolDevice> input) {
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
    List<WolDevice> old = Arrays.asList(docs.json.readValue(doc.payload, WolDevice[].class));
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
        Arrays.stream(docs.json.readValue(doc.payload, WolDevice[].class))
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

@RestController
@RequestMapping("/api/wol/devices")
class WolController {
  final WolService service;

  WolController(WolService service) {
    this.service = service;
  }

  @GetMapping
  Object list() {
    return service.list();
  }

  @PutMapping
  Object save(@RequestBody @NotNull @Size(max = 50) List<@Valid WolDevice> input) {
    return service.save(input);
  }

  record Mac(@Size(max = 32) String mac) {}

  @PatchMapping("/{id}/mac")
  Object mac(@PathVariable String id, @Valid @RequestBody Mac input) {
    return service.mac(id, input.mac());
  }

  @PostMapping("/{id}/wake")
  Object wake(@PathVariable String id) {
    return service.wake(id);
  }
}
