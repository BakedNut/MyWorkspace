package kr.myworkspace.calendar.icloud;

import java.util.HashMap;
import java.util.Map;
import kr.myworkspace.common.crypto.SecretCipher;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
class ICloudCoordinator {
  final Object lock = new Object();
  final DocumentStore docs;
  final JsonMapper json;
  final SecretCipher secrets;
  final Map<String, CloudDraft> drafts = new HashMap<>();
  long generation, connectionGeneration, nextDiscovery;
  boolean cacheDirty;

  ICloudCoordinator(DocumentStore docs, JsonMapper json, SecretCipher secrets) {
    this.docs = docs;
    this.json = json;
    this.secrets = secrets;
  }

  CloudState read() {
    return docs.read("icloud", CloudState.class);
  }

  void store(CloudState state) {
    docs.save("icloud", state);
  }

  CloudAccount account(CloudState state) {
    return json.readValue(secrets.decrypt(state.encryptedCredentials()), CloudAccount.class);
  }

  record Snapshot(long generation, long connectionGeneration, CloudState state) {}

  Snapshot snapshot() {
    synchronized (lock) {
      return new Snapshot(generation, connectionGeneration, read());
    }
  }

  boolean current(Snapshot before) {
    return before.connectionGeneration() == connectionGeneration;
  }

  boolean unchanged(Snapshot before) {
    return current(before) && before.generation() == generation;
  }

  Snapshot writableSnapshot() {
    var before = snapshot();
    ApiException.require(before.state().calendar() != null, "iCloud를 먼저 연결하세요.");
    if (before.state().calendar().readOnly())
      throw new ApiException(403, "READ_ONLY", "읽기 전용 캘린더입니다.");
    return before;
  }

  void changedConnection() {
    generation++;
    connectionGeneration++;
    cacheDirty = false;
    drafts.clear();
  }
}
