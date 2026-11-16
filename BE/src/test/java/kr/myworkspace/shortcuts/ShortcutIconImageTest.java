package kr.myworkspace.shortcuts;

import static org.assertj.core.api.Assertions.*;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class ShortcutIconImageTest {
  @Test
  void normalizesImagesAndRejectsEmptyOrOversizedImages() throws Exception {
    var image = new BufferedImage(32, 16, BufferedImage.TYPE_INT_ARGB);
    var output = new ByteArrayOutputStream();
    ImageIO.write(image, "png", output);
    assertThat(ShortcutIconImage.decode(output.toByteArray())).isNull();
    image.setRGB(10, 10, 0xff0080ff);
    output.reset();
    ImageIO.write(image, "png", output);
    var icon = ShortcutIconImage.decode(output.toByteArray());
    assertThat(icon.mediaType()).isEqualTo("image/png");
    assertThat(ImageIO.read(new java.io.ByteArrayInputStream(icon.data())).getWidth())
        .isEqualTo(64);
    assertThat(ShortcutIconImage.decode(new byte[256 * 1024 + 1])).isNull();
    assertThat(ShortcutIconImage.decode("<html>not an icon</html>".getBytes())).isNull();
  }

  @Test
  void removesActiveSvgContentAndExternalResources() {
    String svg =
        """
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)">
          <script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject>
          <image href="http://evil.example/image.png"/>
          <path d="M0 0 L24 24" style="stroke:#0080ff; fill:url(https://evil.example/payload)"/>
        </svg>
        """;
    var icon = ShortcutIconImage.decode(svg.getBytes(StandardCharsets.UTF_8));
    assertThat(icon.mediaType()).isEqualTo("image/svg+xml");
    assertThat(new String(icon.data(), StandardCharsets.UTF_8))
        .contains("path", "stroke=\"#0080ff\"")
        .doesNotContain("script", "onload", "foreignObject", "evil.example", "<image");
    assertThat(ShortcutIconImage.decode("<svg xmlns='http://www.w3.org/2000/svg'/>".getBytes()))
        .isNull();
    assertThat(
            ShortcutIconImage.decode(
                "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg xmlns='http://www.w3.org/2000/svg'><path d='&x;'/></svg>"
                    .getBytes()))
        .isNull();
  }
}
