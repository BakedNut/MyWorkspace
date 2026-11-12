package kr.myworkspace.calendar.timetable;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

public record CourseTime(
    @NotBlank @Size(max = 64) String id,
    @Min(0) @Max(6) int weekday,
    @NotBlank String start,
    @NotBlank String end,
    @Size(max = 100) String room,
    @Size(max = 400) List<@NotNull LocalDate> cancelledDates) {}
