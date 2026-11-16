package kr.myworkspace.common.database;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

class PreviewKeyBackupTest {
  @TempDir Path directory;

  @Test
  void readsConfiguredKeyAndRejectsInvalidFilesWithoutCreatingAKey() throws Exception {
    Path path = directory.resolve("custom key");
    var settings = new MockEnvironment().withProperty("app.icloud-key-file", path.toString());
    assertThat(PreviewKeyBackup.readKey(settings)).isEmpty();
    assertThat(path).doesNotExist();
    byte[] key = new byte[32];
    key[0] = 1;
    Files.write(path, key);
    assertThat(PreviewKeyBackup.readKey(settings)).isEqualTo(key);
    for (int length : new int[] {0, 31, 33, 64}) {
      Files.write(path, new byte[length]);
      assertThatThrownBy(() -> PreviewKeyBackup.readKey(settings))
          .isInstanceOf(IllegalStateException.class);
    }
  }
}
