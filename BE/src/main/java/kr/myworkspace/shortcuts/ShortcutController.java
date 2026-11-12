package kr.myworkspace.shortcuts;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shortcuts")
class ShortcutController {
  final ShortcutService service;

  ShortcutController(ShortcutService service) {
    this.service = service;
  }

  @GetMapping
  ShortcutBoard get() {
    return service.get();
  }

  @PutMapping
  ShortcutBoard save(@Valid @RequestBody ShortcutBoard input) {
    return service.save(input);
  }
}
