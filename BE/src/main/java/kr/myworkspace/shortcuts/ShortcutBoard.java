package kr.myworkspace.shortcuts;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record ShortcutBoard(
    @PositiveOrZero long revision, @NotNull @Size(max = 50) List<@NotNull @Valid Group> groups) {
  public record Group(
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{1,64}") String id,
      @NotBlank @Size(max = 80) String name,
      boolean collapsed,
      @NotNull @Size(max = 200) List<@NotNull @Valid Link> links) {}

  public record Link(
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{1,64}") String id,
      @NotBlank @Size(max = 120) String name,
      @NotBlank @Size(max = 2048) String url) {}
}
