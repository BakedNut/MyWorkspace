package kr.myworkspace.calendar;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Set;

public record CalendarVisibility(
    @NotNull @Size(max = 100) Set<@NotBlank @Size(max = 64) String> hiddenCalendarIds) {}
