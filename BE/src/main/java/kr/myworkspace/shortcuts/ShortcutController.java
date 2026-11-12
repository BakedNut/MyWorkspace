package kr.myworkspace.shortcuts;

import jakarta.validation.Valid;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shortcuts")
class ShortcutController {
  final ShortcutService service;
  final ShortcutIconService icons;

  ShortcutController(ShortcutService service, ShortcutIconService icons) {
    this.service = service;
    this.icons = icons;
  }

  @GetMapping
  ShortcutBoard get() {
    return service.get();
  }

  @GetMapping("/icons/{id}")
  CompletableFuture<ResponseEntity<byte[]>> icon(
      @PathVariable String id, @RequestParam(required = false) String site) {
    return icons
        .get(id, site)
        .thenApply(
            icon -> {
              if (icon == null)
                return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
              return ResponseEntity.ok()
                  .cacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePrivate())
                  .contentType(MediaType.parseMediaType(icon.mediaType()))
                  .header(
                      "Content-Security-Policy",
                      "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                  .header("X-Content-Type-Options", "nosniff")
                  .body(icon.data());
            });
  }

  @PutMapping
  ShortcutBoard save(@Valid @RequestBody ShortcutBoard input) {
    return service.save(input);
  }
}
