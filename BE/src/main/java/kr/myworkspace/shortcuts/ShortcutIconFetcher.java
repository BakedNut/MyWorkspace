package kr.myworkspace.shortcuts;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.StringReader;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.swing.text.MutableAttributeSet;
import javax.swing.text.html.HTML;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.parser.ParserDelegator;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;

@Component
class ShortcutIconFetcher {
  final List<IpAddressMatcher> privateNetworks;
  final ScheduledThreadPoolExecutor deadlines =
      new ScheduledThreadPoolExecutor(
          1,
          task -> {
            var thread = new Thread(task, "shortcut-icon-deadline");
            thread.setDaemon(true);
            return thread;
          });
  static final List<IpAddressMatcher> RESERVED =
      List.of(
              "0.0.0.0/8",
              "10.0.0.0/8",
              "100.64.0.0/10",
              "127.0.0.0/8",
              "169.254.0.0/16",
              "172.16.0.0/12",
              "192.168.0.0/16",
              "192.0.0.0/24",
              "198.18.0.0/15",
              "224.0.0.0/4",
              "240.0.0.0/4",
              "fc00::/7",
              "fec0::/10")
          .stream()
          .map(IpAddressMatcher::new)
          .toList();

  record Download(URI uri, byte[] bytes) {}

  ShortcutIconFetcher(@Value("${app.shortcut-icon-networks}") String networks) {
    deadlines.setRemoveOnCancelPolicy(true);
    privateNetworks =
        Arrays.stream(networks.split(","))
            .map(String::strip)
            .filter(value -> !value.isEmpty())
            .map(IpAddressMatcher::new)
            .toList();
  }

  static URI origin(String value) {
    return ShortcutUrl.origin(value);
  }

  boolean addressAllowed(InetAddress address, boolean originalHost) {
    if (address.isAnyLocalAddress()
        || address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isMulticastAddress()) return false;
    String numeric = address.getHostAddress();
    if (RESERVED.stream().anyMatch(network -> network.matches(numeric)))
      return originalHost && privateNetworks.stream().anyMatch(network -> network.matches(numeric));
    return true;
  }

  static boolean targetAllowed(URI original, URI uri) {
    if (uri.getHost() == null
        || uri.getRawUserInfo() != null
        || !Set.of("http", "https").contains(uri.getScheme().toLowerCase(Locale.ROOT))
        || uri.getPort() > 65535) return false;
    if (!ShortcutUrl.host(original.getHost()).equals(ShortcutUrl.host(uri.getHost()))) return true;
    int from =
        original.getPort() == -1
            ? (original.getScheme().equals("https") ? 443 : 80)
            : original.getPort();
    int to =
        uri.getPort() == -1
            ? (uri.getScheme().equalsIgnoreCase("https") ? 443 : 80)
            : uri.getPort();
    return from == to || (from == 80 && to == 443 && uri.getScheme().equalsIgnoreCase("https"));
  }

  ShortcutIcon fetch(URI original) {
    Map<String, InetAddress[]> pinned = new HashMap<>();
    DnsResolver resolver =
        new DnsResolver() {
          public InetAddress[] resolve(String host) throws UnknownHostException {
            String name = host.toLowerCase(Locale.ROOT);
            if (!pinned.containsKey(name)) {
              var addresses = InetAddress.getAllByName(host);
              for (var address : addresses)
                if (!addressAllowed(address, original.getHost().equalsIgnoreCase(host)))
                  throw new UnknownHostException("Icon destination rejected");
              pinned.put(name, addresses);
            }
            return pinned.get(name).clone();
          }

          public String resolveCanonicalHostname(String host) {
            return host;
          }
        };
    var manager =
        PoolingHttpClientConnectionManagerBuilder.create()
            .useSystemProperties()
            .setDnsResolver(resolver)
            .setDefaultConnectionConfig(
                ConnectionConfig.custom()
                    .setConnectTimeout(Timeout.ofSeconds(2))
                    .setSocketTimeout(Timeout.ofSeconds(2))
                    .build())
            .build();
    try (var client =
        HttpClients.custom()
            .setConnectionManager(manager)
            .disableRedirectHandling()
            .disableAutomaticRetries()
            .disableCookieManagement()
            .disableContentCompression()
            .build()) {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
      Set<URI> candidates = new LinkedHashSet<>();
      var page = read(client, resolver, original, original, true, deadline);
      if (page != null) candidates.addAll(candidates(page.uri(), page.bytes()));
      candidates.add(original.resolve("/favicon.ico"));
      for (URI uri : candidates) {
        if (System.nanoTime() >= deadline) break;
        if (defaultIcon(uri)) continue;
        var result = read(client, resolver, original, uri, false, deadline);
        if (result == null || defaultIcon(result.uri())) continue;
        var icon = ShortcutIconImage.decode(result.bytes());
        if (icon != null) return icon;
      }
    } catch (Exception ignored) {
      // An unavailable icon must not affect bookmark loading or saving.
    }
    return null;
  }

