package kr.myworkspace.calendar;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import kr.myworkspace.common.error.ApiException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/calendar/icloud")
class ICloudController {
  final ICloudService cloud;

  ICloudController(ICloudService cloud) {
    this.cloud = cloud;
  }

  static void secure(HttpServletRequest request) {
    if (!request.isSecure()) throw new ApiException(400, "VALIDATION", "계정 연결은 HTTPS 주소에서 진행하세요.");
  }

  record Credentials(
      @NotBlank @Email @Size(max = 254) String appleId,
      @NotBlank @Size(max = 128) String appPassword) {}

  record Selection(
      @NotBlank @Size(max = 64) String draftToken, @NotBlank @Size(max = 64) String calendarId) {}

  @GetMapping("/status")
  Object status(HttpServletRequest req) {
    return cloud.status(req.isSecure());
  }

  @PostMapping("/discover")
  Object discover(@Valid @RequestBody Credentials input, HttpServletRequest req) {
    secure(req);
    return cloud.discover(input.appleId(), input.appPassword());
  }

  @PostMapping("/connect")
  Object connect(@Valid @RequestBody Selection input, HttpServletRequest req) {
    secure(req);
    return cloud.connect(input.draftToken(), input.calendarId(), req.isSecure());
  }

  @PostMapping("/sync")
  Object sync(HttpServletRequest req) {
    return cloud.syncNow(req.isSecure());
  }

  @DeleteMapping
  Object disconnect() {
    cloud.disconnect();
    return Map.of("disconnected", true);
  }
}
