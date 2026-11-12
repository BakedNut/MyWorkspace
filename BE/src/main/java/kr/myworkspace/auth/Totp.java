package kr.myworkspace.auth;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

class Totp {
  static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  static String encode(byte[] bytes) {
    StringBuilder out = new StringBuilder();
    int buffer = 0, bits = 0;
    for (byte value : bytes) {
      buffer = (buffer << 8) | (value & 255);
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out.append(ALPHABET.charAt((buffer >> bits) & 31));
      }
    }
    if (bits > 0) out.append(ALPHABET.charAt((buffer << (5 - bits)) & 31));
    return out.toString();
  }

  static byte[] decode(String text) {
    var out = new java.io.ByteArrayOutputStream();
    int buffer = 0, bits = 0;
    for (char c : text.toCharArray()) {
      int value = ALPHABET.indexOf(c);
      if (value < 0) throw new IllegalArgumentException();
      buffer = (buffer << 5) | value;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        out.write((buffer >> bits) & 255);
      }
    }
    return out.toByteArray();
  }

  static String generate() {
    byte[] bytes = new byte[20];
    new SecureRandom().nextBytes(bytes);
    return encode(bytes);
  }

  static String code(String secret, long step, int digits) {
    try {
      Mac mac = Mac.getInstance("HmacSHA1");
      mac.init(new SecretKeySpec(decode(secret), "HmacSHA1"));
      byte[] hash = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
      int offset = hash[hash.length - 1] & 15;
      int binary = ByteBuffer.wrap(hash, offset, 4).getInt() & 0x7fffffff;
      return String.format(
          java.util.Locale.ROOT,
          "%0" + digits + "d",
          binary % (digits == 8 ? 100_000_000 : 1_000_000));
    } catch (Exception e) {
      throw new IllegalStateException("OTP verification failed");
    }
  }

  static long verify(String secret, String input, long epochSeconds, long lastUsed) {
    if (input == null || !input.matches("[0-9]{6}")) return -1;
    long step = epochSeconds / 30;
    for (long candidate = step - 1; candidate <= step + 1; candidate++)
      if (candidate > lastUsed
          && MessageDigest.isEqual(
              code(secret, candidate, 6).getBytes(StandardCharsets.US_ASCII),
              input.getBytes(StandardCharsets.US_ASCII))) return candidate;
    return -1;
  }
}
