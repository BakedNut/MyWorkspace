package kr.myworkspace.common.database;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.Environment;

/** Read-only key export for the private backup process. */
public class PreviewKeyBackup {
  public static void main(String[] args) throws IOException {
    try (var context =
        new SpringApplicationBuilder(PreviewKeyBackup.class)
            .web(WebApplicationType.NONE)
            .run(args)) {
      System.out.println(
          "PREVIEW_BACKUP_KEY=" + HexFormat.of().formatHex(readKey(context.getEnvironment())));
    }
  }

  static byte[] readKey(Environment environment) throws IOException {
    Path path = Path.of(environment.getRequiredProperty("app.icloud-key-file"));
    if (Files.notExists(path)) return new byte[0];
    try (var input = Files.newInputStream(path)) {
      byte[] key = input.readNBytes(33);
      if (key.length != 32) throw new IllegalStateException("Invalid preview encryption key");
      return key;
    }
  }
}
