package kr.myworkspace.calendar.timetable;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public record Course(
    @NotBlank @Size(max = 64) String id,
    @NotBlank @Size(max = 100) String name,
    @Size(max = 100) String room,
    @Size(max = 100) String professor,
    @Min(0) @Max(6) int weekday,
    @NotBlank String start,
    @NotBlank String end,
    @NotNull @Size(max = 400) List<@NotNull LocalDate> cancelledDates,
    @Size(max = 20) List<@NotNull @Valid CourseTime> additionalTimes) {
  public Course(
      String id,
      String name,
      String room,
      String professor,
      int weekday,
      String start,
      String end,
      List<LocalDate> cancelledDates) {
    this(id, name, room, professor, weekday, start, end, cancelledDates, null);
  }

  public List<CourseTime> times() {
    List<CourseTime> result = new ArrayList<>();
    result.add(new CourseTime("primary", weekday, start, end, room, cancelledDates));
    if (additionalTimes != null)
      for (var time : additionalTimes)
        result.add(
            new CourseTime(
                time.id(),
                time.weekday(),
                time.start(),
                time.end(),
                time.room() == null || time.room().isBlank() ? room : time.room(),
                time.cancelledDates() == null ? List.of() : time.cancelledDates()));
    return result;
  }
}
