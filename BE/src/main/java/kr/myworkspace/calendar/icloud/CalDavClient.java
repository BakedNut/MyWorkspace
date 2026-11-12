package kr.myworkspace.calendar.icloud;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

@Service
class CalDavClient {
  static final String DAV = "DAV:", CAL = "urn:ietf:params:xml:ns:caldav";
  final HttpClient client =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();

  static URI trusted(URI uri) {
    ApiException.require(
        "https".equalsIgnoreCase(uri.getScheme())
            && uri.getHost() != null
            && uri.getHost().toLowerCase(Locale.ROOT).matches("(?:p[0-9]+-)?caldav\\.icloud\\.com")
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getUserInfo() == null
            && uri.getFragment() == null
            && uri.getQuery() == null,
        "올바른 iCloud 캘린더 주소가 아닙니다.");
    return uri.normalize();
  }

  static String id(String text) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))
          .substring(0, 40);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  DavReply send(
      CloudAccount account, URI uri, String method, String body, Map<String, String> headers) {
    uri = trusted(uri);
    try {
      for (int redirect = 0; redirect < 4; redirect++) {
        var request =
            HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(10))
                .header(
                    "Authorization",
                    "Basic "
                        + Base64.getEncoder()
                            .encodeToString(
                                (account.appleId() + ":" + account.password())
                                    .getBytes(StandardCharsets.UTF_8)))
                .header("User-Agent", "MyWorkspace/1.0");
        headers.forEach(request::header);
        request.method(
            method,
            body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        var response = client.send(request.build(), info -> new LimitedBody());
        if (Set.of(301, 302, 307, 308).contains(response.statusCode())) {
          uri = trusted(uri.resolve(response.headers().firstValue("Location").orElseThrow()));
          continue;
        }
        if (response.statusCode() == 401)
          throw new ApiException(
              400, "VALIDATION", "Apple ID 또는 앱 전용 암호를 확인하세요. 일반 계정 비밀번호는 사용할 수 없습니다.");
        if (response.statusCode() == 403)
          throw new ApiException(403, "READ_ONLY", "이 iCloud 캘린더에 대한 권한이 없습니다.");
        if (response.statusCode() == 412)
          throw new ApiException(409, "CONFLICT", "다른 기기에서 일정이 변경됐습니다. 새로고침 후 다시 수정하세요.");
        return new DavReply(
            response.statusCode(),
            uri,
            response.headers(),
            new String(response.body(), StandardCharsets.UTF_8));
      }
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
    }
    throw new ApiException(503, "NETWORK", "iCloud에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  static class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
    Flow.Subscription subscription;
    long size;
    boolean done;

    public CompletionStage<byte[]> getBody() {
      return delegate.getBody();
    }

    public void onSubscribe(Flow.Subscription subscription) {
      this.subscription = subscription;
      delegate.onSubscribe(subscription);
    }

    public void onNext(List<ByteBuffer> buffers) {
      if (done) return;
      for (var buffer : buffers) size += buffer.remaining();
      if (size > 4_000_000) {
        done = true;
        subscription.cancel();
        delegate.onError(new IOException("Calendar response too large"));
      } else delegate.onNext(buffers);
    }

    public void onError(Throwable error) {
      if (!done) {
        done = true;
        delegate.onError(error);
      }
    }

    public void onComplete() {
      if (!done) {
        done = true;
        delegate.onComplete();
      }
    }
  }

  static Document xml(String body) {
    try {
      var factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      var builder = factory.newDocumentBuilder();
      builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler());
      return builder.parse(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new ApiException(503, "NETWORK", "iCloud 응답을 읽지 못했습니다.");
    }
  }

  static List<Element> elements(Element parent, String ns, String name) {
    var nodes = parent.getElementsByTagNameNS(ns, name);
    List<Element> result = new ArrayList<>();
    for (int i = 0; i < nodes.getLength(); i++) result.add((Element) nodes.item(i));
    return result;
  }

  static String text(Element parent, String ns, String name) {
    var nodes = elements(parent, ns, name);
    return nodes.isEmpty() ? "" : nodes.getFirst().getTextContent();
  }

  static Element successfulProp(Element response) {
    return elements(response, DAV, "propstat").stream()
        .filter(e -> text(e, DAV, "status").contains(" 200 "))
        .flatMap(e -> elements(e, DAV, "prop").stream())
        .findFirst()
        .orElse(null);
  }

  DavReply propfind(CloudAccount account, URI uri, int depth, String properties) {
    var reply =
        send(
            account,
            uri,
            "PROPFIND",
            "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\" xmlns:c=\""
                + CAL
                + "\"><d:prop>"
                + properties
                + "</d:prop></d:propfind>",
            Map.of(
                "Depth", String.valueOf(depth), "Content-Type", "application/xml; charset=utf-8"));
    if (reply.status() != 207) throw new ApiException(503, "NETWORK", "iCloud 캘린더 정보를 가져오지 못했습니다.");
    return reply;
  }

  List<CloudCalendar> discover(CloudAccount account) {
    var principal =
        propfind(
            account, URI.create("https://caldav.icloud.com/"), 0, "<d:current-user-principal/>");
    var node = xml(principal.body()).getDocumentElement();
    var user = elements(node, DAV, "current-user-principal");
    if (user.isEmpty()) throw new ApiException(503, "NETWORK", "iCloud 계정 정보를 찾지 못했습니다.");
    URI principalUri = trusted(principal.uri().resolve(text(user.getFirst(), DAV, "href")));
    var home = propfind(account, principalUri, 0, "<c:calendar-home-set/>");
    var homes = elements(xml(home.body()).getDocumentElement(), CAL, "calendar-home-set");
    if (homes.isEmpty()) throw new ApiException(503, "NETWORK", "iCloud 캘린더 저장소를 찾지 못했습니다.");
    URI homeUri = trusted(home.uri().resolve(text(homes.getFirst(), DAV, "href")));
    var calendars =
        propfind(
            account,
            homeUri,
            1,
            "<d:resourcetype/><d:displayname/><d:current-user-privilege-set/><c:supported-calendar-component-set/>");
    return calendars(calendars);
  }

  static List<CloudCalendar> calendars(DavReply reply) {
    List<CloudCalendar> result = new ArrayList<>();
    for (var response : elements(xml(reply.body()).getDocumentElement(), DAV, "response")) {
      var prop = successfulProp(response);
      if (prop == null || elements(prop, CAL, "calendar").isEmpty()) continue;
      var components = elements(prop, CAL, "comp");
      if (!components.isEmpty()
          && components.stream().noneMatch(e -> "VEVENT".equals(e.getAttribute("name")))) continue;
      URI href = trusted(reply.uri().resolve(text(response, DAV, "href")));
      if (!href.getPath().endsWith("/")) href = URI.create(href.toASCIIString() + "/");
      boolean readOnly =
          elements(prop, DAV, "write").isEmpty() && elements(prop, DAV, "write-content").isEmpty();
      String name = text(prop, DAV, "displayname").strip();
      result.add(
          new CloudCalendar(
              id(href.toString()), name.isBlank() ? "iCloud" : name, href.toString(), readOnly));
      if (result.size() > 100) throw new ApiException(400, "VALIDATION", "캘린더가 너무 많아 연결하지 못했습니다.");
    }
    return result;
  }

  List<CloudResource> query(
      CloudAccount account, String calendarHref, LocalDate from, LocalDate to) {
    var format = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    String start = format.format(from.atStartOfDay(ZoneId.of("Asia/Seoul"))),
        end = format.format(to.plusDays(1).atStartOfDay(ZoneId.of("Asia/Seoul")));
    String body =
        "<c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\""
            + CAL
            + "\"><d:prop><d:getetag/><c:calendar-data><c:expand start=\""
            + start
            + "\" end=\""
            + end
            + "\"/></c:calendar-data></d:prop><c:filter><c:comp-filter"
            + " name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\"><c:time-range start=\""
            + start
            + "\" end=\""
            + end
            + "\"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
    var reply =
        send(
            account,
            URI.create(calendarHref),
            "REPORT",
            body,
            Map.of("Depth", "1", "Content-Type", "application/xml; charset=utf-8"));
    if (reply.status() != 207) throw new ApiException(503, "NETWORK", "iCloud 일정을 가져오지 못했습니다.");
    List<CloudResource> result = new ArrayList<>();
    for (var response : elements(xml(reply.body()).getDocumentElement(), DAV, "response")) {
      var prop = successfulProp(response);
      if (prop == null) continue;
      String content = text(prop, CAL, "calendar-data");
      if (content.isBlank()) continue;
      URI href =
          resourceUri(calendarHref, reply.uri().resolve(text(response, DAV, "href")).toString());
      result.add(new CloudResource(href.toString(), text(prop, DAV, "getetag"), content));
    }
    return result;
  }

  static URI resourceUri(String calendar, String resource) {
    URI c = trusted(URI.create(calendar)), r = trusted(URI.create(resource));
    ApiException.require(
        c.getHost().equalsIgnoreCase(r.getHost())
            && r.getRawPath().startsWith(c.getRawPath())
            && !r.getRawPath().equals(c.getRawPath()),
        "캘린더 일정 주소를 확인할 수 없습니다.");
    return r;
  }
}
