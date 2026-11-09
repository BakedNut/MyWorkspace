package kr.myworkspace;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

class ApiException extends RuntimeException {
  final int status;
  final String code;
  final long retryAfterMs;

  ApiException(int status, String code, String message) {
    this(status, code, message, 0);
  }

  ApiException(int status, String code, String message, long retry) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retry;
  }

  static void require(boolean valid, String message) {
    if (!valid) throw new ApiException(400, "VALIDATION", message);
  }
}

@RestControllerAdvice
class ApiErrors {
  @ExceptionHandler(org.springframework.dao.DataAccessException.class)
  ResponseEntity<?> database(Exception e) {
    org.slf4j.LoggerFactory.getLogger(getClass())
        .warn("DB 요청 실패: {}", e.getClass().getSimpleName());
    return ResponseEntity.status(503)
        .body(Map.of("message", "서버에 저장하거나 불러오지 못했습니다. 잠시 후 다시 시도하세요.", "code", "NETWORK"));
  }

  @ExceptionHandler(ApiException.class)
  ResponseEntity<?> api(ApiException e) {
    return ResponseEntity.status(e.status)
        .body(Map.of("message", e.getMessage(), "code", e.code, "retryAfterMs", e.retryAfterMs));
  }

  @ExceptionHandler({
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
    java.time.DateTimeException.class,
    jakarta.validation.ConstraintViolationException.class,
    org.springframework.web.bind.MethodArgumentNotValidException.class
  })
  ResponseEntity<?> invalid(Exception e) {
    return ResponseEntity.badRequest()
        .body(Map.of("message", "입력 형식을 확인하세요.", "code", "VALIDATION"));
  }
}
