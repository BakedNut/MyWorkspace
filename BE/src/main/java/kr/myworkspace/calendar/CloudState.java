package kr.myworkspace.calendar;

record CloudState(
    String encryptedCredentials, CloudCalendar calendar, String lastSyncedAt, String error) {}
