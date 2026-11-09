package kr.myworkspace.calendar;

import java.util.List;

record CloudDraft(String encryptedCredentials, List<CloudCalendar> calendars, long expiresAt) {}
