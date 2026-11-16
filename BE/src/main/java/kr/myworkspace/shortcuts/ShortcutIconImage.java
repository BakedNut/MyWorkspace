package kr.myworkspace.shortcuts;

import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Locale;
import java.util.Set;
import javax.imageio.ImageIO;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Element;
import org.xml.sax.helpers.DefaultHandler;

final class ShortcutIconImage {
  static final String SVG = "http://www.w3.org/2000/svg";
  static final Set<String> ELEMENTS =
      Set.of(
          "svg",
          "g",
          "path",
          "circle",
          "rect",
          "ellipse",
          "polygon",
          "polyline",
          "line",
          "defs",
          "linearGradient",
          "radialGradient",
          "stop",
          "clipPath",
          "mask",
          "title",
          "desc");
  static final Set<String> ATTRIBUTES =
      Set.of(
          "xmlns",
          "viewbox",
          "width",
          "height",
          "id",
          "d",
          "fill",
          "fill-rule",
          "fill-opacity",
          "stroke",
          "stroke-width",
          "stroke-opacity",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-miterlimit",
          "clip-rule",
          "clip-path",
          "mask",
          "opacity",
          "transform",
          "cx",
          "cy",
          "r",
          "rx",
          "ry",
          "x",
          "y",
          "x1",
          "x2",
          "y1",
          "y2",
          "points",
          "offset",
          "stop-color",
          "stop-opacity",
          "gradientunits",
          "gradienttransform",
          "preserveaspectratio",
          "color");
  static final Set<String> STYLE =
      Set.of(
          "fill",
          "fill-rule",
          "fill-opacity",
          "stroke",
          "stroke-width",
          "stroke-opacity",
          "stroke-linecap",
          "stroke-linejoin",
          "opacity",
          "stop-color",
          "stop-opacity",
          "color");

  private ShortcutIconImage() {}

  static ShortcutIcon decode(byte[] bytes) {
    if (bytes.length == 0 || bytes.length > 256 * 1024) return null;
    try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
      var readers = ImageIO.getImageReaders(input);
      if (readers.hasNext()) {
        var reader = readers.next();
        try {
          reader.setInput(input);
          int index = 0;
          int frames = Math.max(1, Math.min(8, reader.getNumImages(true)));
          for (int i = 1; i < frames; i++)
            if (reader.getWidth(i) <= 2048
                && reader.getHeight(i) <= 2048
                && reader.getWidth(i) > reader.getWidth(index)) index = i;
          int width = reader.getWidth(index), height = reader.getHeight(index);
          if (width < 8 || height < 8 || width > 2048 || height > 2048) return null;
          var image = reader.read(index);
          if (image == null) return null;
          boolean visible = false, varied = false;
          int first = image.getRGB(0, 0);
          for (int y = 0; y < height && !(visible && varied); y++)
            for (int x = 0; x < width && !(visible && varied); x++) {
              int pixel = image.getRGB(x, y);
              visible |= (pixel >>> 24) != 0;
              varied |= pixel != first;
            }
          if (!visible || !varied) return null;
          var normalized = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
          var graphics = normalized.createGraphics();
          try {
            graphics.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            double scale = 64.0 / Math.max(width, height);
            int w = Math.max(1, (int) (width * scale)), h = Math.max(1, (int) (height * scale));
            graphics.drawImage(image, (64 - w) / 2, (64 - h) / 2, w, h, null);
          } finally {
            graphics.dispose();
          }
          var output = new ByteArrayOutputStream();
          ImageIO.write(normalized, "png", output);
          return new ShortcutIcon("image/png", output.toByteArray());
        } finally {
          reader.dispose();
        }
      }
    } catch (Exception ignored) {
      return null;
    }
    return svg(bytes);
  }

  static ShortcutIcon svg(byte[] bytes) {
    try {
      var factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      factory.setAttribute("http://www.oracle.com/xml/jaxp/properties/maxElementDepth", "64");
      var parser = factory.newDocumentBuilder();
      parser.setErrorHandler(new DefaultHandler());
      var document = parser.parse(new ByteArrayInputStream(bytes));
      var root = document.getDocumentElement();
      if (!"svg".equals(root.getLocalName()) || !SVG.equals(root.getNamespaceURI())) return null;
      if (!sanitize(root, 0, new int[1])) return null;
      var transformers = TransformerFactory.newInstance();
      transformers.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      transformers.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      transformers.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
      var transformer = transformers.newTransformer();
      transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes");
      var output = new ByteArrayOutputStream();
      transformer.transform(new DOMSource(root), new StreamResult(output));
      return output.size() <= 128 * 1024
          ? new ShortcutIcon("image/svg+xml", output.toByteArray())
          : null;
    } catch (Exception ignored) {
      return null;
    }
  }

  private static boolean sanitize(Element element, int depth, int[] count) {
    if (depth > 32 || ++count[0] > 2048) throw new IllegalArgumentException("SVG too complex");
    for (String declaration : element.getAttribute("style").split(";")) {
      var pair = declaration.split(":", 2);
      if (pair.length == 2
          && STYLE.contains(pair[0].strip().toLowerCase(Locale.ROOT))
          && safeValue(pair[1]))
        element.setAttribute(pair[0].strip().toLowerCase(Locale.ROOT), pair[1].strip());
    }
    var attributes = element.getAttributes();
    for (int i = attributes.getLength() - 1; i >= 0; i--) {
      var attribute = attributes.item(i);
      if (!ATTRIBUTES.contains(attribute.getNodeName().toLowerCase(Locale.ROOT))
          || !safeValue(attribute.getNodeValue()))
        element.removeAttributeNode((org.w3c.dom.Attr) attribute);
    }
    boolean drawing =
        Set.of("path", "circle", "rect", "ellipse", "polygon", "polyline", "line")
            .contains(element.getLocalName());
    for (var child = element.getFirstChild(); child != null; ) {
      var next = child.getNextSibling();
      if (child instanceof Element nested) {
        if (SVG.equals(nested.getNamespaceURI()) && ELEMENTS.contains(nested.getLocalName()))
          drawing |= sanitize(nested, depth + 1, count);
        else element.removeChild(child);
      } else if (child.getNodeType() != org.w3c.dom.Node.TEXT_NODE) element.removeChild(child);
      child = next;
    }
    return drawing;
  }

  private static boolean safeValue(String input) {
    String value = input.strip().toLowerCase(Locale.ROOT);
    return !value.contains("\\")
        && !value.contains("@")
        && !value.contains("expression")
        && (!value.matches("(?s).*url\\s*\\(.*")
            || value.matches("url\\(\\s*['\"]?#[a-z_][a-z0-9_.-]*['\"]?\\s*\\)"));
  }
}
