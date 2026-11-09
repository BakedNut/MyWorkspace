import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { api, isPreview } from "@/api";
import { mockControls, type ServerScenario } from "@/api/mock/mockApi";
import { selectClass } from "@/components/EventDialog";
import { Button } from "@/components/ui/button";
import { UsageChart } from "@/components/UsageChart";
import { formatRate, HISTORY_WINDOWS } from "@/lib/server-history";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import type { GuestStatus, ServerRange } from "@/types/domain";

export const Route = createFileRoute("/server")({
  head: () => ({
    meta: [
      { title: "서버 대시보드 · MyWorkspace" },
      { name: "description", content: "홈서버 CPU, 메모리, 스토리지와 VM·LXC 상태를 확인합니다." },
      { property: "og:title", content: "서버 대시보드 · MyWorkspace" },
      {
        property: "og:description",
        content: "홈서버 CPU, 메모리, 스토리지와 VM·LXC 상태를 확인합니다.",
      },
    ],
  }),
  component: ServerPage,
});

const STALE_MS = 5 * 60_000;
const SCENARIOS: { value: ServerScenario; label: string }[] = [
  { value: "normal", label: "정상" },
  { value: "loading", label: "로딩 중" },
  { value: "error", label: "연결 실패" },
  { value: "stale", label: "오래된 데이터" },
  { value: "noTemp", label: "온도 지원 안 됨" },
];

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
const tb = (g: number) => (g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g} GB`);
const storageRank = (name: string) => (name === "local-lvm" ? 0 : name === "local" ? 1 : 2);

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full",
          value >= 90 ? "bg-destructive" : value >= 75 ? "bg-warning" : "bg-primary",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function Temp({ c }: { c: number | null }) {
  return c === null ? (
    <span className="text-muted-foreground">온도 지원 안 됨</span>
  ) : (
    <span className="tabular">{c}°C</span>
  );
}

const statusLabel: Record<GuestStatus["status"], { text: string; cls: string }> = {
  running: { text: "실행 중", cls: "bg-success" },
  stopped: { text: "중지됨", cls: "bg-muted-foreground" },
  paused: { text: "일시정지", cls: "bg-warning" },
};

function RangePicker({
  value,
  onChange,
  label,
}: {
  value: ServerRange;
  onChange(value: ServerRange): void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex max-w-full flex-wrap gap-1 rounded-lg border p-1"
    >
      {(Object.keys(HISTORY_WINDOWS) as ServerRange[]).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={value === r}
          onClick={() => onChange(r)}
          className={cn(
            "min-h-9 rounded-md px-3 text-xs",
            value === r
              ? "bg-accent font-semibold text-primary"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function ServerPage() {
  const uid = useId();
  const qc = useQueryClient();
  const now = useNow(15_000);
  const [range, setRange] = useState<ServerRange>("1D");
  const [guestRange, setGuestRange] = useState<ServerRange>("1D");
  const [scenario, setScenario] = useState<ServerScenario>(() =>
    typeof window === "undefined" ? "normal" : mockControls.get().serverScenario,
  );
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["server", scenario],
    queryFn: () => api.server.getStatus(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["server-history", scenario, range],
    queryFn: () => api.server.getHistory(range),
    enabled: !!data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const guestQuery = useQuery({
    queryKey: ["server-history", scenario, guestRange],
    queryFn: () => api.server.getHistory(guestRange),
    enabled: !!data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const hostHistory = history.data;
  const guestHistory = guestQuery.data;
  const hostEmpty = history.isPending
    ? "기록을 불러오는 중…"
    : history.error
      ? "기록을 불러오지 못했습니다."
      : "기록 없음";
  const guestEmpty = guestQuery.isPending
    ? "기록을 불러오는 중…"
    : guestQuery.error
      ? "기록을 불러오지 못했습니다."
      : "기록 없음";
  const stale = data && now ? now.getTime() - new Date(data.updatedAt).getTime() > STALE_MS : false;
  const storages = [...(data?.storages ?? [])].sort(
    (a, b) =>
      storageRank(a.name) - storageRank(b.name) ||
      a.name.localeCompare(b.name, "ko", { numeric: true }) ||
      a.name.localeCompare(b.name, "ko"),
  );

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">서버 대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPreview ? "샘플 데이터 · " : ""}1분마다 갱신 · 조회 전용
            {data && <> · 마지막 갱신 {formatDateTime(data.updatedAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {isPreview && (
            <div className="space-y-1">
              <label htmlFor={`${uid}-sc`} className="block text-xs text-muted-foreground">
                시안 상태 보기 (데모)
              </label>
              <select
                id={`${uid}-sc`}
                className={cn(selectClass, "w-44")}
                value={scenario}
                onChange={(e) => {
                  const v = e.target.value as ServerScenario;
                  mockControls.set({ serverScenario: v });
                  qc.removeQueries({ queryKey: ["server"] });
                  setScenario(v);
                }}
              >
                {SCENARIOS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              refetch();
              qc.invalidateQueries({ queryKey: ["server-history"] });
            }}
            disabled={isFetching}
          >
            <RefreshCw aria-hidden className={cn(isFetching && "animate-spin")} />{" "}
            {isFetching ? "갱신 중…" : "데이터 새로고침"}
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="mt-6">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-destructive"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">연결 실패</p>
              <p className="text-sm">
                {error instanceof Error ? error.message : "알 수 없는 오류"} 잠시 후 다시
                시도하세요.
              </p>
            </div>
          </div>
        )}
        {stale && (
          <div className="flex items-start gap-3 rounded-lg border border-warning/50 px-4 py-3 text-warning">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">
              <span className="font-semibold">오래된 데이터</span> — 5분 넘게 갱신되지 않았습니다.
              아래 값은 실제 상태와 다를 수 있습니다.
            </p>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="mt-8 space-y-4" role="status" aria-label="서버 상태를 불러오는 중">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {data && (
        <div className={cn("mt-8 space-y-10", stale && "opacity-80")}>
          <section aria-labelledby="host-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="host-title" className="text-lg font-bold">
                {data.hostName}
              </h2>
              <RangePicker value={range} onChange={setRange} label="호스트 그래프 기간" />
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-6 border-y py-6 lg:grid-cols-3">
              <div className="space-y-2">
                <dt className="flex justify-between text-sm">
                  <span className="font-semibold">CPU</span>
                  <span
                    className="text-right text-xs text-muted-foreground"
                    aria-label="CPU 구성과 온도"
                  >
                    {data.cpu.cores}코어 ⋅{" "}
                    {data.cpu.tempC === null ? "온도 지원 안 됨" : `온도 ${data.cpu.tempC}°C`}
                  </span>
                </dt>
                <dd className="space-y-2">
                  <p className="min-h-10 text-3xl font-bold tabular">{data.cpu.usagePercent}%</p>
                  <UsageChart
                    label="호스트 CPU"
                    range={range}
                    points={hostHistory?.host.cpu}
                    from={hostHistory?.from ?? 0}
                    to={hostHistory?.to ?? 1}
                    empty={hostEmpty}
                  />
                </dd>
              </div>
              <div className="space-y-2">
                <dt className="flex justify-between text-sm">
                  <span className="font-semibold">RAM</span>
                  <span className="text-muted-foreground tabular">
                    {gb(data.ram.usedMb)} / {gb(data.ram.totalMb)}
                  </span>
                </dt>
                <dd className="space-y-2">
                  <p className="min-h-10 text-3xl font-bold tabular">
                    {pct(data.ram.usedMb, data.ram.totalMb)}%
                  </p>
                  <UsageChart
                    label="호스트 RAM"
                    range={range}
                    points={hostHistory?.host.ram}
                    from={hostHistory?.from ?? 0}
                    to={hostHistory?.to ?? 1}
                    empty={hostEmpty}
                  />
                </dd>
              </div>
              <div className="space-y-2">
                <dt className="flex justify-between text-sm">
                  <span className="font-semibold">네트워크</span>
                  <span className="text-xs text-muted-foreground">Input ⋅ Output</span>
                </dt>
                <dd className="space-y-2">
                  <div className="flex min-h-10 flex-col justify-center text-xs tabular-nums">
                    <p>Input {formatRate(data.network.inputBytesPerSecond)}</p>
                    <p>Output {formatRate(data.network.outputBytesPerSecond)}</p>
                  </div>
                  <UsageChart
                    label="호스트 네트워크"
                    range={range}
                    unit="bytesPerSecond"
                    points={hostHistory?.host.input}
                    secondaryPoints={hostHistory?.host.output ?? []}
                    from={hostHistory?.from ?? 0}
                    to={hostHistory?.to ?? 1}
                    empty={hostEmpty}
                  />
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="storage-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="storage-title" className="text-lg font-bold">
                스토리지
              </h2>
              <span className="text-xs text-muted-foreground">local-lvm → local → 이름순</span>
            </div>
            <ul className="mt-3 divide-y border-y">
              {storages.map((s) => {
                const p = pct(s.usedGb, s.totalGb);
                return (
                  <li
                    key={s.name}
                    className="grid gap-2 py-4 sm:grid-cols-[12rem_minmax(0,1fr)_10rem_8rem] sm:items-center sm:gap-6"
                  >
                    <span className="font-medium">{s.name}</span>
                    <Meter value={p} label={`${s.name} 사용률`} />
                    <span className="text-sm tabular">
                      {tb(s.usedGb)} / {tb(s.totalGb)} ({p}%)
                    </span>
                    <span className="text-sm">
                      <Temp c={s.tempC} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="guest-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="guest-title" className="text-lg font-bold">
                VM · LXC
              </h2>
              <RangePicker value={guestRange} onChange={setGuestRange} label="VM/LXC 그래프 기간" />
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.guests.map((g) => {
                const record = guestHistory?.guests[`${g.type}-${g.id}`];
                return (
                  <li key={g.id} className="min-w-0 rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs uppercase text-muted-foreground">
                          {g.type} · {g.id}
                        </p>
                        <h3 className="mt-1 truncate font-semibold" title={g.name}>
                          {g.name}
                        </h3>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
                        <span
                          aria-hidden
                          className={cn("size-2 rounded-full", statusLabel[g.status].cls)}
                        />
                        {statusLabel[g.status].text}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
                      <div className="min-w-0">
                        <div className="mb-2 min-h-14 space-y-1">
                          <p className="text-sm font-medium">CPU</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {g.status === "running" ? `${g.cpuPercent}%` : "—"}
                          </p>
                        </div>
                        <UsageChart
                          label={`${g.name} CPU`}
                          compact
                          range={guestRange}
                          points={record?.cpu}
                          from={guestHistory?.from ?? 0}
                          to={guestHistory?.to ?? 1}
                          empty={guestEmpty}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 min-h-14 space-y-1">
                          <p className="text-sm font-medium">RAM</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {pct(g.memUsedMb, g.memTotalMb)}% ⋅ {gb(g.memUsedMb)} /{" "}
                            {gb(g.memTotalMb)}
                          </p>
                        </div>
                        <UsageChart
                          label={`${g.name} RAM`}
                          compact
                          range={guestRange}
                          points={record?.ram}
                          from={guestHistory?.from ?? 0}
                          to={guestHistory?.to ?? 1}
                          empty={guestEmpty}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 min-h-14 space-y-1">
                          <p className="text-sm font-medium">네트워크</p>
                          <p className="text-[11px] tabular-nums text-muted-foreground">
                            Input {formatRate(g.network.inputBytesPerSecond)} ⋅ Output{" "}
                            {formatRate(g.network.outputBytesPerSecond)}
                          </p>
                        </div>
                        <UsageChart
                          label={`${g.name} 네트워크`}
                          compact
                          range={guestRange}
                          unit="bytesPerSecond"
                          points={record?.input}
                          secondaryPoints={record?.output ?? []}
                          from={guestHistory?.from ?? 0}
                          to={guestHistory?.to ?? 1}
                          empty={guestEmpty}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 min-h-14 space-y-1">
                          <p className="text-sm font-medium">디스크</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {g.disk.usedGb === null
                              ? `사용량 미지원 ⋅ 할당 ${g.disk.totalGb.toFixed(1)} GB`
                              : `${pct(g.disk.usedGb, g.disk.totalGb)}% ⋅ ${g.disk.usedGb.toFixed(1)} GB / ${g.disk.totalGb.toFixed(1)} GB`}
                          </p>
                        </div>
                        <UsageChart
                          label={`${g.name} 디스크`}
                          compact
                          range={guestRange}
                          points={record?.disk}
                          from={guestHistory?.from ?? 0}
                          to={guestHistory?.to ?? 1}
                          empty={
                            g.disk.usedGb === null ? "사용량을 확인할 수 없습니다." : guestEmpty
                          }
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
