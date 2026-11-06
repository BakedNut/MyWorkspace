import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleHelp,
  Loader2,
  Power,
  Send,
  Plus,
  Trash2,
  Settings2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api, isPreview } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { cooldownRemaining, normalizeWolList } from "@/lib/wol";
import type { WolDevice } from "@/types/domain";

export const Route = createFileRoute("/wol")({
  head: () => ({
    meta: [
      { title: "WOL · MyWorkspace" },
      { name: "description", content: "등록한 PC를 Wake-on-LAN으로 깨웁니다." },
      { property: "og:title", content: "WOL · MyWorkspace" },
      { property: "og:description", content: "등록한 PC를 Wake-on-LAN으로 깨웁니다." },
    ],
  }),
  component: WolPage,
});

function WolPage() {
  const {
    data: devices,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["wol"],
    queryFn: () => api.wol.list(),
  });
  const [editing, setEditing] = useState(false);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">WOL</h1>
        <Button variant="outline" disabled={!devices} onClick={() => setEditing(true)}>
          <Settings2 aria-hidden /> WOL 리스트 수정
        </Button>
      </div>
      {isPreview && (
        <p className="mt-2 inline-block rounded-md bg-secondary px-2.5 py-1 text-sm text-secondary-foreground">
          데모 모드 — 실제 매직 패킷은 전송되지 않습니다.
        </p>
      )}

      {isLoading && (
        <p className="mt-8 text-muted-foreground" role="status">
          불러오는 중…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-6 text-destructive">
          PC 목록을 불러오지 못했습니다.
        </p>
      )}
      {devices?.length === 0 && (
        <p className="mt-8 text-muted-foreground">WOL 리스트 수정에서 PC를 추가하세요.</p>
      )}
      <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {devices?.map((d) => (
          <DeviceRow key={d.id} device={d} />
        ))}
      </ul>
      {editing && devices && <WolListDialog devices={devices} onClose={() => setEditing(false)} />}
    </div>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "checking"; sentAt: string }
  | { kind: "online"; sentAt: string }
  | { kind: "unconfirmed"; sentAt: string }
  | { kind: "error"; message: string };

function DeviceRow({ device }: { device: WolDevice }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [lastWake, setLastWake] = useState<number | null>(null);
  const now = useNow(250);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setPhase({ kind: "idle" });
    return () => {
      generation.current += 1;
    };
  }, [device.mac]);

  const remaining = now ? cooldownRemaining(lastWake, now.getTime()) : 0;
  const busy = phase.kind === "sending" || phase.kind === "checking";
  const disabled = !device.mac || busy || remaining > 0;

  const wake = async () => {
    const token = ++generation.current;
    const active = () => token === generation.current;
    setPhase({ kind: "sending" });
    try {
      const { sentAt } = await api.wol.wake(device.id);
      if (!active()) return;
      setLastWake(Date.now());
      setPhase({ kind: "checking", sentAt });
      // Poll boot state a few times — packet sent ≠ booted.
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!active()) return;
        const state = await api.wol.getBootState(device.id);
        if (!active()) return;
        if (state === "online") return setPhase({ kind: "online", sentAt });
      }
      setPhase({ kind: "unconfirmed", sentAt });
    } catch (e) {
      if (!active()) return;
      if (e instanceof ApiError && e.code === "RATE_LIMITED")
        setLastWake(Date.now() - (10_000 - (e.retryAfterMs ?? 10_000)));
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "요청 실패" });
    }
  };

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={wake}
        disabled={disabled}
        aria-label={`${device.name} 깨우기`}
        className="flex min-h-56 w-full flex-col items-center justify-center gap-4 rounded-2xl border border-primary/25 bg-card p-8 text-center shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Power aria-hidden className="size-12 text-primary" />
        <span className="w-full break-words text-2xl font-bold">{device.name}</span>
        <span className="text-sm text-muted-foreground">
          {!device.mac
            ? "MAC 주소 등록 필요"
            : busy
              ? "요청 처리 중…"
              : remaining > 0
                ? `다시 요청 ${Math.ceil(remaining / 1000)}초`
                : "PC 깨우기"}
        </span>
      </button>
      <div className="mt-2 min-h-5 text-sm" aria-live="polite">
        {phase.kind === "sending" && (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 aria-hidden className="size-4 animate-spin" /> 요청 중…
          </span>
        )}
        {phase.kind === "checking" && (
          <span className="inline-flex items-center gap-1.5">
            <Send aria-hidden className="size-4 text-success" /> 매직 패킷 전송 완료 (
            {formatDateTime(phase.sentAt)}) · 부팅 확인 중…
          </span>
        )}
        {phase.kind === "online" && (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 aria-hidden className="size-4" /> 패킷 전송 완료 · 부팅 확인됨 (응답 있음)
          </span>
        )}
        {phase.kind === "unconfirmed" && (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <CircleHelp aria-hidden className="size-4" /> 패킷 전송 완료 · 부팅은 확인되지 않음
            (응답 없음)
          </span>
        )}
        {phase.kind === "error" && (
          <span role="alert" className="text-destructive">
            {phase.message}
          </span>
        )}
      </div>
    </li>
  );
}

function WolListDialog({ devices, onClose }: { devices: WolDevice[]; onClose(): void }) {
  const qc = useQueryClient();
  const uid = useId();
  const [draft, setDraft] = useState(() => structuredClone(devices));
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (next: WolDevice[]) => api.wol.saveDevices(next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wol"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "저장하지 못했습니다."),
  });
  const update = (id: string, patch: Partial<WolDevice>) => {
    setError(null);
    setDraft((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[94vw] max-w-xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>WOL 리스트 수정</DialogTitle>
          <DialogDescription>
            PC 이름과 MAC 주소를 수정하고 PC를 추가·삭제할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error} 입력한 내용은 유지됩니다.
          </p>
        )}
        <form
          id={`${uid}-form`}
          className="min-h-0 space-y-4 overflow-y-auto p-1"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const normalized = normalizeWolList(draft);
              setError(null);
              mut.mutate(normalized);
            } catch (issue) {
              setError(issue instanceof Error ? issue.message : "PC 목록을 확인하세요.");
            }
          }}
        >
          <fieldset disabled={mut.isPending} className="min-w-0 space-y-4">
            <legend className="sr-only">PC 목록</legend>
            {draft.map((device, index) => (
              <div key={device.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">PC {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label={`${device.name || `PC ${index + 1}`} 삭제`}
                    onClick={() => setDraft((rows) => rows.filter((row) => row.id !== device.id))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-${device.id}-name`}>PC 이름</Label>
                  <Input
                    id={`${uid}-${device.id}-name`}
                    value={device.name}
                    maxLength={64}
                    onChange={(e) => update(device.id, { name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-${device.id}-mac`}>MAC 주소</Label>
                  <Input
                    id={`${uid}-${device.id}-mac`}
                    value={device.mac ?? ""}
                    placeholder="3C:7C:3F:12:AB:CD"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) =>
                      update(device.id, {
                        mac: e.target.value.trim() === "" ? null : e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">미등록 상태로 두려면 비워 두세요.</p>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraft((rows) => [
                  ...rows,
                  {
                    id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: "",
                    mac: null,
                  },
                ])
              }
            >
              <Plus aria-hidden /> PC 추가
            </Button>
          </fieldset>
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={mut.isPending} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form={`${uid}-form`} disabled={mut.isPending}>
            {mut.isPending ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
