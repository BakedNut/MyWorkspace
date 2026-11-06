package kr.myworkspace;

import jakarta.persistence.*;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

@Entity
@Table(name = "app_document")
class AppDocument {
  @Id String id;

  @Column(columnDefinition = "longtext", nullable = false)
  String payload;

  protected AppDocument() {}

  AppDocument(String id, String payload) {
    this.id = id;
    this.payload = payload;
  }
}

interface DocumentRepository extends JpaRepository<AppDocument, String> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select d from AppDocument d where d.id = :id")
  Optional<AppDocument> locked(@Param("id") String id);
}

@Service
class Documents {
  final DocumentRepository repository;
  final JsonMapper json;

  Documents(DocumentRepository repository, JsonMapper json) {
    this.repository = repository;
    this.json = json;
  }

  <T> T read(String id, Class<T> type) {
    return json.readValue(repository.findById(id).orElseThrow().payload, type);
  }

  AppDocument lock(String id) {
    return repository.locked(id).orElseThrow();
  }

  void write(AppDocument doc, Object value) {
    doc.payload = json.writeValueAsString(value);
    repository.save(doc);
  }
}
