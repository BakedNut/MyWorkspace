package kr.myworkspace.wol;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record WolDevice(
    @NotBlank @Size(max = 64) String id,
    @NotBlank @Size(max = 64) String name,
    @Size(max = 32) String mac) {}
