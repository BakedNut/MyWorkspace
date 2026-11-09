package kr.myworkspace.settings;

import jakarta.validation.Valid;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/site")
class SiteSettingsController {
  final DocumentStore docs;

  SiteSettingsController(DocumentStore docs) {
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
