package kr.myworkspace.common.document;

import java.util.Optional;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

@Service
public class DocumentStore {
  private final DocumentRepository repository;
  private final JsonMapper json;

  DocumentStore(DocumentRepository repository, JsonMapper json) {
    this.repository = repository;
    this.json = json;
  }

  public <T> T read(String id, Class<T> type) {
    return json.readValue(repository.findById(id).orElseThrow().payload, type);
  }

  public <T> T read(AppDocument document, Class<T> type) {
    return json.readValue(document.payload, type);
  }

  public boolean exists(String id) {
    return repository.existsById(id);
  }

  public Optional<String> findRaw(String id) {
    return repository.findById(id).map(document -> document.payload);
  }

  public void save(String id, Object value) {
    saveRaw(id, json.writeValueAsString(value));
  }

  public void saveRaw(String id, String payload) {
    repository.save(new AppDocument(id, payload));
  }

  public AppDocument lock(String id) {
    return repository.locked(id).orElseThrow();
  }

  public void write(AppDocument doc, Object value) {
    doc.payload = json.writeValueAsString(value);
    repository.save(doc);
  }
}
