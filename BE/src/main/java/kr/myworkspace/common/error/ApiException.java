package kr.myworkspace.common.error;

public class ApiException extends RuntimeException {
  final int status;
  final String code;
  final long retryAfterMs;

  public ApiException(int status, String code, String message) {
    this(status, code, message, 0);
  }

  public ApiException(int status, String code, String message, long retry) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retry;
  }

  public static void require(boolean valid, String message) {
    if (!valid) throw new ApiException(400, "VALIDATION", message);
  }

  public String code() {
    return code;
  }
}
