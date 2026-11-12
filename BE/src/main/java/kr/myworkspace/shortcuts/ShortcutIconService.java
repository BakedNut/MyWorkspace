package kr.myworkspace.shortcuts;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class ShortcutIconService {
  final DocumentStore docs;
  final JdbcTemplate jdbc;
  final TransactionTemplate transactions;
  final ShortcutIconFetcher fetcher;
  final ConcurrentHashMap<String, CompletableFuture<ShortcutIcon>> pending =
      new ConcurrentHashMap<>();
  final ThreadPoolExecutor workers =
      new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));

  record Cached(ShortcutIcon icon, long checkedAt) {}

  ShortcutIconService(
      DocumentStore docs,
      JdbcTemplate jdbc,
      TransactionTemplate transactions,
      ShortcutIconFetcher fetcher) {
    this.docs = docs;
    this.jdbc = jdbc;
    this.transactions = transactions;
    this.fetcher = fetcher;
  }

  CompletableFuture<ShortcutIcon> get(String id, String site) {
    var link =
        docs.read("shortcuts", ShortcutBoard.class).groups().stream()
            .flatMap(group -> group.links().stream())
            .filter(item -> item.id().equals(id))
            .findFirst()
            .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "바로가기를 찾을 수 없습니다."));
    var origin = ShortcutIconFetcher.origin(link.url());
    if (site != null && !site.equals(origin.toString().replaceAll("/$", "")))
      return CompletableFuture.completedFuture(null);
    String key;
    try {
      key =
          HexFormat.of()
              .formatHex(
                  MessageDigest.getInstance("SHA-256")
                      .digest(origin.toString().getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
    List<Cached> rows =
        jdbc.query(
            "select media_type,image_bytes,checked_at from shortcut_icon where site_key=?",
            (row, index) -> {
              byte[] bytes = row.getBytes("image_bytes");
              return new Cached(
                  bytes == null ? null : new ShortcutIcon(row.getString("media_type"), bytes),
                  row.getLong("checked_at"));
            },
            key);
    var cached = rows.isEmpty() ? null : rows.getFirst();
    long ttl =
        cached != null && cached.icon() != null
            ? TimeUnit.DAYS.toMillis(7)
            : TimeUnit.HOURS.toMillis(6);
    if (cached != null && System.currentTimeMillis() - cached.checkedAt() < ttl)
      return CompletableFuture.completedFuture(cached.icon());
    var task = new CompletableFuture<ShortcutIcon>();
    var existing = pending.putIfAbsent(key, task);
    if (existing != null)
      return cached != null && cached.icon() != null
          ? CompletableFuture.completedFuture(cached.icon())
          : existing;
    try {
      workers.execute(
          () -> {
            ShortcutIcon icon = null;
            try {
              icon = fetcher.fetch(origin);
              ShortcutIcon result = icon;
              transactions.executeWithoutResult(tx -> store(key, result));
            } catch (RuntimeException error) {
              org.slf4j.LoggerFactory.getLogger(getClass())
                  .warn("바로가기 아이콘 처리 실패: {}", error.getClass().getSimpleName());
            } finally {
              pending.remove(key, task);
              task.complete(icon);
            }
          });
    } catch (RejectedExecutionException full) {
      pending.remove(key, task);
      task.complete(null);
    }
    task.completeOnTimeout(null, 12, TimeUnit.SECONDS);
    return cached != null && cached.icon() != null
        ? CompletableFuture.completedFuture(cached.icon())
        : task;
  }

  void store(String key, ShortcutIcon icon) {
    String media = icon == null ? null : icon.mediaType();
    byte[] bytes = icon == null ? null : icon.data();
    long now = System.currentTimeMillis();
    jdbc.update(
        "insert into shortcut_icon(site_key,media_type,image_bytes,checked_at) values(?,?,?,?) on"
            + " duplicate key update media_type=?,image_bytes=?,checked_at=?",
        key,
        media,
        bytes,
        now,
        media,
        bytes,
        now);
    var keys =
        jdbc.queryForList(
            "select site_key from shortcut_icon order by checked_at desc,site_key", String.class);
    for (String old : keys.subList(Math.min(256, keys.size()), keys.size()))
      jdbc.update("delete from shortcut_icon where site_key=?", old);
  }

  @jakarta.annotation.PreDestroy
  void close() {
    workers.shutdownNow();
    pending.values().forEach(task -> task.complete(null));
    pending.clear();
  }
}
