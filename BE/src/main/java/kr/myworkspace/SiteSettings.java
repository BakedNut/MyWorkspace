package kr.myworkspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

record SiteName(@NotBlank @Size(max = 40) String siteName) {}

@RestController
@RequestMapping("/api/site")
class SiteSettings {
  final Documents docs;

  SiteSettings(Documents docs) {
    this.docs = docs;
  }

  @GetMapping
  SiteName get() {
    return docs.read("site-settings", SiteName.class);
  }

  @PutMapping
  @Transactional
  SiteName save(@Valid @RequestBody SiteName input) {
    String name = input.siteName().strip();
    ApiException.require(
        !name.isBlank() && name.codePoints().noneMatch(Character::isISOControl),
        "사이트 이름을 줄바꿈 없이 1~40자로 입력하세요.");
    var settings = new SiteName(name);
    docs.write(docs.lock("site-settings"), settings);
    return settings;
  }
}
