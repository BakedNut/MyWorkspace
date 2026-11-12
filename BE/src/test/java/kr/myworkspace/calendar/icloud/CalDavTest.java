package kr.myworkspace.calendar.icloud;

import static org.assertj.core.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpHeaders;
import java.nio.ByteBuffer;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Flow;
import kr.myworkspace.calendar.event.EventInput;
import kr.myworkspace.common.error.ApiException;
import org.junit.jupiter.api.Test;

class CalDavTest {
  @Test
  void retriedCreationMatchesOnlyTheSameContent() {
    var date = LocalDate.of(2026, 11, 6);
    var input = new EventInput("cal-remote", "재요청", date, false, "09:00", "10:00", null, null);
    var resource =
        new CloudResource(
            "https://p01-caldav.icloud.com/a/1.ics", "v1", ICalendarMapper.write(input, null));
    assertThat(ICloudService.matches(input, resource)).isTrue();
    assertThat(
            ICloudService.matches(
                new EventInput("cal-remote", "다른 내용", date, false, "09:00", "10:00", null, null),
                resource))
        .isFalse();
  }

  @Test
  void addressesAndXmlAreRestricted() {
    for (String url :
        List.of(
            "http://caldav.icloud.com/",
            "https://caldav.icloud.com.attacker.test/",
            "https://user@caldav.icloud.com/",
            "https://caldav.icloud.com:444/",
            "https://127.0.0.1/",
            "https://caldav.icloud.com/?target=x"))
      assertThatThrownBy(() -> CalDavClient.trusted(URI.create(url)))
          .isInstanceOf(ApiException.class);
    assertThat(CalDavClient.trusted(URI.create("https://p01-caldav.icloud.com/123/cal/")))
        .isNotNull();
    assertThatThrownBy(
            () ->
                CalDavClient.xml(
                    "<!DOCTYPE x [<!ENTITY ext SYSTEM 'file:///etc/passwd'>]><x>&ext;</x>"))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                CalDavClient.resourceUri(
                    "https://p01-caldav.icloud.com/a/",
                    "https://p01-caldav.icloud.com/b/event.ics"))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void parsesWritableCalendarsAndIgnoresFailedProperties() {
    String xml =
        """
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:displayname>집 &amp; 학교</d:displayname><d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/123/calendars/todo/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>\
""";
    var result =
        CalDavClient.calendars(
            new DavReply(
                207,
                URI.create("https://p01-caldav.icloud.com/123/calendars/"),
                HttpHeaders.of(Map.of(), (a, b) -> true),
                xml));
    assertThat(result).hasSize(1);
    assertThat(result.getFirst().name()).isEqualTo("집 & 학교");
    assertThat(result.getFirst().readOnly()).isFalse();
  }

  @Test
  void limitsResponseSize() {
    var body = new CalDavClient.LimitedBody();
    boolean[] cancelled = {false};
    body.onSubscribe(
        new Flow.Subscription() {
          public void request(long n) {}

          public void cancel() {
            cancelled[0] = true;
          }
        });
    body.onNext(List.of(ByteBuffer.allocate(4_000_001)));
    assertThat(cancelled[0]).isTrue();
    assertThat(body.getBody().toCompletableFuture()).isCompletedExceptionally();
  }

  @Test
  void calendarRoundTripPreservesEscapingTimesAndAlarms() {
    LocalDate date = LocalDate.of(2026, 11, 6);
    var input =
        new EventInput(
            "cal-remote", "회의, 점검; 다음\n줄", date, false, "09:05", "10:25", "강의실", "메모\n둘째 줄");
    String text = ICalendarMapper.write(input, null);
    var parsed =
        ICalendarMapper.expand(
                new CloudResource("https://p01-caldav.icloud.com/a/1.ics", "\"v1\"", text),
                date,
                date,
                false)
            .getFirst();
    assertThat(parsed.get("title")).isEqualTo(input.title());
    assertThat(parsed.get("start")).isEqualTo("09:05");
    assertThat(parsed.get("memo")).isEqualTo(input.memo());
    String alarm =
        "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:알림\r\nEND:VALARM\r\n";
    String original = text.replace("END:VEVENT", alarm + "END:VEVENT");
    String changed =
        ICalendarMapper.write(
            new EventInput("cal-remote", "바뀐 제목", date, true, null, null, null, null), original);
    assertThat(changed).contains("BEGIN:VALARM");
    var updated =
        ICalendarMapper.expand(
                new CloudResource("https://p01-caldav.icloud.com/a/1.ics", "\"v2\"", changed),
                date,
                date,
                false)
            .getFirst();
    assertThat(updated.get("allDay")).isEqualTo(true);
    assertThat(updated.get("date")).isEqualTo(date.toString());
  }

  @Test
  void recurringAndInvitedEventsAreReadOnly() {
    var date = LocalDate.of(2026, 11, 6);
    String text =
        ICalendarMapper.write(
            new EventInput("cal-remote", "반복", date, false, "09:00", "10:00", null, null), null);
    for (String property :
        List.of(
            "RECURRENCE-ID:20261106T000000Z",
            "RRULE:FREQ=DAILY",
            "ATTENDEE:mailto:test@example.com")) {
      String modified = text.replace("END:VEVENT", property + "\r\nEND:VEVENT");
      var event =
          ICalendarMapper.expand(
                  new CloudResource("https://p01-caldav.icloud.com/a/1.ics", "v1", modified),
                  date,
                  date,
                  false)
              .getFirst();
      assertThat(event.get("readOnly")).isEqualTo(true);
      assertThatThrownBy(
              () ->
                  ICalendarMapper.write(
                      new EventInput("cal-remote", "수정", date, true, null, null, null, null),
                      modified))
          .isInstanceOf(ApiException.class);
    }
  }

  @Test
  void readsNamedTimeZonesAndKeepsMultiDayEventsReadOnly() {
    String text =
        "BEGIN:VCALENDAR\r\n"
            + "VERSION:2.0\r\n"
            + "PRODID:-//test//KO\r\n"
            + "BEGIN:VEVENT\r\n"
            + "UID:timezone-test\r\n"
            + "DTSTAMP:20261101T000000Z\r\n"
            + "DTSTART;TZID=America/New_York:20261106T090000\r\n"
            + "DTEND;TZID=America/New_York:20261106T094500\r\n"
            + "SUMMARY:다른 시간대\r\n"
            + "END:VEVENT\r\n"
            + "END:VCALENDAR\r\n";
    var date = LocalDate.of(2026, 11, 6);
    var event =
        ICalendarMapper.expand(
                new CloudResource("https://p01-caldav.icloud.com/a/1.ics", "v1", text),
                date,
                date,
                false)
            .getFirst();
    assertThat(event.get("start")).isEqualTo("23:00");
    String multi = text.replace("20261106T094500", "20261106T100000");
    assertThat(
            ICalendarMapper.expand(
                    new CloudResource("https://p01-caldav.icloud.com/a/1.ics", "v1", multi),
                    date,
                    date,
                    false)
                .getFirst()
                .get("readOnly"))
        .isEqualTo(true);
  }
}
