package kr.myworkspace.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kr.myworkspace.common.error.ApiException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
class AuthController {
  private final BCryptPasswordEncoder passwords;
  private final CredentialService credentials;
  private final CsrfTokenRepository csrf;
  private final HttpSessionSecurityContextRepository sessions =
      new HttpSessionSecurityContextRepository();
  private final Map<String, Attempts> attempts = new LinkedHashMap<>();

  record Attempts(int count, long until) {}

  record Login(String password) {}

  AuthController(
      BCryptPasswordEncoder passwords, CsrfTokenRepository csrf, CredentialService credentials) {
    this.passwords = passwords;
    this.csrf = csrf;
    this.credentials = credentials;
  }

  @GetMapping("/csrf")
  Map<String, String> csrf(CsrfToken token) {
    return Map.of("token", token.getToken(), "headerName", token.getHeaderName());
  }

  @GetMapping("/session")
  Object session() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    return auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())
        ? sessionValue()
        : null;
  }

  static Map<String, Object> sessionValue() {
    return Map.of("authenticated", true, "expiresAt", Instant.now().plusSeconds(43200).toString());
  }

  @PostMapping("/login")
  Object login(@RequestBody Login login, HttpServletRequest req, HttpServletResponse res) {
    String ip = SecurityConfig.clientIp(req);
    long now = System.currentTimeMillis();
    synchronized (attempts) {
      attempts.entrySet().removeIf(e -> e.getValue().until < now);
      Attempts old = attempts.getOrDefault(ip, new Attempts(0, now + 900_000));
      if (old.count >= 5)
        throw new ApiException(429, "RATE_LIMITED", "잠시 후 다시 로그인하세요.", old.until - now);
      if (attempts.size() >= 2048 && !attempts.containsKey(ip))
        throw new ApiException(429, "RATE_LIMITED", "잠시 후 다시 로그인하세요.", 60_000);
      attempts.put(ip, new Attempts(old.count + 1, old.until));
    }
    Long verifiedVersion = credentials.authenticate(login.password);
    if (login.password == null || login.password.length() > 128 || verifiedVersion == null)
      throw new ApiException(401, "UNAUTHORIZED", "비밀번호가 올바르지 않습니다.");
    synchronized (attempts) {
      attempts.remove(ip);
    }
    var auth =
        UsernamePasswordAuthenticationToken.authenticated(
            "owner", null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    auth.setDetails(verifiedVersion);
    if (req.getSession(false) != null) req.changeSessionId();
    var context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(auth);
    SecurityContextHolder.setContext(context);
    sessions.saveContext(context, req, res);
    csrf.saveToken(null, req, res);
    return sessionValue();
  }

  @PostMapping("/logout")
  void logout(HttpServletRequest req, HttpServletResponse res) {
    var session = req.getSession(false);
    if (session != null) session.invalidate();
    SecurityContextHolder.clearContext();
    csrf.saveToken(null, req, res);
  }
}
