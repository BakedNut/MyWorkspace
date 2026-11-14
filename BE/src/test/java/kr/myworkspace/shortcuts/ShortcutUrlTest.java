package kr.myworkspace.shortcuts;

import static org.assertj.core.api.Assertions.*;

import java.net.URI;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ShortcutUrlTest {
  @Test
  void normalizesBrowserIpv4AndIpv6OriginsWithoutDns() {
    for (var value :
        Map.of(
                "http://134744072/path", "http://8.8.8.8/",
                "http://010.010.010.010/", "http://8.8.8.8/",
                "http://0x08080808/", "http://8.8.8.8/",
                "HTTPS://[2001:0db8:0:0:1:0:0:1]:443/", "https://[2001:db8::1:0:0:1]/",
                "http://[0:0:0:0:0:ffff:192.0.2.1]/", "http://[::ffff:c000:201]/",
                "http://[0:0:0:0:0:0:0:0]/", "http://[::]/")
            .entrySet())
      assertThat(ShortcutUrl.origin(value.getKey()).toString()).isEqualTo(value.getValue());
    assertThat(
            ShortcutUrl.canonical(URI.create("http://134744072:8080/a%2Fb?x=%2F#top")).toString())
        .isEqualTo("http://8.8.8.8:8080/a%2Fb?x=%2F");
  }

  @Test
  void rejectsInvalidNumericHostsAndScopedIpv6() {
    for (String value :
        new String[] {
          "http://4294967296/", "http://09/", "http://test.42/", "http://[fe80::1%25eth0]/"
        }) assertThatIllegalArgumentException().isThrownBy(() -> ShortcutUrl.origin(value));
  }

  @Test
  void aliasOriginsCannotBypassSameHostPortRestrictions() {
    assertThat(
            ShortcutIconFetcher.targetAllowed(
                URI.create("http://134744072:8088/"),
                URI.create("http://8.8.8.8:8081/favicon.ico")))
        .isFalse();
    assertThat(
            ShortcutIconFetcher.targetAllowed(
                URI.create("http://[2001:db8:0:0:0:0:0:1]:8088/"),
                URI.create("http://[2001:db8::1]:8081/favicon.ico")))
        .isFalse();
  }
}
