package kr.myworkspace.calendar.event;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

interface EventRepository extends JpaRepository<StoredEvent, String> {
  @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @org.springframework.data.jpa.repository.Query("select e from StoredEvent e where e.id=:id")
  java.util.Optional<StoredEvent> locked(
      @org.springframework.data.repository.query.Param("id") String id);

  List<StoredEvent> findByDateBetweenOrderByDateAsc(LocalDate from, LocalDate to);
}
