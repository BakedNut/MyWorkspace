package kr.myworkspace.server;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record MetricHistoryResponse(
    long from, long to, ResourceHistory host, Map<String, ResourceHistory> guests) {
  public record Point(long at, Double value) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record ResourceHistory(
      List<Point> cpu, List<Point> ram, List<Point> input, List<Point> output, List<Point> disk) {
    static ResourceHistory empty(boolean guest) {
      return new ResourceHistory(
          new ArrayList<>(),
          new ArrayList<>(),
          new ArrayList<>(),
          new ArrayList<>(),
          guest ? new ArrayList<>() : null);
    }

    Map<String, List<Point>> series() {
      Map<String, List<Point>> values = new LinkedHashMap<>();
      values.put("cpu", cpu);
      values.put("ram", ram);
      values.put("input", input);
      values.put("output", output);
      if (disk != null) values.put("disk", disk);
      return values;
    }
  }
}
