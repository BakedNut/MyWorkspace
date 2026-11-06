package kr.myworkspace;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/security")
class SecuritySettings {
  final Credentials credentials;
  final CsrfTokenRepository csrf;
  final String publicUrl;

  SecuritySettings(
      Credentials credentials,
      CsrfTokenRepository csrf,
      @Value("${app.public-url}") String publicUrl) {
    this.credentials = credentials;
    this.csrf = csrf;
    this.publicUrl = publicUrl;
  }

  record Proof(
      @NotBlank String method,
      @Size(max = 128) String currentPassword,
      @Size(max = 6) String otp) {}

  record Change(
      @NotBlank String method,
      @Size(max = 128) String currentPassword,
      @Size(max = 6) String otp,
      @NotBlank @Size(max = 128) String newPassword,
      @NotBlank @Size(max = 128) String confirmPassword) {}

  record Begin(@NotBlank @Size(max = 128) String currentPassword) {}

  record Confirm(
      @NotBlank @Size(max = 64) String setupToken,
      @NotBlank @Pattern(regexp = "[0-9]{6}") String code) {}

  static void secure(HttpServletRequest request) {
    if (!request.isSecure()) throw new ApiException(400, "VALIDATION", "암호 설정은 HTTPS 주소에서 진행하세요.");
  }

  @GetMapping
  Object status(HttpServletRequest request) {
    var state = credentials.state();
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("otpEnabled", state.otpSecret() != null);
    result.put("passwordChanged", state.passwordHash() != null);
    result.put("requiresHttps", !request.isSecure());
    result.put(
        "secureSetupUrl",
        publicUrl.startsWith("https://") ? publicUrl.replaceAll("/+$", "") + "/" : null);
    return result;
  }

  @PostMapping("/password")
  Object change(@Valid @RequestBody Change input, HttpServletRequest req, HttpServletResponse res) {
    secure(req);
    long version =
        credentials.change(
            Security.clientIp(req),
            input.method(),
            input.currentPassword(),
            input.otp(),
            input.newPassword(),
            input.confirmPassword());
    if (req.getSession(false) != null) req.changeSessionId();
    var auth =
        UsernamePasswordAuthenticationToken.authenticated(
            "owner", null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    auth.setDetails(version);
    var context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(auth);
    SecurityContextHolder.setContext(context);
    new HttpSessionSecurityContextRepository().saveContext(context, req, res);
    csrf.saveToken(null, req, res);
    return Map.of("changed", true);
  }

  @PostMapping("/otp/setup")
  Object begin(@Valid @RequestBody Begin input, HttpServletRequest req) {
    secure(req);
    return credentials.begin(
        Security.clientIp(req), input.currentPassword(), req.getSession().getId());
  }

  @PostMapping("/otp/confirm")
  Object confirm(@Valid @RequestBody Confirm input, HttpServletRequest req) {
    secure(req);
    credentials.confirm(
        Security.clientIp(req), req.getSession().getId(), input.setupToken(), input.code());
    return Map.of("enabled", true);
  }

  @DeleteMapping("/otp")
  Object disable(@Valid @RequestBody Proof input, HttpServletRequest req) {
    secure(req);
    credentials.disable(
        Security.clientIp(req), input.method(), input.currentPassword(), input.otp());
    return Map.of("enabled", false);
  }
}
