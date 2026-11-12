package kr.myworkspace.calendar.timetable;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TimetableService {
  final DocumentStore docs;

  TimetableService(DocumentStore docs) {
    this.docs = docs;
  }

  public Timetable read() {
    return docs.read("timetable", Timetable.class);
  }

  static void timeRange(String start, String end) {
    ApiException.require(
        start != null
            && end != null
            && start.matches("\\d{2}:\\d{2}")
            && end.matches("\\d{2}:\\d{2}"),
        "시작·종료 시간을 확인하세요.");
    ApiException.require(
        LocalTime.parse(start).isBefore(LocalTime.parse(end)), "종료 시간은 시작 시간보다 늦어야 합니다.");
  }

  @Transactional
  public Timetable save(Timetable table) {
    ApiException.require(
        !table.semesterEnd().isBefore(table.semesterStart())
            && !table.semesterEnd().isAfter(table.semesterStart().plusYears(1)),
        "학기 기간을 확인하세요.");
    Set<String> ids = new HashSet<>();
    List<CourseTime> previous = new ArrayList<>();
    for (Course c : table.courses()) {
      ApiException.require(ids.add(c.id()), "수업 식별자가 중복됩니다.");
      Set<String> timeIds = new HashSet<>();
      for (var time : c.times()) {
        ApiException.require(timeIds.add(time.id()), "수업 시간 식별자가 중복됩니다.");
        timeRange(time.start(), time.end());
        ApiException.require(
            time.cancelledDates().stream()
                .allMatch(
                    d -> !d.isBefore(table.semesterStart()) && !d.isAfter(table.semesterEnd())),
            "휴강일은 학기 기간 안에 지정하세요.");
        for (CourseTime other : previous)
          ApiException.require(
              other.weekday() != time.weekday()
                  || time.start().compareTo(other.end()) >= 0
                  || other.start().compareTo(time.end()) >= 0,
              "같은 요일의 수업 시간이 겹칩니다.");
        previous.add(time);
      }
    }
    docs.write(docs.lock("timetable"), table);
    return table;
  }
}
