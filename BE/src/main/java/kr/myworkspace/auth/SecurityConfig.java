package kr.myworkspace.auth;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class SecurityConfig {
  public static final String CLIENT_HEADER = "X-MyWorkspace-Client-IP";

  static boolean loopback(HttpServletRequest request) {
    return Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1").contains(request.getRemoteAddr());
  }

  static String clientIp(HttpServletRequest request) {
    String ip = loopback(request) ? request.getHeader(CLIENT_HEADER) : request.getRemoteAddr();
    // Accept numeric addresses only; host names must never trigger DNS-based trust.
    return ip != null && ip.matches("[0-9a-fA-F:.]{3,45}") ? ip : "unknown";
  }

  @Bean
  CsrfTokenRepository csrfTokens() {
    return new HttpSessionCsrfTokenRepository();
  }

  @Bean
  BCryptPasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  @Bean
  java.time.Clock securityClock() {
    return java.time.Clock.systemUTC();
  }

  @Bean
  org.springframework.security.core.userdetails.UserDetailsService users() {
    return username -> {
      throw new org.springframework.security.core.userdetails.UsernameNotFoundException(username);
    };
  }

  @Bean
  SecurityFilterChain chain(
      HttpSecurity http,
      CsrfTokenRepository tokens,
      CredentialService credentials,
      @Value("${app.trusted-networks}") String networks)
      throws Exception {
    List<IpAddressMatcher> trusted =
        Arrays.stream(networks.split(","))
            .map(String::trim)
            .filter(s -> !s.isBlank())
            .map(IpAddressMatcher::new)
            .toList();
    http.csrf(csrf -> csrf.csrfTokenRepository(tokens))
        .authorizeHttpRequests(
            auth ->
                auth.dispatcherTypeMatchers(DispatcherType.ERROR)
                    .permitAll()
                    .requestMatchers("/api/auth/**", "/api/health")
                    .permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/site")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .requestCache(cache -> cache.disable())
        .formLogin(form -> form.disable())
        .httpBasic(basic -> basic.disable())
        .logout(logout -> logout.disable())
        .exceptionHandling(
            errors ->
                errors
                    .authenticationEntryPoint(
                        (req, res, e) -> writeError(res, 401, "UNAUTHORIZED", "로그인이 필요합니다."))
                    .accessDeniedHandler(
                        (req, res, e) -> writeError(res, 403, "CSRF", "요청을 확인하지 못했습니다. 다시 시도하세요.")))
        .addFilterBefore(
            new OncePerRequestFilter() {
              @Override
              protected void doFilterInternal(
                  HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                  throws ServletException, IOException {
                String ip = clientIp(req);
                boolean allowed = false;
                if (!ip.equals("unknown")) {
                  try {
                    allowed = trusted.stream().anyMatch(m -> m.matches(ip));
                  } catch (IllegalArgumentException ignored) {
                  }
                }
                var current = SecurityContextHolder.getContext().getAuthentication();
                if (current != null && "owner".equals(current.getPrincipal())) {
                  try {
                    if (!Objects.equals(current.getDetails(), credentials.version())) {
                      SecurityContextHolder.setContext(SecurityContextHolder.createEmptyContext());
                      current = null;
                    }
                  } catch (org.springframework.dao.DataAccessException failure) {
                    writeError(res, 503, "NETWORK", "인증 상태를 확인하지 못했습니다.");
                    return;
                  }
                }
                if (allowed
                    && (current == null || current instanceof AnonymousAuthenticationToken)) {
                  var context = SecurityContextHolder.createEmptyContext();
                  context.setAuthentication(
                      UsernamePasswordAuthenticationToken.authenticated(
                          "network", null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
                  SecurityContextHolder.setContext(context);
                }
                chain.doFilter(req, res);
              }
            },
            AuthorizationFilter.class);
    return http.build();
  }

  static void writeError(HttpServletResponse response, int status, String code, String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}");
  }
}
