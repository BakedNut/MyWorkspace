package kr.myworkspace.calendar.icloud;

record CloudState(
    String encryptedCredentials, CloudCalendar calendar, String lastSyncedAt, String error) {}
