import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleHelp, Loader2, Power, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api } from "@/api";
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
import { cooldownRemaining, normalizeMac } from "@/lib/wol";
import type { WolDevice } from "@/types/domain";

export const Route = createFileRoute("/wol")({
  head: () => ({
    meta: [
      { title: "WOL · MyWorkspace" },
      { name: "description", content: "등록된 두 대의 PC를 Wake-on-LAN으로 깨웁니다." },
      { property: "og:title", content: "WOL · MyWorkspace" },
      { property: "og:description", content: "등록된 두 대의 PC를 Wake-on-LAN으로 깨웁니다." },
    ],
  }),
  component: WolPage,
});

function WolPage() {
  const { data: devices, isLoading } = useQuery({
    queryKey: ["wol"],
    queryFn: () => api.wol.list(),
  });
  const [editing, setEditing] = useState<WolDevice | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
      <h1 className="text-3xl font-bold">WOL</h1>
      <p className="mt-2 inline-block rounded-md bg-secondary px-2.5 py-1 text-sm text-secondary-foreground">
        데모 모드 — 실제 매직 패킷은 전송되지 않습니다.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        등록한 두 PC만 깨울 수 있습니다. MAC 주소는 아래에서 수정할 수 있습니다.
      </p>

      {isLoading && (
        <p className="mt-8 text-muted-foreground" role="status">
          불러오는 중…
        </p>
      )}
      <ul className="mt-8 divide-y border-y">
        {devices?.map((d) => (
          <DeviceRow key={d.id} device={d} onEdit={() => setEditing(d)} />
        ))}
      </ul>
      <MacDialog device={editing} onClose={() => setEditing(null)} />
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

function DeviceRow({ device, onEdit }: { device: WolDevice; onEdit(): void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [lastWake, setLastWake] = useState<number | null>(null);
  const now = useNow(250);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const remaining = now ? cooldownRemaining(lastWake, now.getTime()) : 0;
  const busy = phase.kind === "sending" || phase.kind === "checking";
  const disabled = !device.mac || busy || remaining > 0;

  const wake = async () => {
    setPhase({ kind: "sending" });
    try {
      const { sentAt } = await api.wol.wake(device.id);
      setLastWake(Date.now());
      setPhase({ kind: "checking", sentAt });
      // Poll boot state a few times — packet sent ≠ booted.
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled.current) return;
        if ((await api.wol.getBootState(device.id)) === "online")
          return setPhase({ kind: "online", sentAt });
      }
      setPhase({ kind: "unconfirmed", sentAt });
    } catch (e) {
      if (e instanceof ApiError && e.code === "RATE_LIMITED")
        setLastWake(Date.now() - (10_000 - (e.retryAfterMs ?? 10_000)));
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "요청 실패" });
    }
  };

  return (
    <li className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Power aria-hidden className="size-5 text-primary" /> {device.name}
        </h2>
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">MAC </span>
          {device.mac ? (
            <code className="tabular">{device.mac}</code>
          ) : (
            <span className="text-warning">미등록 — 등록 후 깨우기를 사용할 수 있습니다.</span>
          )}
        </p>
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
              <CheckCircle2 aria-hidden className="size-4" /> 패킷 전송 완료 · 부팅 확인됨 (응답
              있음)
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
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onEdit}>
          MAC {device.mac ? "수정" : "등록"}
        </Button>
        <Button
          onClick={wake}
          disabled={disabled}
          aria-describedby={!device.mac ? undefined : undefined}
        >
          {remaining > 0 && !busy ? `다시 요청 ${Math.ceil(remaining / 1000)}초` : "깨우기"}
        </Button>
      </div>
    </li>
  );
}

function MacDialog({ device, onClose }: { device: WolDevice | null; onClose(): void }) {
  const qc = useQueryClient();
  const uid = useId();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (device) {
      setValue(device.mac ?? "");
      setTouched(false);
      setError(null);
    }
  }, [device]);

  const normalized = normalizeMac(value);
  const invalid = touched && value.trim() !== "" && !normalized;

  const mut = useMutation({
    mutationFn: (mac: string | null) => api.wol.updateMac(device!.id, mac),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wol"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "저장 실패"),
  });

  return (
    <Dialog open={!!device} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{device?.name} MAC 주소</DialogTitle>
          <DialogDescription>
            예: 3C:7C:3F:12:AB:CD — 콜론(:), 하이픈(-) 또는 구분자 없이 입력할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!normalized) return;
            mut.mutate(normalized);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-mac`}>MAC 주소</Label>
            <Input
              id={`${uid}-mac`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-invalid={invalid}
              aria-describedby={`${uid}-help`}
              autoFocus
            />
            <p
              id={`${uid}-help`}
              className={invalid ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
            >
              {invalid
                ? "16진수 12자리의 유효한 MAC 주소가 아닙니다 (멀티캐스트·브로드캐스트 주소 불가)."
                : normalized
                  ? `저장 형식: ${normalized}`
                  : "16진수 12자리"}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {device?.mac ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => mut.mutate(null)}
              >
                등록 해제
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                저장
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
