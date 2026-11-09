package kr.myworkspace.auth;

record SecurityState(
    String passwordHash,
    long version,
    String otpSecret,
    long lastUsedStep,
    String pendingSecret,
    String pendingToken,
    String pendingSession,
    long pendingExpires) {}
