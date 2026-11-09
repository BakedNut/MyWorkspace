package kr.myworkspace.common.crypto;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import kr.myworkspace.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SecretCipher {
  final Path path;
  final SecureRandom random = new SecureRandom();

  SecretCipher(@Value("${app.icloud-key-file}") String path) {
    this.path = Path.of(path);
  }

  synchronized SecretKeySpec key(boolean create) throws Exception {
    if (!Files.exists(path) && create) {
      byte[] value = new byte[32];
      random.nextBytes(value);
      Files.createFile(
          path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
      Files.write(path, value);
    }
    byte[] value = Files.readAllBytes(path);
    if (value.length != 32) throw new IllegalStateException("Invalid encryption key");
    return new SecretKeySpec(value, "AES");
  }

  public String encrypt(String value) {
    return encrypt(value, "icloud");
  }

  public String encrypt(String value, String purpose) {
    try {
      byte[] iv = new byte[12];
      random.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key(true), new GCMParameterSpec(128, iv));
      cipher.updateAAD(
          ("myworkspace-" + purpose + "-v1").getBytes(java.nio.charset.StandardCharsets.UTF_8));
      return Base64.getEncoder().encodeToString(iv)
          + "."
          + Base64.getEncoder()
              .encodeToString(
                  cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new ApiException(503, "NETWORK", "연결 정보를 안전하게 저장하지 못했습니다.");
    }
  }

  public String decrypt(String value) {
    return decrypt(value, "icloud");
  }

  public String decrypt(String value, String purpose) {
    try {
      var parts = value.split("\\.", -1);
      if (parts.length != 2) throw new IllegalArgumentException();
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          key(false),
          new GCMParameterSpec(128, Base64.getDecoder().decode(parts[0])));
      cipher.updateAAD(
          ("myworkspace-" + purpose + "-v1").getBytes(java.nio.charset.StandardCharsets.UTF_8));
      return new String(
          cipher.doFinal(Base64.getDecoder().decode(parts[1])),
          java.nio.charset.StandardCharsets.UTF_8);
    } catch (Exception e) {
      throw new ApiException(503, "NETWORK", "저장된 연결 정보를 읽지 못했습니다. 서버 암호화 키를 확인하세요.");
    }
  }
}
