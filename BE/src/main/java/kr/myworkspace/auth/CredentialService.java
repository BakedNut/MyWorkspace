package kr.myworkspace.auth;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import kr.myworkspace.common.crypto.SecretCipher;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
class CredentialService {
  final DocumentStore docs;
  final JsonMapper json;
  final SecretCipher secrets;
  final BCryptPasswordEncoder encoder;
  final TransactionTemplate tx;
  final Clock clock;
  final String initialHash;

  record Attempts(int count, long until) {}

  final Map<String, Attempts> attempts = new LinkedHashMap<>();
  long globalUntil;
  int globalAttempts;

  CredentialService(
      DocumentStore docs, JsonMapper json,
      SecretCipher secrets,
      BCryptPasswordEncoder encoder,
      TransactionTemplate tx,
      Clock clock,
      @Value("${app.password-hash}") String initialHash) {
    if (!initialHash.matches("\\$2[aby]\\$\\d\\d\\$.{53}"))
      throw new IllegalArgumentException("APP_PASSWORD_HASH must be BCrypt");
    this.docs = docs;
    this.json = json;
    this.secrets = secrets;
    this.encoder = encoder;
    this.tx = tx;
    this.clock = clock;
    this.initialHash = initialHash;
  }

  SecurityState state() {
    return docs.read("security-settings", SecurityState.class);
  }

  String hash(SecurityState state) {
    return state.passwordHash() == null ? initialHash : state.passwordHash();
  }

  Long authenticate(String password) {
    var state = state();
    return password != null
            && password.getBytes(StandardCharsets.UTF_8).length <= 72
            && encoder.matches(password, hash(state))
        ? state.version()
        : null;
  }

  long version() {
    return state().version();
  }

  void reserve(String ip) {
    long now = clock.instant().toEpochMilli();
    synchronized (attempts) {
      if (now >= globalUntil) {
        globalUntil = now + 900_000;
        globalAttempts = 0;
      }
      if (globalAttempts >= 30)
        throw new ApiException(429, "RATE_LIMITED", "잠시 후 다시 시도하세요.", globalUntil - now);
      globalAttempts++;
      attempts.entrySet().removeIf(e -> e.getValue().until() < now);
      var old = attempts.getOrDefault(ip, new Attempts(0, now + 900_000));
      if (old.count() >= 5 || attempts.size() >= 2048 && !attempts.containsKey(ip))
        throw new ApiException(
            429, "RATE_LIMITED", "잠시 후 다시 시도하세요.", Math.max(1000, old.until() - now));
      attempts.put(ip, new Attempts(old.count() + 1, old.until()));
    }
  }

  void success(String ip) {
    synchronized (attempts) {
      attempts.remove(ip);
    }
  }

  long proof(SecurityState state, String method, String password, String otp) {
    if ("password".equals(method)
        && password != null
        && password.getBytes(StandardCharsets.UTF_8).length <= 72
        && encoder.matches(password, hash(state))) return state.lastUsedStep();
    if ("otp".equals(method) && state.otpSecret() != null) {
      long used =
          Totp.verify(
              secrets.decrypt(state.otpSecret(), "otp"),
              otp,
              clock.instant().getEpochSecond(),
              state.lastUsedStep());
      if (used >= 0) return used;
    }
    throw new ApiException(400, "VALIDATION", "본인 확인 정보가 올바르지 않거나 이미 사용한 OTP입니다.");
  }

  static String digest(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  long change(
      String ip, String method, String password, String otp, String replacement, String confirm) {
    ApiException.require(
        replacement != null
            && replacement.length() >= 12
            && replacement.getBytes(StandardCharsets.UTF_8).length <= 72,
        "새 비밀번호는 12자 이상으로 입력하세요. 너무 긴 경우 길이를 줄여주세요.");
    ApiException.require(replacement.equals(confirm), "새 비밀번호 확인이 일치하지 않습니다.");
    reserve(ip);
    Long version =
        tx.execute(
            status -> {
              var doc = docs.lock("security-settings");
              var old = docs.read(doc, SecurityState.class);
              long step = proof(old, method, password, otp);
              docs.write(
                  doc,
                  new SecurityState(
                      encoder.encode(replacement),
                      old.version() + 1,
                      old.otpSecret(),
                      step,
                      null,
                      null,
                      null,
                      0));
              return old.version() + 1;
            });
    success(ip);
    return Objects.requireNonNull(version);
  }

  Object begin(String ip, String password, String session) {
    reserve(ip);
    Object result =
        tx.execute(
            status -> {
              var doc = docs.lock("security-settings");
              var old = docs.read(doc, SecurityState.class);
              proof(old, "password", password, null);
              String secret = Totp.generate(), token = UUID.randomUUID().toString();
              docs.write(
                  doc,
                  new SecurityState(
                      old.passwordHash(),
                      old.version(),
                      old.otpSecret(),
                      old.lastUsedStep(),
                      secrets.encrypt(secret, "otp"),
                      digest(token),
                      digest(session),
                      clock.instant().toEpochMilli() + 600_000));
              String label =
                  URLEncoder.encode("MyWorkspace:개인 계정", StandardCharsets.UTF_8)
                      .replace("+", "%20");
              return Map.of(
                  "secret",
                  secret,
                  "setupToken",
                  token,
                  "uri",
                  "otpauth://totp/"
                      + label
                      + "?secret="
                      + secret
                      + "&issuer=MyWorkspace&algorithm=SHA1&digits=6&period=30");
            });
    success(ip);
    return result;
  }

  void confirm(String ip, String session, String token, String code) {
    reserve(ip);
    tx.executeWithoutResult(
        status -> {
          var doc = docs.lock("security-settings");
          var old = docs.read(doc, SecurityState.class);
          ApiException.require(
              old.pendingSecret() != null
                  && old.pendingExpires() > clock.instant().toEpochMilli()
                  && Objects.equals(digest(session), old.pendingSession())
                  && Objects.equals(digest(token), old.pendingToken()),
              "OTP 등록 시간이 만료됐습니다. 다시 등록하세요.");
          long step =
              Totp.verify(
                  secrets.decrypt(old.pendingSecret(), "otp"),
                  code,
                  clock.instant().getEpochSecond(),
                  -1);
          ApiException.require(step >= 0, "인증번호가 올바르지 않습니다. 앱의 새 코드를 확인하세요.");
          docs.write(
              doc,
              new SecurityState(
                  old.passwordHash(),
                  old.version(),
                  old.pendingSecret(),
                  step,
                  null,
                  null,
                  null,
                  0));
        });
    success(ip);
  }

  void disable(String ip, String method, String password, String otp) {
    reserve(ip);
    tx.executeWithoutResult(
        status -> {
          var doc = docs.lock("security-settings");
          var old = docs.read(doc, SecurityState.class);
          proof(old, method, password, otp);
          docs.write(
              doc,
              new SecurityState(old.passwordHash(), old.version(), null, -1, null, null, null, 0));
        });
    success(ip);
  }
}
