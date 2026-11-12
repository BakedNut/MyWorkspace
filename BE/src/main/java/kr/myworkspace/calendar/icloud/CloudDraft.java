package kr.myworkspace.calendar.icloud;

import java.util.List;

record CloudDraft(String encryptedCredentials, List<CloudCalendar> calendars, long expiresAt) {}
