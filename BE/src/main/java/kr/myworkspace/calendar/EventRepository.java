package kr.myworkspace.calendar;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

interface EventRepository extends JpaRepository<StoredEvent, String> {
  List<StoredEvent> findByDateBetweenOrderByDateAsc(LocalDate from, LocalDate to);
}
