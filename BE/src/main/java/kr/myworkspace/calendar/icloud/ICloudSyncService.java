package kr.myworkspace.calendar.icloud;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import kr.myworkspace.common.error.ApiException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class ICloudSyncService {
  final ICloudCoordinator coordinator;
  final CalDavClient dav;
  final ICloudCacheRepository cache;
  final TransactionTemplate transactions;
  final ExecutorService worker = Executors.newSingleThreadExecutor();
  final Set<String> pending = new HashSet<>();
  final Map<String, CompletableFuture<Boolean>> inFlight = new HashMap<>();
  CompletableFuture<Long> activeSync;

  ICloudSyncService(
      ICloudCoordinator coordinator,
      CalDavClient dav,
      ICloudCacheRepository cache,
      TransactionTemplate transactions) {
    this.coordinator = coordinator;
    this.dav = dav;
    this.cache = cache;
    this.transactions = transactions;
  }

  List<Map<String, Object>> list(LocalDate from, LocalDate to) {
    synchronized (coordinator.lock) {
      if (coordinator.read().calendar() == null) return List.of();
      if (coordinator.cacheDirty) {
        cache.markStale();
        coordinator.cacheDirty = false;
      }
      var selected = cache.lookup(from, to);
      if (selected.stale()) queue(from, to);
      return selected.events();
    }
  }

  void queue(LocalDate from, LocalDate to) {
    String key = from + ":" + to;
    if (pending.size() >= 12 || !pending.add(key)) return;
    worker.execute(
        () -> {
          try {
            refresh(from, to);
          } finally {
            synchronized (coordinator.lock) {
              pending.remove(key);
            }
          }
        });
  }

  boolean refresh(LocalDate from, LocalDate to) {
    String key = from + ":" + to;
    CompletableFuture<Boolean> future;
    ICloudCoordinator.Snapshot before;
    boolean owner;
    synchronized (coordinator.lock) {
      future = inFlight.get(key);
      owner = future == null;
      if (owner) {
        future = new CompletableFuture<>();
        inFlight.put(key, future);
      }
      before = coordinator.snapshot();
    }
    if (!owner) return future.join();
    boolean applied;
    try {
      applied = fetch(before, from, to);
    } catch (RuntimeException error) {
      synchronized (coordinator.lock) {
        inFlight.remove(key);
      }
      future.completeExceptionally(error);
      throw error;
    }
    synchronized (coordinator.lock) {
      inFlight.remove(key);
    }
    future.complete(applied);
    return applied;
  }

  boolean fetch(ICloudCoordinator.Snapshot before, LocalDate from, LocalDate to) {
    var state = before.state();
    if (state.calendar() == null) return false;
    try {
      var resources = dav.query(coordinator.account(state), state.calendar().href(), from, to);
      var events =
          ICalendarMapper.expandResources(resources, from, to, state.calendar().readOnly());
      synchronized (coordinator.lock) {
        if (!coordinator.unchanged(before)) return false;
        transactions.executeWithoutResult(
            tx -> {
              cache.cache(from, to, events, resources, state);
              coordinator.store(
                  new CloudState(
                      state.encryptedCredentials(),
                      state.calendar(),
                      Instant.now().toString(),
                      null));
            });
      }
      return true;
    } catch (RuntimeException error) {
      synchronized (coordinator.lock) {
        if (coordinator.unchanged(before))
          coordinator.store(
              new CloudState(
                  state.encryptedCredentials(),
                  state.calendar(),
                  state.lastSyncedAt(),
                  "iCloud 갱신이 지연되어 저장된 일정을 표시합니다."));
      }
      return false;
    }
  }

  CompletableFuture<Long> startSync() {
    synchronized (coordinator.lock) {
      if (activeSync != null) return activeSync;
      var before = coordinator.snapshot();
      var result = new CompletableFuture<Long>();
      activeSync = result;
      worker.execute(
          () -> {
            try {
              var ranges = cache.ranges();
              if (ranges.isEmpty()) {
                LocalDate from =
                    LocalDate.now(ICalendarMapper.SEOUL).withDayOfMonth(1).minusDays(7);
                ranges = List.<LocalDate[]>of(new LocalDate[] {from, from.plusDays(49)});
              }
              for (var range : ranges) {
                boolean applied = refresh(range[0], range[1]);
                if (!applied && coordinator.read().error() == null) refresh(range[0], range[1]);
              }
              synchronized (coordinator.lock) {
                activeSync = null;
              }
              result.complete(before.generation());
            } catch (RuntimeException error) {
              synchronized (coordinator.lock) {
                activeSync = null;
              }
              result.completeExceptionally(error);
            }
          });
      return result;
    }
  }

  @Scheduled(initialDelay = 60_000, fixedDelay = 60_000)
  void sync() {
    if (coordinator.read().calendar() != null) startSync();
  }

  void syncNow() {
    var connection = coordinator.snapshot();
    ApiException.require(connection.state().calendar() != null, "먼저 iCloud를 연결하세요.");
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
    for (int attempt = 0; attempt < 2; attempt++) {
      long generation;
      try {
        generation =
            startSync().get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
        throw new ApiException(503, "NETWORK", "동기화 대기가 중단됐습니다.");
      } catch (TimeoutException error) {
        throw new ApiException(409, "SYNC_IN_PROGRESS", "동기화가 진행 중입니다. 잠시 후 다시 확인하세요.");
      } catch (ExecutionException error) {
        throw new ApiException(503, "NETWORK", "iCloud 동기화를 완료하지 못했습니다.");
      }
      synchronized (coordinator.lock) {
        if (!coordinator.current(connection))
          throw new ApiException(409, "CONFLICT", "연결이 변경됐습니다. 다시 확인하세요.");
        var current = coordinator.read();
        if (current.error() != null) throw new ApiException(503, "NETWORK", current.error());
        if (generation == coordinator.generation) return;
      }
    }
    throw new ApiException(409, "CONFLICT", "일정이 변경 중입니다. 잠시 후 다시 동기화하세요.");
  }

  @jakarta.annotation.PreDestroy
  void close() {
    worker.shutdownNow();
  }
}