  Download read(
      CloseableHttpClient client,
      DnsResolver resolver,
      URI original,
      URI requested,
      boolean html,
      long deadline) {
    try {
      URI uri = requested;
      for (int redirects = 0; redirects <= 3; redirects++) {
        uri = ShortcutUrl.canonical(uri);
        long remaining = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
        if (remaining <= 0 || !targetAllowed(original, uri)) return null;
        resolver.resolve(uri.getHost());
        var request = new HttpGet(uri);
        request.setConfig(
            RequestConfig.custom()
                .setResponseTimeout(Timeout.ofMilliseconds(Math.min(2500, remaining)))
                .setConnectionRequestTimeout(Timeout.ofSeconds(1))
                .build());
        request.setHeader("User-Agent", "MyWorkspace favicon fetcher");
        request.setHeader("Accept", html ? "text/html" : "image/*");
        request.setHeader("Accept-Encoding", "identity");
        var timeout =
            deadlines.schedule(
                request::cancel, Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
        org.apache.hc.core5.http.ClassicHttpResponse response = null;
        try {
          response = client.executeOpen(null, request, null);
          if (Set.of(301, 302, 303, 307, 308).contains(response.getCode())) {
            var location = response.getFirstHeader("Location");
            if (location == null) return null;
            uri = uri.resolve(location.getValue());
            request.cancel();
            continue;
          }
          if (response.getCode() != 200 || response.getEntity() == null) {
            request.cancel();
            return null;
          }
          int limit = html ? 128 * 1024 : 256 * 1024;
          var output = new ByteArrayOutputStream();
          byte[] buffer = new byte[4096];
          var stream = response.getEntity().getContent();
          while (output.size() <= limit) {
            if (System.nanoTime() >= deadline) throw new IOException("Icon request timed out");
            int read = stream.read(buffer, 0, Math.min(buffer.length, limit + 1 - output.size()));
            if (read == -1) break;
            output.write(buffer, 0, read);
          }
          byte[] bytes = output.toByteArray();
          request.cancel();
          if (!html && bytes.length > limit) return null;
          return new Download(uri, bytes.length > limit ? Arrays.copyOf(bytes, limit) : bytes);
        } finally {
          request.cancel();
          timeout.cancel(false);
          if (response != null) response.close();
        }
      }
    } catch (Exception ignored) {
      return null;
    }
    return null;
  }

  static Set<URI> candidates(URI page, byte[] html) throws Exception {
    Set<URI> links = new LinkedHashSet<>();
    URI[] base = {page};
    new ParserDelegator()
        .parse(
            new StringReader(new String(html, StandardCharsets.UTF_8)),
            new HTMLEditorKit.ParserCallback() {
              public void handleSimpleTag(HTML.Tag tag, MutableAttributeSet attrs, int position) {
                Object href = attrs.getAttribute(HTML.Attribute.HREF);
                if (href == null) return;
                try {
                  if (tag == HTML.Tag.BASE) base[0] = page.resolve(href.toString());
                  String rel =
                      String.valueOf(attrs.getAttribute(HTML.Attribute.REL))
                          .toLowerCase(Locale.ROOT);
                  if (tag == HTML.Tag.LINK
                      && links.size() < 5
                      && (Arrays.asList(rel.split("\\s+")).contains("icon")
                          || rel.startsWith("apple-touch-icon")))
                    links.add(base[0].resolve(href.toString()));
                } catch (IllegalArgumentException ignored) {
                }
              }
            },
            true);
    return links;
  }

  @jakarta.annotation.PreDestroy
  void close() {
    deadlines.shutdownNow();
  }

  static boolean defaultIcon(URI uri) {
    String path = uri.getPath();
    String filename =
        path == null ? "" : path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
    return Set.of("vite.svg", "react.svg", "next.svg", "vercel.svg").contains(filename);
  }
}
