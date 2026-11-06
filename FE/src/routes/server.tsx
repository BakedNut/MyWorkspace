import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/api";
import { mockControls, type ServerScenario } from "@/api/mock/mockApi";
import { selectClass } from "@/components/EventDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import type { GuestStatus } from "@/types/domain";

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

function ServerPage() {
  const uid = useId();
  const qc = useQueryClient();
  const now = useNow(15_000);
  const [scenario, setScenario] = useState<ServerScenario>(() =>
    typeof window === "undefined" ? "normal" : mockControls.get().serverScenario,
  );
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["server", scenario],
    queryFn: () => api.server.getStatus(),
    refetchInterval: 10_000,
    retry: false,
  });
  const stale = data && now ? now.getTime() - new Date(data.updatedAt).getTime() > STALE_MS : false;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">서버 대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            샘플 데이터 · 조회 전용 (서버 제어 기능 없음)
            {data && <> · 마지막 갱신 {formatDateTime(data.updatedAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
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
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
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
            <h2 id="host-title" className="text-lg font-bold">
              {data.hostName}
            </h2>
            <dl className="mt-4 grid gap-6 border-y py-6 sm:grid-cols-2">
              <div className="space-y-2">
                <dt className="flex justify-between text-sm">
                  <span className="font-semibold">CPU</span>
                  <span className="text-muted-foreground">{data.cpu.cores}코어</span>
                </dt>
                <dd className="space-y-2">
                  <p className="text-3xl font-bold tabular">{data.cpu.usagePercent}%</p>
                  <Meter value={data.cpu.usagePercent} label="CPU 사용률" />
                  <p className="text-sm">
                    온도 <Temp c={data.cpu.tempC} />
                  </p>
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
                  <p className="text-3xl font-bold tabular">
                    {pct(data.ram.usedMb, data.ram.totalMb)}%
                  </p>
                  <Meter value={pct(data.ram.usedMb, data.ram.totalMb)} label="RAM 사용률" />
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="storage-title">
            <h2 id="storage-title" className="text-lg font-bold">
              스토리지
            </h2>
            <ul className="mt-3 divide-y border-y">
              {data.storages.map((s) => {
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
            <h2 id="guest-title" className="text-lg font-bold">
              VM · LXC
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-y text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      ID
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      이름
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      유형
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      상태
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      CPU
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      메모리
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y border-b">
                  {data.guests.map((g) => (
                    <tr key={g.id}>
                      <td className="py-3 pr-4 tabular text-muted-foreground">{g.id}</td>
                      <td className="py-3 pr-4 font-medium">{g.name}</td>
                      <td className="py-3 pr-4 uppercase">{g.type}</td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className={cn("size-2 rounded-full", statusLabel[g.status].cls)}
                          />
                          {statusLabel[g.status].text}
                        </span>
                      </td>
                      <td className="py-3 pr-4 tabular">
                        {g.status === "running" ? `${g.cpuPercent}%` : "—"}
                      </td>
                      <td className="py-3 tabular">
                        {g.status === "stopped" ? "—" : `${gb(g.memUsedMb)} / ${gb(g.memTotalMb)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
