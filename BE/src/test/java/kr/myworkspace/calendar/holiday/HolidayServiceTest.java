package kr.myworkspace.calendar.holiday;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.util.Optional;
import kr.myworkspace.common.document.DocumentStore;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class HolidayServiceTest {
  @Test
  void missingYearsAreQueuedAndQueryDoesNotCallRemoteService() {
    var docs = mock(DocumentStore.class);
    when(docs.findRaw(anyString())).thenReturn(Optional.empty());
    var service = spy(new HolidayService(docs, JsonMapper.builder().build()));
    assertThat(service.between(LocalDate.of(2026, 12, 31), LocalDate.of(2027, 1, 2))).isEmpty();
    verify(service, never()).fetchYear(anyInt());
    assertThat(service.requestedYears).contains(2026, 2027);
  }
}
