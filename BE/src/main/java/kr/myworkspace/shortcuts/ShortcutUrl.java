package kr.myworkspace.shortcuts;

import java.net.InetAddress;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class ShortcutUrl {
  private ShortcutUrl() {}

  static URI origin(String value) {
    var uri = URI.create(value);
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!List.of("http", "https").contains(scheme)
        || uri.getHost() == null
        || uri.getRawUserInfo() != null
        || uri.getPort() < -1
        || uri.getPort() > 65535) throw new IllegalArgumentException("Invalid shortcut URL");
    String host = host(uri.getHost());
    int port = uri.getPort();
    if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
    try {
      return new URI(scheme, null, host, port, "/", null, null);
    } catch (java.net.URISyntaxException error) {
      throw new IllegalArgumentException(error);
    }
  }

  static URI canonical(URI uri) {
    String root = origin(uri.toString()).toString();
    String path = uri.getRawPath();
    return URI.create(
        root.substring(0, root.length() - 1)
            + (path == null || path.isEmpty() ? "/" : path)
            + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
  }

  static String host(String input) {
    String host = input.toLowerCase(Locale.ROOT);
    if (host.contains("%")) throw new IllegalArgumentException("Scoped IP address");
    if (host.contains(":")) return ipv6(host.startsWith("[") ? host : "[" + host + "]");
    String[] parts = host.replaceFirst("\\.$", "").split("\\.", -1);
    if (!parts[parts.length - 1].matches("[0-9]+|0[xX][0-9a-fA-F]*")) return host;
    if (parts.length > 4) throw new IllegalArgumentException("Invalid IPv4 address");
    long address = 0;
    for (int index = 0; index < parts.length; index++) {
      String digits = parts[index];
      if (digits.isEmpty()) throw new IllegalArgumentException("Empty IPv4 part");
      int radix = 10;
      if (digits.startsWith("0x")) {
        digits = digits.substring(2);
        radix = 16;
      } else if (digits.length() > 1 && digits.startsWith("0")) {
        digits = digits.substring(1);
        radix = 8;
      }
      String pattern =
          switch (radix) {
            case 16 -> "[0-9a-f]*";
            case 8 -> "[0-7]*";
            default -> "[0-9]*";
          };
      if (!digits.matches(pattern)) throw new IllegalArgumentException("Invalid IPv4 part");
      long number = digits.isEmpty() ? 0 : Long.parseLong(digits, radix);
      long limit = index < parts.length - 1 ? 256 : 1L << (8 * (5 - parts.length));
      if (number >= limit) throw new IllegalArgumentException("IPv4 part out of range");
      address += index < parts.length - 1 ? number << (8 * (3 - index)) : number;
    }
    return (address >>> 24)
        + "."
        + ((address >>> 16) & 255)
        + "."
        + ((address >>> 8) & 255)
        + "."
        + (address & 255);
  }

  private static String ipv6(String host) {
    try {
      byte[] bytes = InetAddress.getByName(host).getAddress(); // Brackets force literal parsing.
      if (bytes.length == 4) {
        byte[] mapped = new byte[16];
        mapped[10] = mapped[11] = (byte) 255;
        System.arraycopy(bytes, 0, mapped, 12, 4);
        bytes = mapped;
      }
      List<String> parts = new ArrayList<>();
      int bestStart = -1, bestLength = 1, start = -1;
      for (int index = 0; index < 8; index++) {
        int number = ((bytes[index * 2] & 255) << 8) | (bytes[index * 2 + 1] & 255);
        parts.add(Integer.toHexString(number));
        if (number == 0) {
          if (start == -1) start = index;
          if (index - start + 1 > bestLength) {
            bestStart = start;
            bestLength = index - start + 1;
          }
        } else start = -1;
      }
      if (bestStart == -1) return "[" + String.join(":", parts) + "]";
      return "["
          + String.join(":", parts.subList(0, bestStart))
          + "::"
          + String.join(":", parts.subList(bestStart + bestLength, 8))
          + "]";
    } catch (java.net.UnknownHostException error) {
      throw new IllegalArgumentException(error);
    }
  }
}
