package kr.myworkspace.shortcuts;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.http.message.BasicClassicHttpResponse;
import org.junit.jupiter.api.Test;

class ShortcutIconFetcherTest {
  @Test
  void permitsPrivateSitesOnlyWithinConfiguredNetworksAndForTheOriginalHost() throws Exception {
    var fetcher = new ShortcutIconFetcher("192.168.1.0/24,100.64.0.0/10");
    try {
      for (String address :
          new String[] {
            "127.0.0.1",
            "::1",
            "169.254.169.254",
            "0.0.0.0",
            "10.0.0.1",
            "172.17.0.1",
            "192.168.2.1",
            "fd00:ec2::254"
          })
        assertThat(fetcher.addressAllowed(InetAddress.getByName(address), true))
            .as(address)
            .isFalse();
      assertThat(fetcher.addressAllowed(InetAddress.getByName("192.168.1.200"), true)).isTrue();
      assertThat(fetcher.addressAllowed(InetAddress.getByName("192.168.1.200"), false)).isFalse();
      assertThat(fetcher.addressAllowed(InetAddress.getByName("8.8.8.8"), false)).isTrue();
      assertThat(
              ShortcutIconFetcher.origin("https://Example.com:443/private?token=secret#top")
                  .toString())
          .isEqualTo("https://example.com/");
      assertThat(
              ShortcutIconFetcher.targetAllowed(
                  URI.create("http://192.168.1.200:8088/"),
                  URI.create("http://192.168.1.200:8081/favicon.ico")))
          .isFalse();
    } finally {
      fetcher.close();
    }
  }

  @Test
  void discoversExplicitIconsAndRecognizesStockTemplateIcons() throws Exception {
    String html =
        "<html><head><base href='https://cdn.example.com/assets/'><link rel='shortcut icon'"
            + " href='logo.svg'><link rel='apple-touch-icon' href='/apple.png'></head></html>";
    assertThat(
            ShortcutIconFetcher.candidates(
                URI.create("https://example.com/"), html.getBytes(StandardCharsets.UTF_8)))
        .containsExactly(
            URI.create("https://cdn.example.com/assets/logo.svg"),
            URI.create("https://cdn.example.com/apple.png"));
    assertThat(ShortcutIconFetcher.defaultIcon(URI.create("https://example.com/vite.svg?v=1")))
        .isTrue();
    assertThat(ShortcutIconFetcher.defaultIcon(URI.create("https://example.com/brand.svg")))
        .isFalse();
  }

  @Test
  void validatesLiteralAddressesBeforeHttpClientCanBypassTheResolver() throws Exception {
    var fetcher = new ShortcutIconFetcher("192.168.1.0/24");
    try (var client = mock(CloseableHttpClient.class)) {
      var resolver = mock(DnsResolver.class);
      when(resolver.resolve("127.0.0.1")).thenThrow(new UnknownHostException("rejected"));
      assertThat(
              fetcher.read(
                  client,
                  resolver,
                  URI.create("https://example.com/"),
                  URI.create("http://127.0.0.1/"),
                  false,
                  System.nanoTime() + TimeUnit.SECONDS.toNanos(2)))
          .isNull();
      verifyNoInteractions(client);
    } finally {
      fetcher.close();
    }
  }

  @Test
  void boundsResponseSizeAndRejectsRedirectsToPrivateDestinations() throws Exception {
    var fetcher = new ShortcutIconFetcher("192.168.1.0/24");
    try (var client = mock(CloseableHttpClient.class)) {
      var resolver = mock(DnsResolver.class);
      when(resolver.resolve("example.com"))
          .thenReturn(new InetAddress[] {InetAddress.getByName("8.8.8.8")});
      when(resolver.resolve("127.0.0.1")).thenThrow(new UnknownHostException("rejected"));
      var redirect = new BasicClassicHttpResponse(302);
      redirect.setHeader("Location", "http://127.0.0.1/metadata");
      var large = new BasicClassicHttpResponse(200);
      large.setEntity(new ByteArrayEntity(new byte[256 * 1024 + 1], ContentType.IMAGE_PNG));
      when(client.executeOpen(isNull(), any(HttpGet.class), isNull())).thenReturn(redirect, large);
      URI origin = URI.create("https://example.com/");
      assertThat(
              fetcher.read(
                  client,
                  resolver,
                  origin,
                  origin,
                  false,
                  System.nanoTime() + TimeUnit.SECONDS.toNanos(2)))
          .isNull();
      assertThat(
              fetcher.read(
                  client,
                  resolver,
                  origin,
                  origin,
                  false,
                  System.nanoTime() + TimeUnit.SECONDS.toNanos(2)))
          .isNull();
      verify(client, times(2)).executeOpen(isNull(), any(HttpGet.class), isNull());
    } finally {
      fetcher.close();
    }
  }
}
