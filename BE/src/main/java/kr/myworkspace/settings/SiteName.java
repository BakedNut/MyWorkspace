package kr.myworkspace.settings;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SiteName(@NotBlank @Size(max = 40) String siteName) {}
