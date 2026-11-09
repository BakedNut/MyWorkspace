package kr.myworkspace.wol;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.HexFormat;
import kr.myworkspace.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class MagicPacketSender {
  final InetAddress broadcast;

  MagicPacketSender(@Value("${app.wol-broadcast}") String address) throws UnknownHostException {
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

  public void send(String mac) {
    try (DatagramSocket socket = new DatagramSocket()) {
      socket.setBroadcast(true);
      byte[] packet = packet(mac);
      socket.send(new DatagramPacket(packet, packet.length, broadcast, 9));
    } catch (java.io.IOException e) {
      throw new ApiException(503, "NETWORK", "깨우기 신호를 보내지 못했습니다.");
    }
  }
}
