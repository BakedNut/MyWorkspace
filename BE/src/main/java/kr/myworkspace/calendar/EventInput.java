package kr.myworkspace.calendar;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record EventInput(
    @NotBlank @Size(max = 64) String calendarId,
    @NotBlank @Size(max = 200) String title,
    @NotNull LocalDate date,
    boolean allDay,
    String start,
    String end,
    @Size(max = 200) String location,
    @Size(max = 10000) String memo,
    @Size(max = 1024) String revision,
    @Pattern(regexp = "[0-9a-fA-F-]{36}") String requestId) {
  public EventInput(
      String calendarId,
      String title,
      LocalDate date,
      boolean allDay,
      String start,
      String end,
      String location,
      String memo) {
    this(calendarId, title, date, allDay, start, end, location, memo, null, null);
  }
}
