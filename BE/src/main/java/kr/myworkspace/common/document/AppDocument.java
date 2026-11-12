package kr.myworkspace.common.document;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "app_document")
public class AppDocument {
  @Id String id;

  @Column(columnDefinition = "longtext", nullable = false)
  String payload;

  protected AppDocument() {}

  AppDocument(String id, String payload) {
    this.id = id;
    this.payload = payload;
  }
}
