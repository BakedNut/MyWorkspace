package kr.myworkspace.calendar.event;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

@Entity
@Table(name = "calendar_event")
class StoredEvent {
  @Id
  @Column(length = 64)
  String id;

  @Column(name = "event_date", nullable = false)
  LocalDate date;

  @Column(columnDefinition = "longtext", nullable = false)
  String payload;

  @jakarta.persistence.Version
  @Column(nullable = false)
  Long version;

  protected StoredEvent() {}

  StoredEvent(String id, LocalDate date, String payload) {
    this.id = id;
    this.date = date;
    this.payload = payload;
  }
}
