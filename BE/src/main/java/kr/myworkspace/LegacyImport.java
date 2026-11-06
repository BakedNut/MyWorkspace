package kr.myworkspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

record LegacyData(
    @Size(max = 500) List<@Valid EventInput> events,
    @Valid Timetable timetable,
    @Size(max = 50) List<@Valid WolDevice> devices) {}

@Service
class LegacyImport {
  final Documents docs;
  final ScheduleService schedule;
  final WolService wol;

  LegacyImport(Documents docs, ScheduleService schedule, WolService wol) {
    this.docs = docs;
    this.schedule = schedule;
    this.wol = wol;
  }

  @Transactional
  Object apply(LegacyData data) {
    var marker = docs.lock("legacy-import");
    if (docs.json.readTree(marker.payload).path("completed").asBoolean())
      throw new ApiException(409, "READ_ONLY", "기존 데이터를 이미 가져왔습니다.");
    ApiException.require(
        data.events() != null || data.timetable() != null || data.devices() != null,
        "가져올 항목을 선택하세요.");
    // Lock settings before checking emptiness; never overwrite newer server data.
    if (data.timetable() != null) {
      docs.lock("timetable");
      if (!schedule.timetable().courses().isEmpty())
        throw new ApiException(409, "READ_ONLY", "서버에 이미 시간표가 있어 가져올 수 없습니다.");
    }
    if (data.devices() != null) {
      docs.lock("wol");
      var current = wol.list();
      boolean initial =
          current.equals(
              List.of(
                  new WolDevice("my-pc", "내 PC", null), new WolDevice("brother-pc", "형 PC", null)));
      if (!initial) throw new ApiException(409, "READ_ONLY", "서버에 이미 수정한 PC 목록이 있어 가져올 수 없습니다.");
    }
    if (data.events() != null && schedule.hasEvents())
      throw new ApiException(409, "READ_ONLY", "서버에 이미 일정이 있어 가져올 수 없습니다.");
    if (data.timetable() != null) schedule.saveTimetable(data.timetable());
    if (data.devices() != null) wol.save(data.devices());
    if (data.events() != null) for (EventInput event : data.events()) schedule.save(null, event);
    docs.write(marker, Map.of("completed", true));
    return Map.of("imported", true);
  }
}

@RestController
class LegacyImportController {
  final LegacyImport importer;

  LegacyImportController(LegacyImport importer) {
    this.importer = importer;
  }

  @PostMapping("/api/import/legacy")
  Object apply(@Valid @RequestBody LegacyData input) {
    return importer.apply(input);
  }
}
