package kr.myworkspace.calendar;

import jakarta.validation.Valid;
import kr.myworkspace.common.document.DocumentStore;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/calendar/visibility")
class CalendarPreferencesController {
  final DocumentStore docs;

  CalendarPreferencesController(DocumentStore docs) {
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
