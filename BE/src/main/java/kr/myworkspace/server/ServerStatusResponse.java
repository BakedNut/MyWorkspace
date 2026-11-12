package kr.myworkspace.server;

import java.util.List;

public record ServerStatusResponse(
    String hostName,
    String updatedAt,
    Cpu cpu,
    Ram ram,
    Network network,
    List<Storage> storages,
    List<GuestStatus> guests) {
  public record Cpu(double usagePercent, int cores, Double tempC) {}

  public record Ram(double usedMb, double totalMb) {}

  public record Network(double inputBytesPerSecond, double outputBytesPerSecond) {}

  public record Storage(String name, double usedGb, double totalGb, Double tempC) {}

  public record GuestDisk(Double usedGb, double totalGb) {}

  public record GuestStatus(
      int id,
      String name,
      String type,
      String status,
      double cpuPercent,
      double memUsedMb,
      double memTotalMb,
      Network network,
      GuestDisk disk) {}
}
