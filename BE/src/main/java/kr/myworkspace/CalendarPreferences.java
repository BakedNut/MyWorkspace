package kr.myworkspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Set;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

record CalendarVisibility(
    @NotNull @Size(max = 100) Set<@NotBlank @Size(max = 64) String> hiddenCalendarIds) {}

@RestController
@RequestMapping("/api/calendar/visibility")
class CalendarPreferences {
  final Documents docs;

  CalendarPreferences(Documents docs) {
    this.docs = docs;
  }

  @GetMapping
  CalendarVisibility get() {
    return docs.read("calendar-visibility", CalendarVisibility.class);
  }

  @PutMapping
  @Transactional
  CalendarVisibility save(@Valid @RequestBody CalendarVisibility input) {
    docs.write(docs.lock("calendar-visibility"), input);
    return input;
  }
}
