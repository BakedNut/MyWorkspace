package kr.myworkspace.wol;

import static org.assertj.core.api.Assertions.*;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class MagicPacketSenderTest {
  @Test
  void buildsTheMagicPacketForTheSavedMac() {
    byte[] packet = MagicPacketSender.packet("02:12:34:56:78:9A");
    assertThat(packet).hasSize(102);
    assertThat(Arrays.copyOfRange(packet, 0, 6)).containsOnly((byte) 0xff);
    assertThat(Arrays.copyOfRange(packet, 96, 102))
        .containsExactly((byte) 2, (byte) 0x12, (byte) 0x34, (byte) 0x56, (byte) 0x78, (byte) 0x9a);
  }
}
