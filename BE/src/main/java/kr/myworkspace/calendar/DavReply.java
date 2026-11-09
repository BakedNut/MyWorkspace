package kr.myworkspace.calendar;

import java.net.URI;
import java.net.http.HttpHeaders;

record DavReply(int status, URI uri, HttpHeaders headers, String body) {}
