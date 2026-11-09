package kr.myworkspace.calendar;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

public record Timetable(
    @NotNull LocalDate semesterStart,
    @NotNull LocalDate semesterEnd,
    @NotNull @Size(max = 100) List<@NotNull @Valid Course> courses) {}
